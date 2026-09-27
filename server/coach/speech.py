"""Short, authenticated Byte tips voiced by ElevenLabs; credentials stay here."""
import hashlib
import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings
from django.core.cache import cache
from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_POST

from lib.decorators import jwt_required

logger = logging.getLogger(__name__)
MAX_TEXT = 800
MAX_AUDIO = 2 * 1024 * 1024


def failure(status, message="Byte’s voice is temporarily unavailable.", retry=None):
    response = JsonResponse({"error": message}, status=status)
    response["Cache-Control"] = "no-store"
    if retry is not None:
        response["Retry-After"] = str(retry)
    return response


def synthesize(text):
    voice = urllib.parse.quote(settings.ELEVENLABS_VOICE_ID, safe="")
    request = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128",
        data=json.dumps({"text": text, "model_id": settings.ELEVENLABS_MODEL_ID}).encode(),
        headers={"xi-api-key": settings.ELEVENLABS_API_KEY,
                 "Content-Type": "application/json", "Accept": "audio/mpeg"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as upstream:
        audio = upstream.read(MAX_AUDIO + 1)
        if upstream.headers.get_content_type() != "audio/mpeg" or not 1 <= len(audio) <= MAX_AUDIO:
            raise ValueError("invalid_audio")
        return audio


@require_POST
@jwt_required(load_user=True)
def speech(request):
    if len(request.body) > 8192:
        return failure(413, "Speech request is too large.")
    try:
        body = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        return failure(400, "Send a short Byte tip as text.")
    if (not isinstance(body, dict) or set(body) != {"text"}
            or not isinstance(body["text"], str) or not 1 <= len(body["text"].strip()) <= MAX_TEXT):
        return failure(400, "Send a Byte tip of 1 to 800 characters.")
    if not settings.BYTE_VOICE_ENABLED or not settings.ELEVENLABS_API_KEY:
        return failure(503, retry=120)

    user_key = hashlib.sha256(str(request.user_id).encode()).hexdigest()
    lock = f"byte-speech:pending:{user_key}"
    if not cache.add(lock, True, timeout=30):
        return failure(429, retry=5)
    try:
        now = int(time.time())
        budget = f"byte-speech:budget:{user_key}:{now // 60}"
        # Reserve before calling the provider, including failed requests.
        cache.add(budget, 0, timeout=65)
        if cache.incr(budget) > 6:
            return failure(429, retry=60 - now % 60)
        audio = synthesize(body["text"].strip())
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        # Never log the child's tip, API key, or upstream response body.
        logger.warning("byte_speech_unavailable")
        return failure(503, retry=120)
    finally:
        cache.delete(lock)
    response = HttpResponse(audio, content_type="audio/mpeg")
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response
