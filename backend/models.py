"""Modelli SQLAlchemy: Project -> Layer -> Entity."""
import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class Project(Base):
    __tablename__ = "projects"
    id = Column(String, primary_key=True, default=_uuid)
    name = Column(String, nullable=False)
    material = Column(String, nullable=False, default="softwood")
    stock_x = Column(Float, nullable=False, default=200.0)
    stock_y = Column(Float, nullable=False, default=150.0)
    stock_z = Column(Float, nullable=False, default=18.0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    layers = relationship("Layer", back_populates="project", cascade="all, delete-orphan",
                          order_by="Layer.order_index", lazy="selectin")


class Layer(Base):
    __tablename__ = "layers"
    id = Column(String, primary_key=True, default=_uuid)
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False, default="Layer")
    order_index = Column(Integer, nullable=False, default=0)
    tool_id = Column(String, nullable=True)
    operation = Column(String, nullable=False, default="profile_outside")
    params = Column(JSON, nullable=True, default=dict)
    gcode = Column(Text, nullable=True)
    is_complete = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    project = relationship("Project", back_populates="layers")
    entities = relationship("Entity", back_populates="layer", cascade="all, delete-orphan", lazy="selectin")


class Entity(Base):
    __tablename__ = "entities"
    id = Column(String, primary_key=True, default=_uuid)
    layer_id = Column(String, ForeignKey("layers.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String, nullable=False)  # line/rect/circle/arc/construction/bridge/dimension
    data = Column(JSON, nullable=False, default=dict)
    is_construction = Column(Boolean, nullable=False, default=False)
    layer = relationship("Layer", back_populates="entities")
