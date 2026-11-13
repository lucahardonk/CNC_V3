"""Operazioni su singole entities CAD."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Entity
from schemas import EntityBase, EntityResponse

router = APIRouter(prefix="/entities", tags=["entities"])


@router.get("/{entity_id}", response_model=EntityResponse)
async def get_entity(entity_id: str, db: AsyncSession = Depends(get_db)):
    e = await db.get(Entity, entity_id)
    if not e:
        raise HTTPException(404, "Entity non trovata")
    return EntityResponse.model_validate(e)


@router.put("/{entity_id}", response_model=EntityResponse)
async def update_entity(entity_id: str, body: EntityBase, db: AsyncSession = Depends(get_db)):
    e = await db.get(Entity, entity_id)
    if not e:
        raise HTTPException(404, "Entity non trovata")
    e.type, e.data, e.is_construction = body.type, body.data, body.is_construction
    await db.commit()
    await db.refresh(e)
    return EntityResponse.model_validate(e)


@router.delete("/{entity_id}", status_code=204)
async def delete_entity(entity_id: str, db: AsyncSession = Depends(get_db)):
    e = await db.get(Entity, entity_id)
    if not e:
        raise HTTPException(404, "Entity non trovata")
    await db.delete(e)
    await db.commit()
