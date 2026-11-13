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
from services.gcode_generator import Params, generate_gcode

router = APIRouter(tags=["layers"])
log = logging.getLogger("cnc.layers")


def layer_to_response(l: Layer) -> LayerResponse:
    return LayerResponse(id=l.id, project_id=l.project_id, name=l.name, order_index=l.order_index,
                         tool_id=l.tool_id, operation=l.operation, params=l.params or {}, gcode=l.gcode,
                         is_complete=bool(l.is_complete), entity_count=len(l.entities or []),
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
              params=body.params, order_index=idx)
    db.add(l)
    await _touch_project(db, project_id)
    await db.commit()
    await db.refresh(l)
    return layer_to_response(l)


@router.put("/layers/{layer_id}", response_model=LayerResponse)
async def update_layer(layer_id: str, body: LayerUpdate, db: AsyncSession = Depends(get_db)):
    l = await _layer(db, layer_id)
    for k, v in body.model_dump(exclude_unset=True).items():
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


@router.post("/layers/{layer_id}/generate", response_model=GenerateResponse)
async def generate(layer_id: str, body: GenerateRequest, db: AsyncSession = Depends(get_db)):
    l = await _layer(db, layer_id)
    project = await db.get(Project, l.project_id)
    tools = read_json("tools.json")
    materials = read_json("materials.json")
    settings = read_json("settings.json")
    tool_id = body.tool_id or l.tool_id
    tool = next((t for t in tools if t.get("id") == tool_id), None)
    if tool is None:
        raise HTTPException(400, "Seleziona un utensile valido")
    mat = materials.get(project.material, {})
    cutting = settings.get("cutting", {})
    operation = body.operation or l.operation

    # priorità: valori richiesti > materiale (più conservativo tra materiale e utensile) > utensile
    def pick(key, default):
        val = getattr(body, key, None)
        if val is not None:
            return float(val)
        cands = [float(x) for x in (mat.get(key), tool.get(key)) if x is not None]
        return min(cands) if cands else default

    params = Params(
        operation=operation, tool_diameter=float(tool["diameter"]), tool_name=tool.get("name", tool_id),
        material=mat.get("name", project.material),
        feed_rate=pick("feed_rate", 1000), plunge_rate=pick("plunge_rate", 250),
        spindle_rpm=float(body.spindle_rpm or tool.get("spindle_rpm") or mat.get("spindle_rpm") or 18000),
        depth_total=body.depth_total,
        depth_per_pass=float(body.depth_per_pass or mat.get("depth_per_pass") or 1.0),
        step_over=pick("step_over", 0.4),
        safe_height=float(body.safe_height if body.safe_height is not None else cutting.get("safe_height", 5.0)),
        bridge_height=float(body.bridge_height if body.bridge_height is not None else cutting.get("bridge_height", 1.5)),
        stock_z=project.stock_z, pocket_direction=body.pocket_direction,
    )
    entities = [{"type": e.type, "data": e.data, "is_construction": e.is_construction} for e in l.entities]
    try:
        result = generate_gcode(entities, params)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        log.exception("Errore generazione G-code")
        raise HTTPException(500, f"Errore generazione G-code: {exc}") from exc

    l.gcode = result.gcode
    l.tool_id = tool_id
    l.operation = operation
    l.params = {**body.model_dump(), "operation": operation, "tool_id": tool_id,
                "feed_rate": params.feed_rate, "plunge_rate": params.plunge_rate,
                "spindle_rpm": params.spindle_rpm, "depth_per_pass": params.depth_per_pass,
                "step_over": params.step_over, "safe_height": params.safe_height,
                "bridge_height": params.bridge_height}
    l.is_complete = False
    await _touch_project(db, l.project_id)
    await db.commit()
    await db.refresh(l)
    log.info("G-code generato per layer '%s': %d linee, %.1f mm taglio", l.name, result.line_count, result.cut_length_mm)
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
