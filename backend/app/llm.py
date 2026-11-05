"""The only file that talks to the LLM. To change provider, change this file.

With no API key the app still works: the customer gets the guided form and a
plain explanation written by our own code.

To turn the LLM on, put this line in backend/.env, which git ignores:  GROQ_API_KEY=your-key
"""
import json
import os
from typing import TypeVar

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel, ValidationError

load_dotenv()

API_URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL = os.getenv("LLM_MODEL", "openai/gpt-oss-120b")
# If the first model fails or hits its rate limit, the second has its own separate limit.
BACKUP_MODEL = os.getenv("LLM_BACKUP_MODEL", "openai/gpt-oss-20b")
TIMEOUT_SECONDS = 20

ResponseShape = TypeVar("ResponseShape", bound=BaseModel)


class LLMUnavailable(Exception):
    """The LLM could not give a usable answer. Callers must fall back, never crash."""


def api_key() -> str:
    return os.getenv("GROQ_API_KEY") or os.getenv("GROKE_API_KEY") or ""


def is_available() -> bool:
    return bool(api_key())


def make_client() -> httpx.Client:
    return httpx.Client(timeout=TIMEOUT_SECONDS)


def ask(system: str, messages: list[dict], response_shape: type[ResponseShape]) -> ResponseShape:
    """Ask the LLM and return an answer that is checked against response_shape."""
    if not is_available():
        raise LLMUnavailable("No API key is set")

    request = {
        "messages": [{"role": "system", "content": system}, *messages],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": response_shape.__name__, "schema": response_shape.model_json_schema()},
        },
        "reasoning_effort": "low",  # Short questions do not need deep thinking.
        "max_completion_tokens": 1500,
    }
    headers = {"Authorization": f"Bearer {api_key()}"}

    last_problem = "No answer"
    with make_client() as client:
        for model in [MODEL, BACKUP_MODEL]:
            try:
                response = client.post(API_URL, json={**request, "model": model}, headers=headers)
                response.raise_for_status()
                content = response.json()["choices"][0]["message"]["content"]
                return response_shape.model_validate(json.loads(content))
            # Only the error type is kept, so customer text can never reach the logs.
            except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError, ValidationError) as error:
                last_problem = type(error).__name__
    raise LLMUnavailable(last_problem)
