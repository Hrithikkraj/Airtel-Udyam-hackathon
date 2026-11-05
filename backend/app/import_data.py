"""Load the hackathon CSV files into the database.

Run from the backend folder:  python -m app.import_data
It is safe to run again: it replaces the CSV data and keeps customer data.
"""
from pathlib import Path

import pandas as pd
from sqlalchemy import delete, func, select

from .database import Base, SessionLocal, engine
from .lead_score import add_scores
from .models import GstinRecord, Lead, Product, UdyamRecord

DATA_DIR = Path(__file__).resolve().parents[2] / "YTL_TrackA_Udyam_Digital_Data"

# These tables can be emptied and reloaded because nothing else points at them.
REPLACEABLE_TABLES = [
    ("smb_leads.csv", Lead),
    ("mock_gstin_registry.csv", GstinRecord),
    ("mock_udyam_registry.csv", UdyamRecord),
]


def import_products():
    # Saved quotes point at products, so update rows in place instead of deleting them.
    # dtype=str keeps a lone "1" as text, matching "1;2" in the other rows.
    table = pd.read_csv(DATA_DIR / "product_catalogue.csv", dtype={"available_city_tiers": str})
    rows = table.astype(object).where(table.notna(), None).to_dict("records")
    with SessionLocal() as db:
        for row in rows:
            db.merge(Product(**row))
        db.commit()


def import_replaceable_tables():
    # One transaction: if a file fails, the old data stays as it was.
    with engine.begin() as connection:
        for file_name, model in REPLACEABLE_TABLES:
            table = pd.read_csv(DATA_DIR / file_name)
            if model is Lead:
                table = add_scores(table)
            connection.execute(delete(model))
            table.to_sql(model.__tablename__, connection, if_exists="append", index=False)


def import_all():
    Base.metadata.create_all(engine)
    import_products()
    import_replaceable_tables()


def count_rows():
    with SessionLocal() as db:
        return {
            model.__tablename__: db.scalar(select(func.count()).select_from(model))
            for model in [Product, Lead, GstinRecord, UdyamRecord]
        }


if __name__ == "__main__":
    import_all()
    for table_name, row_count in count_rows().items():
        print(f"{table_name}: {row_count} rows")
