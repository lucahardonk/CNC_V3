"""Endpoint REST + WebSocket per il controllo GRBL."""
import asyncio
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Layer
from schemas import CommandRequest, ConnectRequest, JogRequest, SendGcodeRequest
from services.grbl_service import grbl

router = APIRouter(tags=["grbl"])
log = logging.getLogger("cnc.grbl.api")


def _require():
    if not grbl.connected:
        raise HTTPException(409, "GRBL non connesso")


@router.get("/grbl/status")
async def status():
    return grbl.snapshot()


@router.post("/grbl/connect")
async def connect(body: ConnectRequest | None = None):
    body = body or ConnectRequest()
    return await grbl.connect(body.port, body.baud, body.simulate)


@router.post("/grbl/disconnect")
async def disconnect():
    return await grbl.disconnect()


@router.post("/grbl/jog")
async def jog(body: JogRequest):
    _require()
    return {"command": await grbl.jog(body.x, body.y, body.z, body.feed)}


@router.post("/grbl/jog/cancel")
async def jog_cancel():
    _require()
    await grbl.jog_cancel()
    return {"ok": True}


@router.post("/grbl/zero/{axis}")
async def zero(axis: str):
    _require()
    try:
        return {"command": await grbl.zero_axis(axis)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/grbl/stop")
async def stop():
    _require()
    await grbl.emergency_stop()
    return {"ok": True}


@router.post("/grbl/pause")
async def pause():
    _require()
    await grbl.pause()
    return {"ok": True}


@router.post("/grbl/resume")
async def resume():
    _require()
    await grbl.resume()
    return {"ok": True}


@router.post("/grbl/unlock")
async def unlock():
    _require()
    await grbl.command("$X")
    return {"ok": True}


@router.post("/grbl/home")
async def home():
    _require()
    await grbl.command("$H")
    return {"ok": True}


@router.post("/grbl/command")
async def command(body: CommandRequest):
    _require()
    if grbl.job["running"] and body.command.strip() not in ("?", "!", "~", "\x18"):
        raise HTTPException(409, "Lavoro in corso: comandi manuali disabilitati")
    await grbl.command(body.command)
    return {"ok": True}


@router.post("/grbl/send")
async def send(body: SendGcodeRequest, db: AsyncSession = Depends(get_db)):
    _require()
    gcode = body.gcode
    if body.layer_id:
        layer = await db.get(Layer, body.layer_id)
        if not layer or not layer.gcode:
            raise HTTPException(400, "Layer senza G-code generato")
        gcode = layer.gcode
    if not gcode:
        raise HTTPException(400, "Nessun G-code da inviare")
    try:
        return await grbl.start_job(gcode, body.layer_id)
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/grbl/job/stop")
async def job_stop():
    await grbl.stop_job()
    return {"ok": True}


@router.websocket("/ws/grbl")
async def ws_grbl(ws: WebSocket):
    """Stream di stato/log verso il client; accetta comandi JSON {action: ...}."""
    await ws.accept()
    q = grbl.subscribe()
    await ws.send_json(grbl.snapshot())

    async def sender():
        while True:
            msg = await q.get()
            await ws.send_json(msg)

    task = asyncio.create_task(sender())
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
                action = msg.get("action")
                if action == "command":
                    await grbl.command(msg.get("command", ""))
                elif action == "jog":
                    await grbl.jog(msg.get("x", 0), msg.get("y", 0), msg.get("z", 0), msg.get("feed", 1000))
                elif action == "jog_cancel":
                    await grbl.jog_cancel()
                elif action == "stop":
                    await grbl.emergency_stop()
                elif action == "status":
                    await ws.send_json(grbl.snapshot())
            except Exception as exc:  # noqa: BLE001
                await ws.send_json({"type": "error", "text": str(exc)})
    except WebSocketDisconnect:
        pass
    finally:
        task.cancel()
        grbl.unsubscribe(q)
