"""FastAPI app: API /api/*, WebSocket GRBL e frontend statico (SPA)."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from starlette.exceptions import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from config import DATA_DIR, FRONTEND_DIST, ensure_data_files, read_json
from database import init_db
from routers import entities, export, grbl as grbl_router, layers, projects, settings, tools
from services.grbl_service import grbl

log = logging.getLogger("cnc.app")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    created = ensure_data_files()
    if created:
        log.info("Creati file di default in %s: %s", DATA_DIR, ", ".join(created))
    await init_db()
    log.info("Database pronto: %s", DATA_DIR / "projects.db")
    try:
        s = read_json("settings.json")
        grbl.port = s["machine"]["port"] or grbl.port
        grbl.baud = int(s["machine"]["baud_rate"] or grbl.baud)
        grbl.poll_interval = max(0.05, float(s["grbl"]["status_poll_interval_ms"]) / 1000.0)
    except Exception:  # noqa: BLE001
        pass
    # connessione automatica (simulazione se la porta non esiste)
    try:
        await grbl.connect()
        log.info("GRBL: %s su %s", "SIMULAZIONE" if grbl.simulated else "connesso", grbl.port)
    except Exception as exc:  # noqa: BLE001
        log.error("Connessione GRBL fallita: %s", exc)
    log.info("CNC V3 pronto → http://localhost:5550")
    yield
    if grbl.connected:
        await grbl.disconnect()
    log.info("CNC V3 arrestato")


app = FastAPI(title="CNC V3", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False,
                   allow_methods=["*"], allow_headers=["*"])

for r in (projects.router, layers.router, entities.router, tools.router, settings.router,
          grbl_router.router, export.router):
    app.include_router(r, prefix="/api")


@app.get("/api/health")
async def health():
    return {"ok": True, "grbl": grbl.state, "simulated": grbl.simulated}


@app.exception_handler(HTTPException)
async def http_exc(request: Request, exc: HTTPException):
    # fallback SPA: le rotte non-API restituiscono index.html
    if exc.status_code == 404 and not request.url.path.startswith("/api") and (FRONTEND_DIST / "index.html").exists():
        return FileResponse(FRONTEND_DIST / "index.html")
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)


if (FRONTEND_DIST / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
else:
    @app.get("/")
    async def no_frontend():
        return {"message": "CNC V3 API attiva. Frontend non compilato (esegui npm run build in frontend/)."}
