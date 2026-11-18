"""Setup SQLite asincrono (SQLAlchemy + aiosqlite)."""
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base

from config import DATA_DIR

DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "projects.db"
DATABASE_URL = f"sqlite+aiosqlite:///{DB_PATH}"

engine = create_async_engine(DATABASE_URL, echo=False, future=True)


@event.listens_for(engine.sync_engine, "connect")
def _enable_fk(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
Base = declarative_base()


LAYER_CUT_COLUMNS = {
    "tool_diameter": "FLOAT NOT NULL DEFAULT 3.175",
    "tool_type": "VARCHAR NOT NULL DEFAULT 'flat'",
    "feed_rate": "FLOAT NOT NULL DEFAULT 600.0",
    "spindle_rpm": "INTEGER NOT NULL DEFAULT 12000",
    "z_safe": "FLOAT NOT NULL DEFAULT 5.0",
    "z_depth": "FLOAT NOT NULL DEFAULT -2.0",
    "z_pass_depth": "FLOAT NOT NULL DEFAULT 1.0",
}


async def init_db() -> None:
    import models  # noqa: F401  (registra i modelli)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # migrazioni leggere (colonne aggiunte dopo la prima versione)
        cols = {r[1] for r in (await conn.exec_driver_sql("PRAGMA table_info(layers)")).fetchall()}
        if "draw_layers" not in cols:
            await conn.exec_driver_sql("ALTER TABLE layers ADD COLUMN draw_layers JSON")
        # parametri di taglio per layer: aggiunti senza perdere i progetti esistenti
        for name, ddl in LAYER_CUT_COLUMNS.items():
            if name not in cols:
                await conn.exec_driver_sql(f"ALTER TABLE layers ADD COLUMN {name} {ddl}")


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
