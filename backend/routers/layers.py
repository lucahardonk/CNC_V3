"""CRUD layer, entities e generazione G-code."""
import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import read_json
from database import get_db
from models import Entity, Layer, Project
from schemas import (EntityBatch, EntityResponse, GenerateRequest, GenerateResponse, LayerCreate, LayerResponse,
                     LayerUpdate)
from services.gcode_generator import IGNORED_TYPES, LayerJob, Params, generate_gcode, generate_program

router = APIRouter(tags=["layers"])
log = logging.getLogger("cnc.layers")


# parametri di taglio per layer e relativi default (macchina reale: feed max 1500, RPM max 24000)
CUT_DEFAULTS = {"tool_diameter": 3.175, "tool_type": "flat", "feed_rate": 600.0, "spindle_rpm": 12000,
                "z_safe": 5.0, "z_depth": -2.0, "z_pass_depth": 1.0}


def layer_to_response(l: Layer) -> LayerResponse:
    return LayerResponse(id=l.id, project_id=l.project_id, name=l.name, order_index=l.order_index,
                         tool_id=l.tool_id, operation=l.operation, params=l.params or {}, gcode=l.gcode,
                         is_complete=bool(l.is_complete), entity_count=len(l.entities or []),
                         draw_layers=l.draw_layers or [],
                         **{k: getattr(l, k) if getattr(l, k) is not None else d for k, d in CUT_DEFAULTS.items()},
                         created_at=l.created_at, updated_at=l.updated_at)


async def _layer(db: AsyncSession, layer_id: str) -> Layer:
    l = await db.get(Layer, layer_id)
    if not l:
        raise HTTPException(404, "Layer non trovato")
    return l


async def _touch_project(db: AsyncSession, project_id: str):
    p = await db.get(Project, project_id)
    if p:
        p.updated_at = datetime.utcnow()


@router.get("/projects/{project_id}/layers", response_model=list[LayerResponse])
async def list_layers(project_id: str, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Layer).where(Layer.project_id == project_id).order_by(Layer.order_index))).scalars().all()
    return [layer_to_response(l) for l in rows]


@router.post("/projects/{project_id}/layers", response_model=LayerResponse, status_code=201)
async def create_layer(project_id: str, body: LayerCreate, db: AsyncSession = Depends(get_db)):
    if not await db.get(Project, project_id):
        raise HTTPException(404, "Progetto non trovato")
    idx = body.order_index
    if idx is None:
        idx = ((await db.execute(select(func.max(Layer.order_index)).where(Layer.project_id == project_id))).scalar() or -1) + 1
    l = Layer(project_id=project_id, name=body.name, tool_id=body.tool_id, operation=body.operation,
              params=body.params, order_index=idx, **{k: getattr(body, k) for k in CUT_DEFAULTS})
    db.add(l)
    await _touch_project(db, project_id)
    await db.commit()
    await db.refresh(l)
    return layer_to_response(l)


@router.put("/layers/{layer_id}", response_model=LayerResponse)
@router.patch("/layers/{layer_id}", response_model=LayerResponse)
async def update_layer(layer_id: str, body: LayerUpdate, db: AsyncSession = Depends(get_db)):
    """Aggiornamento parziale (PUT e PATCH equivalenti): salva solo i campi inviati."""
    l = await _layer(db, layer_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is None and k in CUT_DEFAULTS:
            continue  # colonne NOT NULL: null = invariato
        setattr(l, k, v)
    await _touch_project(db, l.project_id)
    await db.commit()
    await db.refresh(l)
    return layer_to_response(l)


@router.delete("/layers/{layer_id}", status_code=204)
async def delete_layer(layer_id: str, db: AsyncSession = Depends(get_db)):
    l = await _layer(db, layer_id)
    await db.delete(l)
    await db.commit()


@router.get("/layers/{layer_id}/entities", response_model=list[EntityResponse])
async def list_entities(layer_id: str, db: AsyncSession = Depends(get_db)):
    l = await _layer(db, layer_id)
    return [EntityResponse.model_validate(e) for e in l.entities]


@router.post("/layers/{layer_id}/entities", response_model=list[EntityResponse])
async def upsert_entities(layer_id: str, body: EntityBatch, db: AsyncSession = Depends(get_db)):
    """Upsert batch. Con replace=True le entities non presenti vengono eliminate."""
    l = await _layer(db, layer_id)
    existing = {e.id: e for e in l.entities}
    keep = set()
    for item in body.entities:
        eid = item.id or str(uuid.uuid4())
        keep.add(eid)
        if eid in existing:
            e = existing[eid]
            e.type, e.data, e.is_construction = item.type, item.data, item.is_construction
        else:
            e = Entity(id=eid, layer_id=l.id, type=item.type, data=item.data, is_construction=item.is_construction)
            db.add(e)
            l.entities.append(e)
    if body.replace:
        for eid, e in existing.items():
            if eid not in keep:
                l.entities.remove(e)
                await db.delete(e)
    await _touch_project(db, l.project_id)
    await db.commit()
    await db.refresh(l)
    return [EntityResponse.model_validate(e) for e in l.entities]


DEFAULT_DRAW_LAYER = {"id": "0", "name": "Layer 0", "color": "#e5e7eb", "visible": True, "locked": False}


def draw_layers_of(l: Layer) -> list[dict]:
    """Layer di disegno del layer di lavorazione (Layer 0 sempre presente)."""
    dls = [dict(d) for d in (l.draw_layers or []) if d.get("id")]
    if not any(d["id"] == "0" for d in dls):
        dls.insert(0, dict(DEFAULT_DRAW_LAYER))
    return dls


def layer_entities(l: Layer, only: str | None = None):
    """Entità lavorabili del layer: tutte quelle sui layer di disegno visibili (only=None) oppure solo
    quelle del layer di disegno `only`. Ritorna (entities, info, n_hidden, scope)."""
    dls = draw_layers_of(l)
    info = {d["id"]: {"name": d.get("name"), "color": d.get("color")} for d in dls}
    hidden = {d["id"] for d in dls if d.get("visible") is False}
    scope = None
    if only is not None:
        scope = next((d for d in dls if d["id"] == only), None)
        if scope is None:
            raise HTTPException(404, "Layer di disegno non trovato")
        if only in hidden:
            raise HTTPException(400, f"Il layer \"{scope.get('name')}\" è nascosto: rendilo visibile per generare il G-code")
    entities, n_hidden = [], 0
    for e in l.entities:
        dl = str(((e.data or {}).get("_meta") or {}).get("dlayer") or "0")
        if dl not in info:  # layer di disegno eliminato → Layer 0
            dl = "0"
        if only is not None and dl != only:
            continue
        # le entità sui layer di disegno nascosti non vengono lavorate (come i layer spenti in AutoCAD)
        if dl in hidden:
            n_hidden += 1
            continue
        entities.append({"type": e.type, "data": e.data, "is_construction": e.is_construction, "dlayer": dl})
    if only is not None and not entities:
        raise HTTPException(400, f"Il layer \"{scope.get('name')}\" non contiene entità")
    return entities, info, n_hidden, scope


def _cut(l: Layer, key: str):
    v = getattr(l, key, None)
    return CUT_DEFAULTS[key] if v is None else v


# parametri extra salvati in layer.params; tutti (colonne + extra + tool_id/operation) sono sovrascrivibili
# per ogni layer di disegno con draw_layers[i].cut (il Layer 0 usa i parametri del layer di lavorazione)
PARAM_KEYS = ("plunge_rate", "step_over", "pocket_direction", "bridge_height")
CUT_KEYS = (*CUT_DEFAULTS, *PARAM_KEYS, "tool_id", "operation")


def effective_cut(l: Layer, dl: dict | None = None) -> dict:
    """Parametri di taglio effettivi del layer di lavorazione o di un suo layer di disegno."""
    eff = {k: _cut(l, k) for k in CUT_DEFAULTS}
    eff.update(tool_id=l.tool_id, operation=l.operation or "profile_outside")
    prev = l.params or {}
    eff.update({k: prev[k] for k in PARAM_KEYS if prev.get(k) is not None})
    if dl and str(dl.get("id")) != "0":
        cut = dl.get("cut") or {}
        eff.update({k: v for k, v in cut.items() if k in CUT_KEYS and (v is not None or k == "tool_id")})
    return eff


def layer_params(project: Project, l: Layer, body: GenerateRequest | None = None,
                 dl: dict | None = None) -> tuple[Params, str | None]:
    """Parametri di taglio: valori della richiesta > parametri del layer di disegno (dl.cut) > parametri del
    layer > default. Con un utensile della libreria (Impostazioni > Utensili) indicato nella richiesta il suo
    diametro prevale."""
    body = body or GenerateRequest()
    tools = read_json("tools.json")  # libreria salvata da Impostazioni > Utensili (DATA_DIR)
    materials = read_json("materials.json")
    settings = read_json("settings.json")
    mat = materials.get(project.material, {})
    cutting = settings.get("cutting", {})
    eff = effective_cut(l, dl)
    tool_id = body.tool_id or eff.get("tool_id")
    tool = next((t for t in tools if t.get("id") == tool_id), None)
    if body.tool_id and tool is None:
        raise HTTPException(400, "Utensile non trovato nella libreria")
    diameter = float(tool["diameter"]) if (body.tool_id and tool) else float(eff["tool_diameter"])
    feed = float(body.feed_rate or eff["feed_rate"])

    def first(*vals, default):
        return next((float(v) for v in vals if v is not None), default)

    params = Params(
        operation=body.operation or eff["operation"],
        tool_diameter=diameter,
        tool_type=str(eff.get("tool_type") or "flat"),
        tool_name=(tool.get("name", tool_id) if tool else
                   {"flat": "Fresa piatta", "ball": "Fresa sferica", "vbit": "Fresa a V"}.get(eff["tool_type"], "Fresa")),
        material=mat.get("name", project.material),
        feed_rate=feed,
        plunge_rate=first(body.plunge_rate, eff.get("plunge_rate"), default=round(max(50.0, feed * 0.3))),
        spindle_rpm=first(body.spindle_rpm, default=float(eff["spindle_rpm"])),
        depth_total=first(body.depth_total, default=abs(float(eff["z_depth"]))),
        depth_per_pass=first(body.depth_per_pass, default=float(eff["z_pass_depth"])),
        step_over=first(body.step_over, eff.get("step_over"), (tool or {}).get("step_over"), default=0.4),
        safe_height=first(body.safe_height, default=float(eff["z_safe"])),
        bridge_height=first(body.bridge_height, eff.get("bridge_height"), cutting.get("bridge_height"), default=1.5),
        stock_z=project.stock_z,
        pocket_direction=body.pocket_direction or eff.get("pocket_direction") or "horizontal",
    )
    if tool and tool.get("max_depth") and params.depth_total > float(tool["max_depth"]):
        params.warnings.append(f"Profondità {params.depth_total:g} mm oltre la lunghezza utile della fresa "
                               f"\"{tool.get('name')}\" ({float(tool['max_depth']):g} mm)")
    return params, (tool_id if tool else None)


def _machinable(e: dict) -> bool:
    return not e.get("is_construction") and e.get("type") not in IGNORED_TYPES and e.get("type") != "bridge"


def layer_jobs(project: Project, l: Layer, only: str | None = None, body: GenerateRequest | None = None):
    """Un job per ogni layer di disegno visibile con geometria lavorabile, ciascuno con i SUOI parametri
    e SOLO le sue entità (i ponticelli valgono per tutti). Ritorna (jobs, n_hidden, scope)."""
    entities, info, n_hidden, scope = layer_entities(l, only)
    dls = {d["id"]: d for d in draw_layers_of(l)}
    groups: dict[str, list] = {}
    for e in entities:
        groups.setdefault(e["dlayer"], []).append(e)
    if only is None:  # ponticelli disegnati su qualunque layer: valgono per tutti i percorsi
        bridges = [e for e in entities if e.get("type") == "bridge"]
        groups = {k: [e for e in v if e.get("type") != "bridge"] + bridges for k, v in groups.items()}
    jobs = []
    for dl_id, d in dls.items():
        ents = groups.get(dl_id) or []
        if not any(_machinable(e) for e in ents):
            continue
        params, _ = layer_params(project, l, body, d)
        jobs.append(LayerJob(name=str(d.get("name") or dl_id), number=len(jobs) + 1, entities=ents, params=params,
                             tool_type=params.tool_type, layer_info={dl_id: info[dl_id]}))
    return jobs, n_hidden, scope


def layer_result(project: Project, l: Layer, only: str | None = None, body: GenerateRequest | None = None):
    """G-code del layer di lavorazione: i layer di disegno sono lavorati uno dopo l'altro, ognuno come
    percorso indipendente (M0 solo se cambia la fresa). Lo stesso testo viene salvato, simulato e scaricato."""
    jobs, n_hidden, scope = layer_jobs(project, l, only, body)
    if not jobs:
        raise ValueError("Nessuna geometria valida nel layer (disegna forme chiuse non di costruzione).")
    if len(jobs) == 1:
        result = generate_gcode(jobs[0].entities, jobs[0].params, layer_info=jobs[0].layer_info)
    else:
        result = generate_program(jobs, f"Progetto: {project.name} - Layer: {l.name}", pause_between="change")
    result.warnings = [w for j in jobs for w in j.params.warnings] + result.warnings
    if n_hidden:
        result.warnings.append(f"{n_hidden} entità su layer di disegno nascosti escluse dal percorso")
    return result, scope


async def build_layer_gcode(db: AsyncSession, l: Layer, body: GenerateRequest):
    """Calcola il G-code di un layer di lavorazione con i parametri richiesti.

    body.draw_layer_id = None → tutti i layer di disegno visibili (percorsi separati per layer);
    altrimenti solo quelli del layer di disegno indicato (che deve essere visibile).
    Ritorna (result, params, tool_id, operation, scope) senza salvare nulla; params = parametri del layer
    di lavorazione (Layer 0)."""
    project = await db.get(Project, l.project_id)
    params, tool_id = layer_params(project, l, body)
    try:
        result, scope = layer_result(project, l, body.draw_layer_id, body)
    except ValueError as exc:
        msg = str(exc)
        if body.draw_layer_id is not None:
            msg = f"Layer di disegno: {msg}"
        raise HTTPException(400, msg) from exc
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        log.exception("Errore generazione G-code")
        raise HTTPException(500, f"Errore generazione G-code: {exc}") from exc
    if scope is not None:
        result.gcode = result.gcode.replace("; CNC V3 - Generated G-code",
                                            f"; CNC V3 - Generated G-code\n; Draw layer: {scope.get('name')} (solo questo layer)", 1)
        result.line_count += 1
    return result, params, tool_id, params.operation, scope


@router.post("/layers/{layer_id}/generate", response_model=GenerateResponse)
async def generate(layer_id: str, body: GenerateRequest, db: AsyncSession = Depends(get_db)):
    """Genera e SALVA il G-code del layer (tutto o un solo layer di disegno con draw_layer_id)."""
    l = await _layer(db, layer_id)
    result, params, tool_id, operation, scope = await build_layer_gcode(db, l, body)
    l.gcode = result.gcode
    l.tool_id = tool_id
    l.operation = operation
    l.params = {**body.model_dump(), "operation": operation, "tool_id": tool_id,
                "feed_rate": params.feed_rate, "plunge_rate": params.plunge_rate,
                "spindle_rpm": params.spindle_rpm, "depth_per_pass": params.depth_per_pass,
                "step_over": params.step_over, "safe_height": params.safe_height,
                "bridge_height": params.bridge_height, "pocket_direction": params.pocket_direction,
                "draw_layer_id": scope["id"] if scope else None,
                "draw_layer_name": scope.get("name") if scope else None}
    # i valori usati diventano i parametri di taglio del layer (indipendenti dagli altri layer)
    l.tool_diameter = params.tool_diameter
    l.feed_rate = params.feed_rate
    l.spindle_rpm = int(params.spindle_rpm)
    l.z_safe = params.safe_height
    l.z_depth = -params.depth_total
    l.z_pass_depth = params.depth_per_pass
    l.is_complete = False
    await _touch_project(db, l.project_id)
    await db.commit()
    await db.refresh(l)
    log.info("G-code generato per layer '%s'%s: %d linee, %.1f mm taglio", l.name,
             f" (solo '{scope.get('name')}')" if scope else "", result.line_count, result.cut_length_mm)
    return GenerateResponse(layer=layer_to_response(l), line_count=result.line_count,
                            path_length_mm=result.path_length_mm, cut_length_mm=result.cut_length_mm,
                            estimated_time_min=result.estimated_time_min, warnings=result.warnings)


@router.get("/layers/{layer_id}/gcode", response_class=PlainTextResponse)
async def download_gcode(layer_id: str, db: AsyncSession = Depends(get_db)):
    l = await _layer(db, layer_id)
    if not l.gcode:
        raise HTTPException(404, "G-code non ancora generato")
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in l.name)
    return PlainTextResponse(l.gcode, headers={"Content-Disposition": f'attachment; filename="{safe}.nc"'})
