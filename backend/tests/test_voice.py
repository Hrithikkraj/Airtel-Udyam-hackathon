"""Voice input for the advisor: the microphone recording becomes text the owner can check and send.

A fake speech server answers, so no API key or network is needed.
"""
import httpx
import pytest

from app import advisor, llm

WEBM = ("voice.webm", b"fake webm audio bytes", "audio/webm;codecs=opus")


@pytest.fixture
def fake_speech(monkeypatch):
    """Answer each transcription request with the next reply in the list, and record the requests."""
    requests = []

    def install(*replies):
        remaining = list(replies)

        def handle(request):
            requests.append({"url": str(request.url), "body": request.content, "auth": request.headers.get("authorization")})
            return remaining.pop(0)

        monkeypatch.setattr(llm, "make_client", lambda: httpx.Client(transport=httpx.MockTransport(handle)))
        monkeypatch.setenv("GROQ_API_KEY", "test-key")
        return requests

    return install


def heard(text):
    return httpx.Response(200, json={"text": text})


def test_speech_becomes_text_for_the_chat_box(client, fake_speech):
    requests = fake_speech(heard("  Meri Patna mein kirana dukaan hai  "))

    response = client.post("/api/advisor/transcribe", files={"audio": WEBM})

    assert response.status_code == 200
    assert response.json() == {"text": "Meri Patna mein kirana dukaan hai"}
    assert requests[0]["url"] == llm.TRANSCRIBE_URL
    assert requests[0]["auth"] == "Bearer test-key"
    body = requests[0]["body"]
    assert llm.VOICE_MODEL.encode() in body
    # The codec part of the type is dropped, and the service is told the format by the file ending.
    assert b'filename="voice.webm"' in body
    assert b"fake webm audio bytes" in body


def test_an_iphone_recording_is_sent_as_m4a(client, fake_speech):
    requests = fake_speech(heard("Hello"))
    response = client.post("/api/advisor/transcribe", files={"audio": ("voice.mp4", b"aac", "audio/mp4")})
    assert response.status_code == 200
    assert b'filename="voice.m4a"' in requests[0]["body"]


def test_a_rate_limit_moves_to_the_backup_voice_model(client, fake_speech):
    requests = fake_speech(httpx.Response(429, json={}), heard("Namaste"))
    response = client.post("/api/advisor/transcribe", files={"audio": WEBM})
    assert response.json() == {"text": "Namaste"}
    assert llm.VOICE_MODEL.encode() in requests[0]["body"]
    assert llm.BACKUP_VOICE_MODEL.encode() in requests[1]["body"]


def test_two_failures_give_a_clear_503(client, fake_speech):
    fake_speech(httpx.Response(500, json={}), httpx.Response(200, json={"no_text": True}))
    response = client.post("/api/advisor/transcribe", files={"audio": WEBM})
    assert response.status_code == 503


URDU_HELLO = "ہیلو کیسے ہو آپ"
HINDI_HELLO = "हैलो कैसे हो आप"


def test_hindi_speech_written_in_urdu_script_is_asked_for_again_as_hindi(client, fake_speech):
    requests = fake_speech(heard(URDU_HELLO), heard(HINDI_HELLO))
    response = client.post("/api/advisor/transcribe", files={"audio": WEBM}, data={"language": "English"})
    assert response.json() == {"text": HINDI_HELLO}
    # The first try lets the service find the language; the second names Hindi.
    assert b'name="language"' not in requests[0]["body"]
    assert b'name="language"\r\n\r\nhi\r\n' in requests[1]["body"]


def test_an_owner_chatting_in_urdu_keeps_urdu_script(client, fake_speech):
    requests = fake_speech(heard(URDU_HELLO))
    response = client.post("/api/advisor/transcribe", files={"audio": WEBM}, data={"language": "Urdu"})
    assert response.json() == {"text": URDU_HELLO}
    assert len(requests) == 1


def test_other_scripts_are_not_asked_for_again(client, fake_speech):
    requests = fake_speech(heard("எனக்கு ஒரு கடை இருக்கிறது"))
    client.post("/api/advisor/transcribe", files={"audio": WEBM}, data={"language": "Hindi"})
    assert len(requests) == 1


def test_if_the_hindi_retry_fails_the_first_text_is_kept(client, fake_speech):
    fake_speech(heard(URDU_HELLO), httpx.Response(500, json={}), httpx.Response(500, json={}))
    response = client.post("/api/advisor/transcribe", files={"audio": WEBM})
    assert response.status_code == 200
    assert response.json() == {"text": URDU_HELLO}


def test_a_long_transcript_is_cut_to_the_chat_limit(client, fake_speech):
    fake_speech(heard("a" * 5000))
    response = client.post("/api/advisor/transcribe", files={"audio": WEBM})
    assert len(response.json()["text"]) == advisor.MAX_TRANSCRIPT_CHARS


def test_without_an_api_key_voice_is_off(client):
    # conftest.py sets an empty key, as in a setup without the LLM.
    response = client.post("/api/advisor/transcribe", files={"audio": WEBM})
    assert response.status_code == 503


def test_voice_needs_a_signed_in_owner(anonymous, fake_speech):
    requests = fake_speech(heard("Hello"))
    response = anonymous.post("/api/advisor/transcribe", files={"audio": WEBM})
    assert response.status_code == 401
    assert requests == []


def test_files_that_are_not_audio_are_refused(client, fake_speech):
    requests = fake_speech(heard("Hello"))
    response = client.post("/api/advisor/transcribe", files={"audio": ("notes.txt", b"hello", "text/plain")})
    assert response.status_code == 415
    assert requests == []


def test_an_empty_recording_is_refused(client, fake_speech):
    requests = fake_speech(heard("Hello"))
    response = client.post("/api/advisor/transcribe", files={"audio": ("voice.webm", b"", "audio/webm")})
    assert response.status_code == 422
    assert requests == []


def test_an_oversized_recording_is_refused(client, fake_speech, monkeypatch):
    requests = fake_speech(heard("Hello"))
    monkeypatch.setattr(advisor, "MAX_VOICE_BYTES", 10)
    response = client.post("/api/advisor/transcribe", files={"audio": ("voice.webm", b"x" * 11, "audio/webm")})
    assert response.status_code == 413
    assert requests == []
