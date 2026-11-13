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

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from config import DATA_DIR, JSON_FILES
from database import DB_PATH, engine

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
