"""Impostazioni (settings.json) e profili materiale (materials.json)."""
from typing import Any

from fastapi import APIRouter, HTTPException

from config import DEFAULTS_DIR, deep_merge, read_json, write_json

router = APIRouter(tags=["settings"])


def _defaults(name: str):
    import json
    return json.loads((DEFAULTS_DIR / name).read_text(encoding="utf-8"))


@router.get("/settings")
async def get_settings():
    # merge con i default per includere eventuali nuove chiavi
    return deep_merge(_defaults("settings.json"), read_json("settings.json"))


@router.put("/settings")
async def put_settings(body: dict[str, Any]):
    merged = deep_merge(deep_merge(_defaults("settings.json"), read_json("settings.json")), body)
    write_json("settings.json", merged)
    try:
        from services.grbl_service import grbl
        grbl.poll_interval = max(0.05, float(merged["grbl"]["status_poll_interval_ms"]) / 1000.0)
        if not grbl.connected:
            grbl.port = merged["machine"]["port"]
            grbl.baud = int(merged["machine"]["baud_rate"])
    except (KeyError, ValueError, TypeError):
        pass
    return merged


@router.get("/materials")
async def get_materials():
    return read_json("materials.json")


@router.put("/materials")
async def put_materials(body: dict[str, dict[str, Any]]):
    for key in ("softwood", "hardwood", "aluminum"):
        if key not in body:
            raise HTTPException(400, f"Materiale mancante: {key}")
    write_json("materials.json", body)
    return body


@router.post("/settings/reset")
async def reset_settings():
    for name in ("settings.json", "materials.json", "tools.json"):
        write_json(name, _defaults(name))
    return {"ok": True}
