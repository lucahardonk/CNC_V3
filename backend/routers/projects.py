"""CRUD progetti."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Layer, Project
from routers.layers import layer_to_response
from schemas import ProjectCreate, ProjectDetail, ProjectResponse, ProjectUpdate

router = APIRouter(prefix="/projects", tags=["projects"])


def project_to_response(p: Project, layer_count: int = 0) -> ProjectResponse:
    return ProjectResponse(id=p.id, name=p.name, material=p.material, stock_x=p.stock_x, stock_y=p.stock_y,
                           stock_z=p.stock_z, created_at=p.created_at, updated_at=p.updated_at,
                           layer_count=layer_count)


@router.get("", response_model=list[ProjectResponse])
async def list_projects(db: AsyncSession = Depends(get_db)):
    counts = dict((await db.execute(select(Layer.project_id, func.count(Layer.id)).group_by(Layer.project_id))).all())
    rows = (await db.execute(select(Project).order_by(Project.updated_at.desc()))).scalars().all()
    return [project_to_response(p, counts.get(p.id, 0)) for p in rows]


@router.post("", response_model=ProjectDetail, status_code=201)
async def create_project(body: ProjectCreate, db: AsyncSession = Depends(get_db)):
    p = Project(**body.model_dump())
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return ProjectDetail(**project_to_response(p).model_dump(), layers=[])


async def _get(db: AsyncSession, project_id: str) -> Project:
    p = await db.get(Project, project_id)
    if not p:
        raise HTTPException(404, "Progetto non trovato")
    return p


@router.get("/{project_id}", response_model=ProjectDetail)
async def get_project(project_id: str, db: AsyncSession = Depends(get_db)):
    p = await _get(db, project_id)
    layers = [layer_to_response(l) for l in p.layers]
    return ProjectDetail(**project_to_response(p, len(layers)).model_dump(), layers=layers)


@router.put("/{project_id}", response_model=ProjectDetail)
async def update_project(project_id: str, body: ProjectUpdate, db: AsyncSession = Depends(get_db)):
    p = await _get(db, project_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is not None:
            setattr(p, k, v)
    await db.commit()
    await db.refresh(p)
    layers = [layer_to_response(l) for l in p.layers]
    return ProjectDetail(**project_to_response(p, len(layers)).model_dump(), layers=layers)


@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: str, db: AsyncSession = Depends(get_db)):
    p = await _get(db, project_id)
    await db.delete(p)
    await db.commit()
