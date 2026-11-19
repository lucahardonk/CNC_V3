"""Export/Import completo dei dati (ZIP)."""
import io
import json
import logging
import shutil
import sqlite3
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from config import DATA_DIR, JSON_FILES
from database import DB_PATH, engine, get_db
from sqlalchemy import select

from models import Layer, Project
from routers.layers import _cut, build_layer_gcode, layer_entities, layer_params
from schemas import GenerateRequest
from services.gcode_generator import LayerJob, generate_program

router = APIRouter(tags=["export"])
log = logging.getLogger("cnc.export")


def _safe(name: str) -> str:
    return "".join(c if c.isalnum() or c in "-_ " else "_" for c in name).strip() or "senza_nome"


@router.get("/export")
async def export_all():
    buf = io.BytesIO()
    with tempfile.TemporaryDirectory(dir=str(DATA_DIR)) as tmp:
        snap = Path(tmp) / "projects.db"
        # backup consistente dell'SQLite
        if DB_PATH.exists():
            src = sqlite3.connect(str(DB_PATH))
            dst = sqlite3.connect(str(snap))
            src.backup(dst)
            src.close()
            dst.close()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            if snap.exists():
                z.write(snap, "projects.db")
                con = sqlite3.connect(str(snap))
                rows = con.execute(
                    "SELECT p.name, l.order_index, l.name, l.gcode FROM layers l JOIN projects p ON p.id = l.project_id "
                    "WHERE l.gcode IS NOT NULL AND l.gcode != ''").fetchall()
                con.close()
                for pname, idx, lname, gcode in rows:
                    z.writestr(f"gcode/{_safe(pname)}/{idx:02d}_{_safe(lname)}.nc", gcode)
            for name in JSON_FILES:
                if (DATA_DIR / name).exists():
                    z.write(DATA_DIR / name, name)
            z.writestr("manifest.json", json.dumps({"app": "CNC V3", "version": 1,
                                                    "exported_at": datetime.now().isoformat()}, indent=2))
    buf.seek(0)
    fname = f"cnc_v3_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
    log.info("Export completo generato: %s (%d bytes)", fname, buf.getbuffer().nbytes)
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@router.post("/import")
async def import_all(file: UploadFile = File(...)):
    data = await file.read()
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise HTTPException(400, "File ZIP non valido") from exc
    names = set(z.namelist())
    if "projects.db" not in names and not any(n in names for n in JSON_FILES):
        raise HTTPException(400, "Lo ZIP non contiene un backup CNC V3")
    restored = []
    # backup di sicurezza dello stato attuale
    bak = DATA_DIR / "backup_before_import"
    bak.mkdir(exist_ok=True)
    for name in ("projects.db", *JSON_FILES):
        if (DATA_DIR / name).exists():
            shutil.copy(DATA_DIR / name, bak / name)
    for name in JSON_FILES:
        if name in names:
            content = z.read(name)
            json.loads(content)  # validazione
            (DATA_DIR / name).write_bytes(content)
            restored.append(name)
    if "projects.db" in names:
        tmp = DATA_DIR / "projects.import.db"
        tmp.write_bytes(z.read("projects.db"))
        try:
            con = sqlite3.connect(str(tmp))
            con.execute("SELECT count(*) FROM projects").fetchone()
            con.close()
        except sqlite3.DatabaseError as exc:
            tmp.unlink(missing_ok=True)
            raise HTTPException(400, f"projects.db non valido: {exc}") from exc
        await engine.dispose()
        src = sqlite3.connect(str(tmp))
        dst = sqlite3.connect(str(DB_PATH))
        src.backup(dst)
        src.close()
        dst.close()
        tmp.unlink(missing_ok=True)
        restored.append("projects.db")
    log.info("Import completato: %s", restored)
    return {"ok": True, "restored": restored}


@router.post("/export/layer/{layer_id}")
async def export_layer_gcode(layer_id: str, body: GenerateRequest, fmt: str = Query("json", alias="format", pattern="^(json|nc)$"),
                             db: AsyncSession = Depends(get_db)):
    """G-code di un layer di lavorazione con i parametri ricevuti, SENZA salvarlo.

    body.draw_layer_id: solo le entità visibili di quel layer di disegno (None = tutti i layer visibili).
    ?format=nc → file .nc in download; default JSON con G-code e statistiche."""
    l = await db.get(Layer, layer_id)
    if not l:
        raise HTTPException(404, "Layer non trovato")
    result, params, tool_id, operation, scope = await build_layer_gcode(db, l, body)
    if fmt == "nc":
        name = _safe(l.name + (f"_{scope.get('name')}" if scope else "")).replace(" ", "_")
        return PlainTextResponse(result.gcode, headers={"Content-Disposition": f'attachment; filename="{name}.nc"'})
    return {"layer_id": l.id, "draw_layer": scope, "operation": operation, "tool_id": tool_id,
            "gcode": result.gcode, "line_count": result.line_count, "path_length_mm": result.path_length_mm,
            "cut_length_mm": result.cut_length_mm, "estimated_time_min": result.estimated_time_min,
            "warnings": result.warnings}


# --------------------------------------------------------------------------- export .nc con parametri del layer
def _fname(name: str) -> str:
    return _safe(name).replace(" ", "_")


def _nc_response(gcode: str, filename: str) -> PlainTextResponse:
    return PlainTextResponse(gcode, media_type="text/plain; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})


def _job(project: Project, l: Layer, number: int) -> LayerJob:
    params, _ = layer_params(project, l)
    entities, info, _n_hidden, _ = layer_entities(l)
    return LayerJob(name=l.name, number=number, entities=entities, params=params,
                    tool_type=_cut(l, "tool_type"), layer_info=info)


@router.get("/export/layer/{layer_id}")
async def export_layer_nc(layer_id: str, db: AsyncSession = Depends(get_db)):
    """File .nc del solo layer, generato con i parametri di taglio salvati nel layer."""
    l = await db.get(Layer, layer_id)
    if not l:
        raise HTTPException(404, "Layer non trovato")
    project = await db.get(Project, l.project_id)
    number = next((i for i, x in enumerate(project.layers, 1) if x.id == l.id), 1)
    try:
        res = generate_program([_job(project, l, number)], f"Progetto: {project.name} - Layer: {l.name}",
                               pause_between=False)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    log.info("Export .nc layer '%s': %d linee", l.name, res.line_count)
    return _nc_response(res.gcode, f"layer_{_fname(l.name)}.nc")


@router.get("/export/all/{project_id}")
async def export_project_nc(project_id: str, db: AsyncSession = Depends(get_db)):
    """File .nc con tutti i layer del progetto in sequenza (M0 per il cambio punta tra i layer).
    I layer senza geometria lavorabile vengono saltati (segnalati nel commento iniziale)."""
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Progetto non trovato")
    layers = (await db.execute(select(Layer).where(Layer.project_id == project_id)
                               .order_by(Layer.order_index))).scalars().all()
    jobs, skipped = [], []
    for i, l in enumerate(layers, 1):
        job = _job(project, l, i)
        if not any(not e.get("is_construction") for e in job.entities):
            skipped.append(l.name)
            continue
        jobs.append(job)
    if not jobs:
        raise HTTPException(400, "Nessun layer con geometria da esportare")
    try:
        res = generate_program(jobs, f"Progetto: {project.name}")
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    gcode = res.gcode
    if skipped:
        gcode = gcode.replace("G21 G90 G17 G94", "; Layer vuoti saltati: " + ", ".join(skipped).replace("\n", " ")
                              + "\nG21 G90 G17 G94", 1)
    log.info("Export .nc progetto '%s': %d layer, %d linee", project.name, len(jobs), res.line_count)
    return _nc_response(gcode, f"progetto_{_fname(project.name)}_all.nc")
