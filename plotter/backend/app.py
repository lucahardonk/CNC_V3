"""PlotterCAM backend: progetti, impostazioni, proxy Moonraker e job runner.

Tutto il G-code viene generato dal frontend; qui lo si salva/invia alla FLSUN via Moonraker.
"""
import asyncio
import json
import logging
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("plottercam")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

MOONRAKER_URL = os.getenv("MOONRAKER_URL", "http://flsun.home").rstrip("/")
MOONRAKER_API_KEY = os.getenv("MOONRAKER_API_KEY", "")
DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
FRONTEND_DIST = Path(os.getenv("FRONTEND_DIST", Path(__file__).resolve().parent.parent / "frontend" / "dist"))
PROJECTS_DIR = DATA_DIR / "projects"
SETTINGS_FILE = DATA_DIR / "settings.json"
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_SETTINGS: dict[str, Any] = {
    "sheet_z": -4.777,        # Z (assoluta, dopo G28) in cui la penna tocca il foglio
    "pen_up": 3.0,            # alzata penna sopra al foglio (mm)
    "pen_down_extra": 0.0,    # pressione extra sotto lo zero foglio (mm)
    "feed_draw": 600,         # mm/min durante il disegno
    "feed_travel": 3000,      # mm/min spostamenti a penna alzata
    "feed_z_down": 60,        # mm/min discesa penna
    "feed_z_up": 180,         # mm/min salita penna
    "offset_x": 0.0,          # offset del centro foglio rispetto al centro piano
    "offset_y": 0.0,
    "print_radius": 132.0,    # da printer.cfg [printer] print_radius
    "home_before": True,      # G28 all'inizio del job
    "home_after": False,
    "send_mode": "upload",    # "upload" (file + print/start) | "stream" (blocchi via gcode/script)
    "stream_chunk": 20,       # righe per blocco in modalità stream
    "resume_cmd": "RESUME_BASE",  # RESUME del printer.cfg richiede il sensore filamento: si usa RESUME_BASE
    "grid": 1.0,
    "snap": True,
}

NAME_RE = re.compile(r"[^A-Za-z0-9_.-]+")


def load_settings() -> dict:
    data = dict(DEFAULT_SETTINGS)
    if SETTINGS_FILE.exists():
        try:
            data.update(json.loads(SETTINGS_FILE.read_text()))
        except Exception as exc:  # noqa: BLE001
            log.warning("settings.json non valido: %s", exc)
    return data


# --------------------------------------------------------------------------- Moonraker client
class Moonraker:
    def __init__(self, base: str):
        self.base = base
        headers = {"X-Api-Key": MOONRAKER_API_KEY} if MOONRAKER_API_KEY else {}
        self.client = httpx.AsyncClient(base_url=base, timeout=httpx.Timeout(10.0, read=None), headers=headers)

    async def get(self, path: str, **params):
        r = await self.client.get(path, params=params or None, timeout=8.0)
        return self._unwrap(r)

    async def post(self, path: str, timeout: Optional[float] = 8.0, **kw):
        r = await self.client.post(path, timeout=timeout, **kw)
        return self._unwrap(r)

    @staticmethod
    def _unwrap(r: httpx.Response):
        try:
            body = r.json()
        except ValueError:
            body = {"error": {"message": r.text}}
        if r.status_code >= 400:
            err = body.get("error", {}) if isinstance(body, dict) else {}
            msg = err.get("message") if isinstance(err, dict) else str(err)
            raise HTTPException(status_code=502, detail=f"Moonraker {r.status_code}: {msg or r.text}")
        return body.get("result", body) if isinstance(body, dict) else body

    async def gcode(self, script: str, timeout: Optional[float] = None):
        # /printer/gcode/script ritorna solo a comando completato (può durare molto)
        return await self.post("/printer/gcode/script", json={"script": script}, timeout=timeout)


mr = Moonraker(MOONRAKER_URL)


# --------------------------------------------------------------------------- Job runner
class Job:
    def __init__(self):
        self.reset()

    def reset(self):
        self.state = "idle"        # idle | running | done | cancelled | error
        self.mode = None
        self.total = 0
        self.sent = 0
        self.filename = None
        self.error = None
        self.started = None
        self.task: Optional[asyncio.Task] = None
        self.cancel_flag = False
        self.resume_event = asyncio.Event()

    def info(self) -> dict:
        return {"state": self.state, "mode": self.mode, "total": self.total, "sent": self.sent,
                "filename": self.filename, "error": self.error, "started": self.started}


job = Job()


def gcode_lines(text: str) -> list[str]:
    out = []
    for raw in text.splitlines():
        line = raw.split(";", 1)[0].strip()
        if line:
            out.append(line)
    return out


def split_blocks(lines: list[str], chunk: int) -> list[list[str]]:
    """Blocchi di `chunk` righe; ogni PAUSE diventa un blocco a sé."""
    blocks, cur = [], []
    for ln in lines:
        if ln.upper() == "PAUSE":
            if cur:
                blocks.append(cur)
            blocks.append([ln])
            cur = []
            continue
        cur.append(ln)
        if len(cur) >= chunk:
            blocks.append(cur)
            cur = []
    if cur:
        blocks.append(cur)
    return blocks


async def stream_job(lines: list[str], chunk: int, pen_up_cmd: str, resume_cmd: str):
    try:
        for block in split_blocks(lines, chunk):
            if job.cancel_flag:
                job.state = "cancelled"
                break
            await mr.gcode("\n".join(block))
            job.sent += len(block)
            if block[0].upper() == "PAUSE":
                job.state = "paused"
                job.resume_event.clear()
                await job.resume_event.wait()
                if job.cancel_flag:
                    job.state = "cancelled"
                    break
                job.state = "running"
                await mr.gcode(resume_cmd)
        else:
            job.state = "done"
        if job.state == "cancelled" and pen_up_cmd:
            try:
                await mr.gcode(pen_up_cmd, timeout=30)
            except Exception:  # noqa: BLE001
                pass
    except Exception as exc:  # noqa: BLE001
        job.state = "error"
        job.error = getattr(exc, "detail", None) or str(exc)
        log.error("Stream job fallito: %s", job.error)


# --------------------------------------------------------------------------- App
app = FastAPI(title="PlotterCAM", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class GcodeBody(BaseModel):
    script: str


class JogBody(BaseModel):
    x: float = 0
    y: float = 0
    z: float = 0
    feed: float = 3000


class JobBody(BaseModel):
    gcode: str
    name: str = "plottercam"
    mode: Optional[str] = None


@app.get("/api/health")
async def health():
    return {"ok": True, "moonraker": MOONRAKER_URL}


# ---- settings
@app.get("/api/settings")
async def get_settings():
    return load_settings()


@app.put("/api/settings")
async def put_settings(body: dict):
    data = load_settings()
    data.update({k: v for k, v in body.items() if k in DEFAULT_SETTINGS})
    SETTINGS_FILE.write_text(json.dumps(data, indent=2))
    return data


# ---- projects
def project_path(pid: str) -> Path:
    if not re.fullmatch(r"[a-f0-9-]{8,40}", pid):
        raise HTTPException(400, "id progetto non valido")
    return PROJECTS_DIR / f"{pid}.json"


@app.get("/api/projects")
async def list_projects():
    items = []
    for f in PROJECTS_DIR.glob("*.json"):
        try:
            p = json.loads(f.read_text())
            items.append({"id": p["id"], "name": p.get("name", "Senza nome"), "updated": p.get("updated", 0),
                          "shapes": len(p.get("shapes", [])), "layers": len(p.get("layers", []))})
        except Exception:  # noqa: BLE001
            continue
    return sorted(items, key=lambda x: x["updated"], reverse=True)


@app.get("/api/projects/{pid}")
async def get_project(pid: str):
    f = project_path(pid)
    if not f.exists():
        raise HTTPException(404, "progetto non trovato")
    return json.loads(f.read_text())


@app.post("/api/projects")
async def save_project(body: dict):
    pid = body.get("id") or str(uuid.uuid4())
    body["id"] = pid
    body["updated"] = time.time()
    body.setdefault("name", "Senza nome")
    project_path(pid).write_text(json.dumps(body))
    return {"id": pid, "updated": body["updated"]}


@app.delete("/api/projects/{pid}")
async def delete_project(pid: str):
    f = project_path(pid)
    if f.exists():
        f.unlink()
    return {"ok": True}


# ---- machine
@app.get("/api/machine/status")
async def machine_status():
    try:
        info = await mr.get("/printer/info")
    except HTTPException as exc:
        return {"online": False, "klippy_state": "offline", "message": exc.detail}
    except Exception as exc:  # noqa: BLE001
        return {"online": False, "klippy_state": "offline", "message": f"Moonraker non raggiungibile: {exc}"}
    out = {"online": True, "klippy_state": info.get("state"), "message": info.get("state_message", "")}
    if info.get("state") == "ready":
        try:
            q = await mr.get("/printer/objects/query", toolhead="position,homed_axes",
                             gcode_move="gcode_position,absolute_coordinates",
                             print_stats="state,filename,print_duration", virtual_sdcard="progress,is_active")
            st = q.get("status", {})
            out["position"] = st.get("gcode_move", {}).get("gcode_position") or st.get("toolhead", {}).get("position")
            out["homed_axes"] = st.get("toolhead", {}).get("homed_axes", "")
            out["print_stats"] = st.get("print_stats", {})
            out["sd_progress"] = st.get("virtual_sdcard", {}).get("progress", 0)
        except Exception as exc:  # noqa: BLE001
            out["message"] = f"query fallita: {exc}"
    return out


@app.post("/api/machine/gcode")
async def machine_gcode(body: GcodeBody):
    await mr.gcode(body.script, timeout=120)
    return {"ok": True}


@app.post("/api/machine/jog")
async def machine_jog(body: JogBody):
    parts = [f"{a}{v:.3f}" for a, v in (("X", body.x), ("Y", body.y), ("Z", body.z)) if v]
    if not parts:
        return {"ok": True}
    await mr.gcode(f"G91\nG1 {' '.join(parts)} F{body.feed:.0f}\nG90", timeout=60)
    return {"ok": True}


@app.post("/api/machine/home")
async def machine_home():
    await mr.gcode("G28", timeout=120)
    return {"ok": True}


@app.post("/api/machine/emergency_stop")
async def machine_estop():
    job.cancel_flag = True
    await mr.post("/printer/emergency_stop")
    return {"ok": True}


@app.post("/api/machine/firmware_restart")
async def machine_fw_restart():
    await mr.post("/printer/firmware_restart")
    return {"ok": True}


@app.post("/api/machine/restart")
async def machine_restart():
    await mr.post("/printer/restart")
    return {"ok": True}


# ---- job
@app.get("/api/job")
async def job_status():
    info = job.info()
    if job.mode == "upload" and job.state in ("running", "paused"):
        try:
            q = await mr.get("/printer/objects/query", print_stats="state", virtual_sdcard="progress")
            st = q.get("status", {})
            ps = st.get("print_stats", {}).get("state")
            info["progress"] = st.get("virtual_sdcard", {}).get("progress", 0)
            info["printer_state"] = ps
            if ps in ("complete", "cancelled", "error"):
                job.state = {"complete": "done"}.get(ps, ps)
            elif ps in ("paused", "printing"):
                job.state = "paused" if ps == "paused" else "running"
            info["state"] = job.state
        except Exception as exc:  # noqa: BLE001
            info["warning"] = str(exc)
    elif job.total:
        info["progress"] = job.sent / job.total
    return info


@app.post("/api/job/start")
async def job_start(body: JobBody):
    if job.state in ("running", "paused"):
        raise HTTPException(409, "Un job è già in esecuzione")
    s = load_settings()
    mode = body.mode or s.get("send_mode", "upload")
    lines = gcode_lines(body.gcode)
    if not lines:
        raise HTTPException(400, "G-code vuoto")
    job.reset()
    job.mode, job.total, job.started, job.state = mode, len(lines), time.time(), "running"
    if mode == "upload":
        name = NAME_RE.sub("_", body.name).strip("_") or "plottercam"
        fname = f"plottercam/{name}_{time.strftime('%Y%m%d_%H%M%S')}.gcode"
        try:
            files = {"file": (fname.split("/")[-1], body.gcode.encode(), "application/octet-stream")}
            await mr.post("/server/files/upload", files=files, data={"root": "gcodes", "path": "plottercam"},
                          timeout=60)
            await mr.post("/printer/print/start", params={"filename": fname})
            job.filename = fname
        except HTTPException as exc:
            job.state, job.error = "error", exc.detail
            raise
    else:
        pen_up = f"G90\nG1 Z{s['sheet_z'] + s['pen_up']:.3f} F{s['feed_z_up']}"
        job.task = asyncio.create_task(stream_job(lines, max(1, int(s.get("stream_chunk", 20))), pen_up,
                                                  s.get("resume_cmd") or "RESUME_BASE"))
    return job.info()


@app.post("/api/job/resume")
async def job_resume():
    if job.state != "paused":
        raise HTTPException(409, "Nessun job in pausa")
    if job.mode == "stream":
        job.resume_event.set()
    else:
        await mr.gcode(load_settings().get("resume_cmd") or "RESUME_BASE", timeout=60)
        job.state = "running"
    return job.info()


@app.post("/api/job/stop")
async def job_stop():
    job.cancel_flag = True
    job.resume_event.set()
    if job.mode == "upload" and job.state in ("running", "paused"):
        try:
            await mr.post("/printer/print/cancel")
        except HTTPException as exc:
            log.warning("cancel fallito: %s", exc.detail)
        job.state = "cancelled"
    return job.info()


@app.post("/api/job/reset")
async def job_reset():
    if job.state in ("running", "paused"):
        raise HTTPException(409, "Job in esecuzione: fermalo prima")
    job.reset()
    return job.info()


@app.post("/api/export")
async def export_gcode(body: JobBody):
    name = NAME_RE.sub("_", body.name).strip("_") or "plottercam"
    return PlainTextResponse(body.gcode, headers={"Content-Disposition": f'attachment; filename="{name}.gcode"'})


# ---- frontend statico (SPA)
@app.exception_handler(StarletteHTTPException)
async def http_exc(request: Request, exc: StarletteHTTPException):
    if exc.status_code == 404 and not request.url.path.startswith("/api") and (FRONTEND_DIST / "index.html").exists():
        return FileResponse(FRONTEND_DIST / "index.html")
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)


if (FRONTEND_DIST / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "3000"))
    log.info("PlotterCAM → http://localhost:%s  (Moonraker: %s)", port, MOONRAKER_URL)
    uvicorn.run(app, host="0.0.0.0", port=port)
