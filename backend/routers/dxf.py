"""Import DXF: il file viene analizzato e restituito come entità CAD (anteprima lato frontend)."""
import logging

from fastapi import APIRouter, File, HTTPException, UploadFile

from services.dxf_importer import parse_dxf

router = APIRouter(prefix="/dxf", tags=["dxf"])
log = logging.getLogger("cnc.dxf")
MAX_SIZE = 50 * 1024 * 1024


@router.post("/parse")
async def parse(file: UploadFile = File(...)):
    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(413, "File troppo grande (max 50 MB)")
    try:
        res = parse_dxf(content)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    log.info("DXF '%s': %d entità, unità %s", file.filename, len(res.entities), res.unit_name)
    return {"filename": file.filename, **res.to_dict()}
