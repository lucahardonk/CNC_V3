"""Libreria utensili salvata in DATA_DIR/tools.json."""
import re
import uuid

from fastapi import APIRouter, HTTPException

from config import read_json, write_json
from schemas import Tool

router = APIRouter(prefix="/tools", tags=["tools"])


def _slug(name: str) -> str:
    return "tool_" + (re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:30] or uuid.uuid4().hex[:6])


@router.get("")
async def list_tools():
    return read_json("tools.json")


@router.put("")
async def replace_tools(tools: list[Tool]):
    """Sostituisce l'intera libreria (usato dal pannello impostazioni)."""
    out, seen = [], set()
    for t in tools:
        d = t.model_dump()
        if not d.get("id") or d["id"] in seen:
            d["id"] = f"{_slug(d['name'])}_{uuid.uuid4().hex[:4]}"
        seen.add(d["id"])
        out.append(d)
    write_json("tools.json", out)
    return out


@router.post("", status_code=201)
async def add_tool(tool: Tool):
    tools = read_json("tools.json")
    d = tool.model_dump()
    ids = {t["id"] for t in tools}
    if not d.get("id") or d["id"] in ids:
        d["id"] = f"{_slug(d['name'])}_{uuid.uuid4().hex[:4]}"
    tools.append(d)
    write_json("tools.json", tools)
    return d


@router.put("/{tool_id}")
async def update_tool(tool_id: str, tool: Tool):
    tools = read_json("tools.json")
    for i, t in enumerate(tools):
        if t["id"] == tool_id:
            d = tool.model_dump()
            d["id"] = tool_id
            tools[i] = d
            write_json("tools.json", tools)
            return d
    raise HTTPException(404, "Utensile non trovato")


@router.delete("/{tool_id}", status_code=204)
async def delete_tool(tool_id: str):
    tools = read_json("tools.json")
    new = [t for t in tools if t["id"] != tool_id]
    if len(new) == len(tools):
        raise HTTPException(404, "Utensile non trovato")
    write_json("tools.json", new)
