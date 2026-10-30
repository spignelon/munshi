"""Groq wrapper: rate-limit aware chat / Whisper / vision.

Free-tier limits (developer-plan base, Oct 2026):
  gpt-oss-120b & qwen3.8-27b: 30 RPM, 1K RPD, 8K TPM, 200K TPD
  whisper-large-v3-turbo:     20 RPM, 2K RPD, 7.2K audio-sec/hour
We stay a little under: a sliding 60s window tracks requests and estimated
tokens, and calls wait (up to a few seconds) or raise GroqBusy instead of
hammering a 429. 429s are retried honouring retry-after.
"""
import base64
import json
import threading
import time
from collections import deque

from ..config import get_settings

PLANNER_MODEL = "openai/gpt-oss-120b"
STT_MODEL = "whisper-large-v3-turbo"
VISION_MODEL = "qwen/qwen3.8-27b"

# (requests/min, tokens/min) soft ceilings, ~85% of the real limits
SOFT_LIMITS = {
    PLANNER_MODEL: (25, 6800),
    VISION_MODEL: (25, 6800),
    STT_MODEL: (17, None),
}
MAX_WAIT_SECONDS = 12


class GroqBusy(Exception):
    def __init__(self, retry_after: int = 20, msg: str = ""):
        self.retry_after = retry_after
        super().__init__(msg or f"Munshi is busy right now (free-tier limit). Try again in ~{retry_after}s.")


class GroqUnavailable(Exception):
    pass


_lock = threading.Lock()
_events: dict[str, deque] = {m: deque() for m in SOFT_LIMITS}  # (ts, tokens)
last_quota: dict[str, dict] = {}  # model -> last seen x-ratelimit-* headers


def _prune(model: str, now: float):
    q = _events[model]
    while q and now - q[0][0] > 60:
        q.popleft()


def _acquire(model: str, est_tokens: int) -> list:
    """Reserve capacity in the sliding window; returns the event record (mutable) for later correction."""
    rpm, tpm = SOFT_LIMITS[model]
    deadline = time.time() + MAX_WAIT_SECONDS
    while True:
        with _lock:
            now = time.time()
            _prune(model, now)
            q = _events[model]
            used_tokens = sum(t for _, t in q)
            over_req = len(q) >= rpm
            over_tok = tpm is not None and used_tokens + est_tokens > tpm and len(q) > 0
            if not over_req and not over_tok:
                rec = [now, est_tokens]
                q.append(rec)
                return rec
            wait = max(0.5, 60 - (now - q[0][0])) if q else 1
        if time.time() + wait > deadline:
            raise GroqBusy(retry_after=int(wait) + 1)
        time.sleep(min(wait, 2))


def usage_snapshot() -> dict:
    now = time.time()
    out = {}
    with _lock:
        for m, (rpm, tpm) in SOFT_LIMITS.items():
            _prune(m, now)
            q = _events[m]
            out[m] = {
                "requests_last_min": len(q),
                "tokens_last_min": sum(t for _, t in q),
                "soft_rpm": rpm,
                "soft_tpm": tpm,
                **last_quota.get(m, {}),
            }
    return out


def _client():
    from groq import Groq

    key = get_settings().groq_api_key
    if not key:
        raise GroqUnavailable("GROQ_API_KEY is not configured on the server.")
    return Groq(api_key=key, max_retries=0, timeout=40)


def _record_headers(model: str, headers) -> None:
    keep = {}
    for k in ("x-ratelimit-remaining-requests", "x-ratelimit-remaining-tokens", "x-ratelimit-limit-requests", "x-ratelimit-limit-tokens"):
        if headers and k in headers:
            keep[k.replace("x-ratelimit-", "").replace("-", "_")] = headers[k]
    if keep:
        last_quota[model] = keep


def _call_with_retry(model: str, est_tokens: int, fn):
    from groq import APIConnectionError, APIStatusError, RateLimitError

    rec = _acquire(model, est_tokens)
    for attempt in range(3):
        try:
            raw = fn()
            _record_headers(model, raw.headers)
            return raw.parse(), rec
        except RateLimitError as e:
            retry = 5
            try:
                retry = int(float(e.response.headers.get("retry-after", 5)))
            except Exception:
                pass
            if attempt == 2 or retry > MAX_WAIT_SECONDS:
                raise GroqBusy(retry_after=max(retry, 5))
            time.sleep(retry + 0.5)
        except APIConnectionError:
            if attempt == 2:
                raise GroqUnavailable("Could not reach Groq. Check network / API key.")
            time.sleep(1.5)
        except APIStatusError as e:
            if e.status_code >= 500 and attempt < 2:
                time.sleep(1.5)
                continue
            raise GroqUnavailable(f"Groq error {e.status_code}: {str(e)[:200]}")
    raise GroqUnavailable("Groq call failed")


def _est(messages: list, max_tokens: int) -> int:
    chars = sum(len(m["content"]) if isinstance(m["content"], str) else 400 for m in messages)
    return int(chars / 3.2) + int(max_tokens * 0.7)


def chat(messages: list, *, purpose: str, model: str = PLANNER_MODEL, json_mode: bool = False,
         max_tokens: int = 900, temperature: float = 0.3) -> str:
    if get_settings().groq_fake:
        from . import groq_fake
        return groq_fake.fake_chat(purpose, messages)

    kwargs = dict(model=model, messages=messages, temperature=temperature, max_completion_tokens=max_tokens)
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    if model == PLANNER_MODEL:
        kwargs["reasoning_effort"] = "low"
        kwargs["include_reasoning"] = False
    client = _client()
    resp, rec = _call_with_retry(model, _est(messages, max_tokens), lambda: client.chat.completions.with_raw_response.create(**kwargs))
    try:
        rec[1] = resp.usage.total_tokens  # correct the estimate with real usage
    except Exception:
        pass
    return (resp.choices[0].message.content or "").strip()


def chat_json(messages: list, *, purpose: str, model: str = PLANNER_MODEL, max_tokens: int = 900) -> dict:
    text = chat(messages, purpose=purpose, model=model, json_mode=True, max_tokens=max_tokens)
    try:
        return _loads(text)
    except ValueError:
        repair = messages + [{"role": "assistant", "content": text[:1500]},
                             {"role": "user", "content": "That was not valid JSON. Reply with ONLY the JSON object."}]
        return _loads(chat(repair, purpose=purpose, model=model, json_mode=True, max_tokens=max_tokens))


def _loads(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[text.find("{"):]
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        raise ValueError("no json")
    return json.loads(text[start:end + 1])


def transcribe(audio: bytes, filename: str = "audio.webm", language: str = "hi") -> str:
    if get_settings().groq_fake:
        from . import groq_fake
        return groq_fake.fake_transcribe(audio)
    client = _client()
    resp, _ = _call_with_retry(
        STT_MODEL, 0,
        lambda: client.audio.transcriptions.with_raw_response.create(
            file=(filename, audio), model=STT_MODEL, language=language, temperature=0,
            response_format="json",
        ),
    )
    return (resp.text or "").strip()


def vision_json(image: bytes, mime: str, prompt: str, max_tokens: int = 1500) -> dict:
    if get_settings().groq_fake:
        from . import groq_fake
        return groq_fake.fake_chat("ocr", [])
    data_url = f"data:{mime};base64,{base64.b64encode(image).decode()}"
    messages = [{"role": "user", "content": [
        {"type": "text", "text": prompt},
        {"type": "image_url", "image_url": {"url": data_url}},
    ]}]
    client = _client()
    kwargs = dict(model=VISION_MODEL, messages=messages, temperature=0, max_completion_tokens=max_tokens,
                  response_format={"type": "json_object"})
    resp, rec = _call_with_retry(VISION_MODEL, 1500 + max_tokens // 2, lambda: client.chat.completions.with_raw_response.create(**kwargs))
    try:
        rec[1] = resp.usage.total_tokens
    except Exception:
        pass
    return _loads(resp.choices[0].message.content or "")
