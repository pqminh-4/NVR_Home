"""SQLite + SQLModel."""
from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine

from .config import settings

engine = create_engine(
    f"sqlite:///{settings.db_path}",
    connect_args={"check_same_thread": False},
)


@event.listens_for(Engine, "connect")
def _set_sqlite_pragma(dbapi_conn, _record):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


def init_db() -> None:
    # import để đăng ký bảng với metadata
    from . import models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    _migrate()


# Cột thêm sau này cho bảng đã tồn tại — create_all không ALTER bảng cũ
_MIGRATIONS: dict[str, dict[str, str]] = {
    "camera": {
        "res_main": "VARCHAR NOT NULL DEFAULT ''",
        "res_sub": "VARCHAR NOT NULL DEFAULT ''",
    },
}


def _migrate() -> None:
    with engine.begin() as conn:
        for table, columns in _MIGRATIONS.items():
            existing = {row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")}
            for name, ddl in columns.items():
                if name not in existing:
                    conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")


def get_session() -> Session:
    with Session(engine) as session:
        yield session
