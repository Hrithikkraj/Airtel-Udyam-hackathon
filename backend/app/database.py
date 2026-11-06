"""Database connection. Every other file gets the database from here."""
import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker

BACKEND_DIR = Path(__file__).resolve().parent.parent

# SQLite is one local file. To move to PostgreSQL later, set DATABASE_URL.
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BACKEND_DIR / 'udyam.db'}")
IS_SQLITE = DATABASE_URL.startswith("sqlite")

engine = create_engine(
    DATABASE_URL,
    # FastAPI may use different threads for one request; SQLite blocks this by default.
    connect_args={"check_same_thread": False} if IS_SQLITE else {},
)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()


@event.listens_for(engine, "connect")
def turn_on_foreign_keys(connection, _record):
    # SQLite ignores foreign keys unless we ask for them on each connection.
    if IS_SQLITE:
        connection.execute("PRAGMA foreign_keys = ON")


# Columns added after the first release. create_all makes new tables but never changes
# existing ones, so these are added to an existing database without losing its data.
LATER_COLUMNS = [("businesses", "user_id", "INTEGER REFERENCES users(user_id)")]


def add_later_columns():
    with engine.begin() as connection:
        for table, column, column_type in LATER_COLUMNS:
            existing = {row[1] for row in connection.exec_driver_sql(f"PRAGMA table_info({table})")}
            if existing and column not in existing:
                connection.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {column} {column_type}")


def get_db():
    """Give one API request its own database session, and always close it."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
