"""Schemi Pydantic v2."""
from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

Material = Literal["softwood", "hardwood", "aluminum"]
Operation = Literal["profile_on", "profile_inside", "profile_outside", "pocket"]


# ---------- Entity ----------
class EntityBase(BaseModel):
    type: str
    data: dict[str, Any] = Field(default_factory=dict)
    is_construction: bool = False


class EntityCreate(EntityBase):
    id: Optional[str] = None


class EntityResponse(EntityBase):
    model_config = ConfigDict(from_attributes=True)
    id: str
    layer_id: str


class EntityBatch(BaseModel):
    entities: list[EntityCreate]
    replace: bool = True  # se True elimina le entities non presenti nella lista


# ---------- Layer ----------
class LayerBase(BaseModel):
    name: str = "Layer"
    tool_id: Optional[str] = None
    operation: Operation = "profile_outside"
    params: dict[str, Any] = Field(default_factory=dict)


class LayerCreate(LayerBase):
    order_index: Optional[int] = None


class LayerUpdate(BaseModel):
    name: Optional[str] = None
    order_index: Optional[int] = None
    tool_id: Optional[str] = None
    operation: Optional[Operation] = None
    params: Optional[dict[str, Any]] = None
    is_complete: Optional[bool] = None


class LayerResponse(LayerBase):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    order_index: int
    gcode: Optional[str] = None
    is_complete: bool = False
    entity_count: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ---------- Project ----------
class ProjectBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    material: Material = "softwood"
    stock_x: float = Field(gt=0)
    stock_y: float = Field(gt=0)
    stock_z: float = Field(gt=0)


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    material: Optional[Material] = None
    stock_x: Optional[float] = Field(default=None, gt=0)
    stock_y: Optional[float] = Field(default=None, gt=0)
    stock_z: Optional[float] = Field(default=None, gt=0)


class ProjectResponse(ProjectBase):
    model_config = ConfigDict(from_attributes=True)
    id: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    layer_count: int = 0


class ProjectDetail(ProjectResponse):
    layers: list[LayerResponse] = Field(default_factory=list)


# ---------- G-code ----------
class GenerateRequest(BaseModel):
    operation: Optional[Operation] = None
    tool_id: Optional[str] = None
    depth_total: float = Field(default=3.0, gt=0)
    depth_per_pass: Optional[float] = Field(default=None, gt=0)
    feed_rate: Optional[float] = Field(default=None, gt=0)
    plunge_rate: Optional[float] = Field(default=None, gt=0)
    spindle_rpm: Optional[float] = Field(default=None, gt=0)
    step_over: Optional[float] = Field(default=None, gt=0, le=1)
    safe_height: Optional[float] = None
    bridge_height: Optional[float] = None
    pocket_direction: Literal["horizontal", "vertical", "contour"] = "horizontal"


class GenerateResponse(BaseModel):
    layer: LayerResponse
    line_count: int
    path_length_mm: float
    cut_length_mm: float
    estimated_time_min: float
    warnings: list[str] = Field(default_factory=list)


# ---------- Tools ----------
class Tool(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: Optional[str] = None
    name: str
    diameter: float = Field(gt=0)
    flutes: int = Field(default=2, ge=1)
    type: str = "upcut_spiral"
    material: str = "carbide"
    coating: str = "none"
    max_depth: float = 20.0
    feed_rate: float = 1000
    plunge_rate: float = 250
    spindle_rpm: float = 18000
    step_over: float = 0.4
    notes: str = ""


# ---------- GRBL ----------
class JogRequest(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    feed: float = Field(default=1000, gt=0)


class ConnectRequest(BaseModel):
    port: Optional[str] = None
    baud: Optional[int] = None
    simulate: bool = False


class CommandRequest(BaseModel):
    command: str


class SendGcodeRequest(BaseModel):
    layer_id: Optional[str] = None
    gcode: Optional[str] = None
