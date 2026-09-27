import base64
import binascii
import json
import struct

from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods

from canvas.document import to_document
from canvas.models import Game
from lib.decorators import jwt_required, rate_limit
from .models import Publication


def state(game):
    publication = getattr(game, "publication", None)
    return {"is_public": bool(publication and publication.is_public),
            "published_at": publication.published_at.isoformat() if publication and publication.published_at else None}


def summary(publication):
    game = publication.game
    return {"id": str(game.pk), "name": game.name, "creator": game.owner.username,
            "revision": game.revision, "published_at": publication.published_at.isoformat(),
            "updated_at": game.updated_at.isoformat(),
            "cover_url": f"/api/marketplace/games/{game.pk}/cover/" if publication.cover_revision is not None else None}


def missing():
    return JsonResponse({"error": "Game not found"}, status=404)


@never_cache
@require_http_methods(["GET"])
def games(request):
    try:
        page = max(1, int(request.GET.get("page", "1")))
    except ValueError:
        return JsonResponse({"error": "Invalid page"}, status=400)
    query = request.GET.get("q", "").strip()[:200]
    rows = Publication.objects.filter(is_public=True).select_related("game__owner").defer("cover")
    if query:
        rows = rows.filter(Q(game__name__icontains=query) | Q(game__owner__username__icontains=query))
    rows = rows.order_by("-published_at", "game_id")
    count = rows.count()
    offset = (page - 1) * 24
    return JsonResponse({"games": [summary(row) for row in rows[offset:offset + 24]],
                         "count": count, "page": page, "has_more": offset + 24 < count})


@never_cache
@require_http_methods(["GET"])
def detail(request, game_id):
    # All document writers lock this same row, including collaboration operations.
    with transaction.atomic():
        game = Game.objects.select_for_update().filter(pk=game_id).first()
        if game is None:
            return missing()
        publication = Publication.objects.filter(game=game, is_public=True).first()
        if publication is None:
            return missing()
        publication.game = game
        return JsonResponse({**summary(publication), "document": to_document(game)})


@never_cache
@require_http_methods(["GET", "PUT"])
@jwt_required
@rate_limit("publishing", key=lambda request: request.user_id, limit=60, window=60)
def publication(request, game_id):
    with transaction.atomic():
        game = Game.objects.select_for_update().filter(pk=game_id, owner_id=request.user_id).first()
        if game is None:
            return missing()
        if request.method == "PUT":
            if request.headers.get("X-Bark-Owner", request.user_id) != request.user_id:
                return JsonResponse({"error": "The signed-in account changed."}, status=401)
            try:
                body = json.loads(request.body)
            except (ValueError, UnicodeDecodeError):
                body = None
            if not isinstance(body, dict) or type(body.get("is_public")) is not bool:
                return JsonResponse({"error": "is_public must be a boolean"}, status=400)
            row, _ = Publication.objects.get_or_create(game=game)
            row.is_public = body["is_public"]
            if row.is_public and row.published_at is None:
                row.published_at = timezone.now()
            row.save()
            game.publication = row
        return JsonResponse({**state(game), "id": str(game.pk)})


@jwt_required
@rate_limit("publishing", key=lambda request: request.user_id, limit=60, window=60)
def save_cover(request, game_id):
    try:
        body = json.loads(request.body)
        data = base64.b64decode(body["png"], validate=True)
        if len(data) > 400_000 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
            raise ValueError()
        width, height = struct.unpack(">II", data[16:24])
        if not 0 < width <= 800 or not 0 < height <= 600 or type(body["revision"]) is not int:
            raise ValueError()
    except (ValueError, KeyError, TypeError, binascii.Error, struct.error):
        return JsonResponse({"error": "Invalid cover"}, status=400)
    with transaction.atomic():
        game = Game.objects.select_for_update().filter(pk=game_id, owner_id=request.user_id).first()
        if game is None:
            return missing()
        row = Publication.objects.filter(game=game, is_public=True).first()
        if row is None or game.revision != body["revision"]:
            return JsonResponse({"error": "The game changed. Cover ignored."}, status=409)
        row.cover, row.cover_revision = data, game.revision
        row.save(update_fields=["cover", "cover_revision"])
    return HttpResponse(status=204)


@never_cache
@require_http_methods(["GET", "PUT"])
def cover(request, game_id):
    if request.method == "PUT":
        return save_cover(request, game_id)
    row = Publication.objects.filter(game_id=game_id, is_public=True).only("cover").first()
    if row is None or not row.cover:
        return missing()
    response = HttpResponse(bytes(row.cover), content_type="image/png")
    response["X-Content-Type-Options"] = "nosniff"
    return response
