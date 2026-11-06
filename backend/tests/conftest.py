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

import uuid

import pytest
from fastapi.testclient import TestClient

from app.import_data import import_all
from app.main import app


@pytest.fixture(scope="session", autouse=True)
def loaded_database():
    import_all()


# Our cookies are Secure, so test browsers use HTTPS. They also send the CSRF header our pages send.
TEST_BASE_URL = "https://testserver"
CSRF_HEADERS = {"X-Accel-CSRF": "1"}


@pytest.fixture
def client():
    """A browser with a newly signed-in owner, as the main journey needs one."""
    with TestClient(app, base_url=TEST_BASE_URL, headers=CSRF_HEADERS) as test_client:
        details = {"full_name": "Test Owner", "email": f"owner-{uuid.uuid4().hex[:10]}@example.com", "password": "correct horse 42"}
        assert test_client.post("/api/account/signup", json=details).status_code == 201
        yield test_client


@pytest.fixture
def anonymous():
    """A browser nobody has signed in on, with no cookies. Used to prove access is refused."""
    with TestClient(app, base_url=TEST_BASE_URL, headers=CSRF_HEADERS) as test_client:
        yield test_client
