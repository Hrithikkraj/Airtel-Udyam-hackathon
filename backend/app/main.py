"""Starts the API. Run from the backend folder:  uvicorn app.main:app --reload"""
from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import accounts, advisor, bundles, callbacks, catalogue, kyc, orders, quotes, staff
from .database import Base, add_later_columns, engine


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(engine)
    add_later_columns()
    yield


app = FastAPI(title="Accel Business: Udyam Digital", lifespan=lifespan)
app.include_router(catalogue.router)
app.include_router(bundles.router)
app.include_router(quotes.router)
app.include_router(advisor.router)
app.include_router(kyc.router)
app.include_router(orders.router)
app.include_router(callbacks.router)
app.include_router(staff.router)
app.include_router(accounts.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
