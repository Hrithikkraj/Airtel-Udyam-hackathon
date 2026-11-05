"""Test setup: use a throwaway database so tests never touch the real one."""
import os
import tempfile
from pathlib import Path

# This must run before any app code is imported, because database.py reads it on import.
test_db = Path(tempfile.mkdtemp()) / "test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{test_db}"
# Tests must never call the real LLM. An empty value also stops .env from setting it.
os.environ["GROQ_API_KEY"] = ""
os.environ["GROKE_API_KEY"] = ""

import pytest
from fastapi.testclient import TestClient

from app.import_data import import_all
from app.main import app


@pytest.fixture(scope="session", autouse=True)
def loaded_database():
    import_all()


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client
