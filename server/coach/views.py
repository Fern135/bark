import hashlib
import json
import logging
import re
import time
from email.utils import parsedate_to_datetime
import urllib.error
import urllib.request

from django.conf import settings
from django.core.cache import cache
from django.http import JsonResponse
from django.views.decorators.http import require_POST

from lib.decorators import jwt_required
from .reference import INSTRUCTIONS

logger = logging.getLogger(__name__)
MAX_BYTES = 64 * 1024
SUGGESTION_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {"suggestion": {"anyOf": [
        {"type": "null"},
        {"type": "object", "additionalProperties": False,
         "properties": {
             "category": {"type": "string", "enum": ["bug", "improvement"]},
             "message": {"type": "string", "maxLength": 320},
             "issueKey": {"type": "string", "maxLength": 80},
             "line": {"type": ["integer", "null"]},
             "blockId": {"type": ["string", "null"]},
         }, "required": ["category", "message", "issueKey", "line", "blockId"]},
    ]}}, "required": ["suggestion"],
}


def failure(status, retry=120):
    response = JsonResponse({"error": "Byte hints are temporarily unavailable."}, status=status)
    response["Retry-After"] = str(retry)
    response["Cache-Control"] = "no-store"
    return response


def valid_body(body):
    if not isinstance(body, dict) or set(body) != {"revision", "snapshot", "dismissed"}:
        return False
    snapshot, dismissed = body["snapshot"], body["dismissed"]
    if not isinstance(body["revision"], str) or not 1 <= len(body["revision"]) <= 100:
        return False
    if not isinstance(snapshot, dict) or set(snapshot) != {"language", "python", "sourceMap", "blocks", "context", "diagnostics"}:
        return False
    if snapshot["language"] not in ("python", "blocks") or not isinstance(snapshot["python"], str):
        return False
    if not isinstance(snapshot["context"], dict) or not isinstance(snapshot["diagnostics"], list):
        return False
    blocks, mapping = snapshot["blocks"], snapshot["sourceMap"]
    if not isinstance(blocks, list) or not isinstance(mapping, dict):
        return False
    if any(not isinstance(b, dict) or not isinstance(b.get("id"), str) or not isinstance(b.get("label"), str) for b in blocks):
        return False
    ids = {b["id"] for b in blocks}
    if len(ids) != len(blocks):
        return False
    if any(not k.isdigit() or not 1 <= int(k) <= len(snapshot["python"].split("\n")) or not isinstance(v, str) or v not in ids for k, v in mapping.items()):
        return False
    if snapshot["language"] == "python" and (blocks or mapping):
        return False
    return isinstance(dismissed, list) and len(dismissed) <= 20 and all(
        isinstance(item, dict) and set(item) == {"issueKey", "message", "target"}
        and all(isinstance(v, str) and len(v) <= 400 for v in item.values()) for item in dismissed
    )


def checked_suggestion(result, snapshot):
    if not isinstance(result, dict) or set(result) != {"suggestion"}:
        raise ValueError("schema")
    suggestion = result["suggestion"]
    if suggestion is None:
        return None
    if not isinstance(suggestion, dict) or set(suggestion) != {"category", "message", "issueKey", "line", "blockId"}:
        raise ValueError("schema")
    if suggestion["category"] not in ("bug", "improvement"):
        raise ValueError("category")
    message, key = suggestion["message"], suggestion["issueKey"]
    if not isinstance(message, str) or not 1 <= len(message.strip()) <= 320 or "\n" in message:
        raise ValueError("message")
    if len(re.findall(r"[.!?](?:\s|$)", message)) > 2:
        raise ValueError("sentences")
    if not isinstance(key, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", key):
        raise ValueError("issue")
    line, block = suggestion["line"], suggestion["blockId"]
    if line is not None and (type(line) is not int or not 1 <= line <= len(snapshot["python"].split("\n"))):
        raise ValueError("line")
    if snapshot["language"] == "blocks":
        if not isinstance(block, str) or block not in {b["id"] for b in snapshot["blocks"]}:
            raise ValueError("block")
        if line is not None and snapshot["sourceMap"].get(str(line)) != block:
            raise ValueError("mapping")
    elif line is None or block is not None:
        raise ValueError("location")
    return suggestion


def call_openai(body):
    payload = {
        "model": settings.OPENAI_MODEL, "store": False,
        "reasoning": {"effort": "low"}, "max_output_tokens": 2000,
        "instructions": INSTRUCTIONS,
        "input": json.dumps({"snapshot": body["snapshot"], "dismissed": body["dismissed"]}),
        "text": {"format": {"type": "json_schema", "name": "byte_hint", "strict": True, "schema": SUGGESTION_SCHEMA}},
    }
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses", data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}", "Content-Type": "application/json"},
        method="POST",
    )
    # urllib performs no automatic provider retries. Never log the request or error body.
    with urllib.request.urlopen(request, timeout=20) as response:
        raw = response.read(256 * 1024 + 1)
    if len(raw) > 256 * 1024:
        raise ValueError("response_size")
    result = json.loads(raw)
    if result.get("status") != "completed":
        raise ValueError("incomplete")
    content = [part for item in result.get("output", []) if item.get("type") == "message" for part in item.get("content", [])]
    if any(part.get("type") == "refusal" for part in content):
        raise ValueError("refusal")
    output = "".join(part.get("text", "") for part in content if part.get("type") == "output_text")
    usage = result.get("usage", {})
    logger.info("byte_review tokens_in=%s tokens_out=%s", usage.get("input_tokens", 0), usage.get("output_tokens", 0))
    return json.loads(output)


@require_POST
@jwt_required(load_user=True)
def review(request):
    if not settings.BYTE_HINTS_ENABLED or not settings.OPENAI_API_KEY:
        return failure(503)
    try:
        if int(request.META.get("CONTENT_LENGTH") or 0) > MAX_BYTES or len(request.body) > MAX_BYTES:
            return failure(413)
        body = json.loads(request.body)
        if not valid_body(body):
            return failure(400)
    except (ValueError, UnicodeError, RecursionError):
        return failure(400)
    key = "byte-review:" + hashlib.sha256(request.user_id.encode()).hexdigest()
    try:
        if not cache.add(key, True, timeout=45):
            return failure(429, 45)
    except Exception:
        return failure(503)
    started = time.monotonic()
    try:
        suggestion = checked_suggestion(call_openai(body), body["snapshot"])
        if suggestion:
            target = suggestion["blockId"] or body["snapshot"]["python"].split("\n")[suggestion["line"] - 1].strip()[:400]
            if any(item["issueKey"] == suggestion["issueKey"] or (target and item["target"] == target) for item in body["dismissed"]):
                suggestion = None
        response = JsonResponse({"revision": body["revision"], "suggestion": suggestion})
        response["Cache-Control"] = "no-store"
        return response
    except urllib.error.HTTPError as error:
        retry = error.headers.get("Retry-After", "120") if error.headers else "120"
        try:
            retry = int(retry) if retry.isdigit() else int(parsedate_to_datetime(retry).timestamp() - time.time()) + 1
        except (ValueError, TypeError, OverflowError):
            retry = 120
        retry = max(120, min(retry, 86400))
        logger.warning("byte_review failure=provider_http status=%s", error.code)
        return failure(503, retry)
    except Exception as error:
        logger.warning("byte_review failure=%s", type(error).__name__)
        return failure(503)
    finally:
        logger.info("byte_review elapsed_ms=%d", (time.monotonic() - started) * 1000)
