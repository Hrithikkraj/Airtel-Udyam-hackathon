"""Run llm.ask against a fake server, so no API key or network is needed."""
import json

import httpx
import pytest

from app import llm
from app.explain import ExplanationText
from app.schemas import AdvisorTurn


def api_reply(text):
    return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": text}}]})


@pytest.fixture
def fake_server(monkeypatch):
    """Answer each LLM request with the next reply in the list, and record the requests."""
    requests = []

    def install(*replies):
        remaining = list(replies)

        def handle(request):
            requests.append({"body": json.loads(request.content), "auth": request.headers.get("authorization")})
            return remaining.pop(0)

        monkeypatch.setattr(llm, "make_client", lambda: httpx.Client(transport=httpx.MockTransport(handle)))
        monkeypatch.setenv("GROQ_API_KEY", "test-key")
        return requests

    return install


MESSAGES = [{"role": "user", "content": "I run a kirana"}]


def test_a_valid_answer_is_returned_as_a_checked_object(fake_server):
    answer = {"reply": "How many people work there?", "needs": ["internet"]}
    requests = fake_server(api_reply(json.dumps(answer)))

    turn = llm.ask("system text", MESSAGES, AdvisorTurn)

    assert isinstance(turn, AdvisorTurn)
    assert turn.needs == ["internet"]
    assert requests[0]["auth"] == "Bearer test-key"
    assert requests[0]["body"]["model"] == llm.MODEL
    assert requests[0]["body"]["messages"][0] == {"role": "system", "content": "system text"}
    assert requests[0]["body"]["messages"][1] == MESSAGES[0]


def test_the_shape_sent_to_the_llm_only_allows_our_needs(fake_server):
    requests = fake_server(api_reply(json.dumps({"reply": "ok"})))
    llm.ask("system", MESSAGES, AdvisorTurn)
    shape = requests[0]["body"]["response_format"]["json_schema"]["schema"]
    assert "whatsapp" in json.dumps(shape)
    assert "free_laptop" not in json.dumps(shape)


def test_a_malformed_answer_is_asked_again_on_the_backup_model(fake_server):
    requests = fake_server(api_reply("not json"), api_reply(json.dumps({"explanation": "Fine."})))
    assert llm.ask("system", MESSAGES, ExplanationText).explanation == "Fine."
    assert [request["body"]["model"] for request in requests] == [llm.MODEL, llm.BACKUP_MODEL]


def test_a_rate_limit_moves_to_the_backup_model(fake_server):
    requests = fake_server(httpx.Response(429, json={}), api_reply(json.dumps({"explanation": "Fine."})))
    assert llm.ask("system", MESSAGES, ExplanationText).explanation == "Fine."
    assert len(requests) == 2


def test_two_malformed_answers_trigger_the_fallback(fake_server):
    fake_server(api_reply("not json"), api_reply("still not json"))
    with pytest.raises(llm.LLMUnavailable):
        llm.ask("system", MESSAGES, ExplanationText)


def test_an_invented_need_in_the_answer_triggers_the_fallback(fake_server):
    bad = json.dumps({"reply": "ok", "needs": ["free_laptop"]})
    fake_server(api_reply(bad), api_reply(bad))
    with pytest.raises(llm.LLMUnavailable):
        llm.ask("system", MESSAGES, AdvisorTurn)


@pytest.mark.parametrize("status", [401, 429, 500])
def test_api_errors_trigger_the_fallback(fake_server, status):
    fake_server(httpx.Response(status, json={"error": "no"}), httpx.Response(status, json={"error": "no"}))
    with pytest.raises(llm.LLMUnavailable):
        llm.ask("system", MESSAGES, ExplanationText)


def test_an_empty_answer_triggers_the_fallback(fake_server):
    empty = httpx.Response(200, json={"choices": []})
    fake_server(empty, empty)
    with pytest.raises(llm.LLMUnavailable):
        llm.ask("system", MESSAGES, ExplanationText)


def test_a_failed_call_never_exposes_the_customers_text(fake_server):
    fake_server(httpx.Response(500, json={}), httpx.Response(500, json={}))
    with pytest.raises(llm.LLMUnavailable) as caught:
        llm.ask("system", [{"role": "user", "content": "my secret text"}], ExplanationText)
    assert "secret" not in str(caught.value)
