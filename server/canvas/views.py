"""Game library API, mounted at /api/canvas/ (see canvas/urls.py and API.md).

Every view:
  - needs the login JWT       @jwt_required  (lib/decorators/jwt_required.py)
  - is rate limited per user  @rate_limit    (CANVAS_REQUESTS_PER_MINUTE, shared by all canvas views)
  - only sees the caller's own games (canvas/access.py); anyone else's game is a 404

Writes run in a transaction that locks the game row, so two saves to the same game (two
tabs, autosave + manual save) apply one after the other. Every successful write returns the
game's new `revision`.
"""
import json
import uuid

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Max
from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_http_methods

from lib.decorators import jwt_required, rate_limit

from .access import games_for, get_game
from .defaults import new_game_document
from .document import (
    LIBRARIES,
    MAX_ENTITIES,
    MAX_LIBRARY_ITEMS,
    DocumentError,
    descendants_of,
    entity_fields,
    entity_to_json,
    save_document,
    script_fields,
    script_to_json,
    to_document,
    validate_document,
    validate_entity,
    validate_hierarchy,
    validate_input,
    validate_library_item,
    validate_name,
    validate_object,
    validate_script,
)
from .models import Entity, Game

MAX_GAMES_PER_USER = 100

# One shared budget per user for every canvas endpoint.
CANVAS_RATE_LIMIT = {
    "key": lambda request: request.user_id,  # set by @jwt_required, which runs first
    "limit": settings.CANVAS_REQUESTS_PER_MINUTE,
    "window": 60,
    "message": "Too many requests. Slow down and try again in a minute.",
}


# ---- helpers ------------------------------------------------------------------------------

def _json_body(request):
    """Parsed JSON body, or None if it isn't valid JSON."""
    try:
        return json.loads(request.body or b"null")
    except (ValueError, UnicodeDecodeError):
        return None


def _error(message, status=400):
    return JsonResponse({"error": message}, status=status)


def _not_found(what="Game"):
    return _error(f"{what} not found", status=404)


def _summary(game, user_id=None):
    publication = getattr(game, "publication", None)
    return {
        "publication": {"is_public": bool(publication and publication.is_public)},
        "id": str(game.id),
        "owner": {"user": game.owner_id, "name": game.owner.username},
        "role": "owner" if user_id in (None, game.owner_id) else "editor",
        "collaboration": game.collaboration,
        "name": game.name,
        "revision": game.revision,
        "created_at": game.created_at.isoformat(),
        "updated_at": game.updated_at.isoformat(),
    }


def _detail(game, user_id=None):
    return {**_summary(game, user_id), "document": to_document(game)}


# ---- games --------------------------------------------------------------------------------

# GET  /api/canvas/games/   list my games
# POST /api/canvas/games/   create a game
@require_http_methods(["GET", "POST"])
@jwt_required(load_user=True)
@rate_limit("canvas", **CANVAS_RATE_LIMIT)
def games(request):
    """
    GET  -> 200 {"games": [{"id", "name", "revision", "created_at", "updated_at"}, ...]}  newest first
    POST body (all optional): {"name": "My Game", "document": {<GameDocument>}}
         Without "document" the game starts from canvas/defaults.py. "name" overrides project.name.
         -> 201 {<game summary>, "document": {...}}
         -> 400 invalid document or name, or the user already has MAX_GAMES_PER_USER games
    """
    if request.method == "GET":
        return JsonResponse({"games": [_summary(g, request.user_id) for g in games_for(request.user_id).select_related("owner", "publication")]})
    if request.headers.get("X-Bark-Owner", request.user_id) != request.user_id:
        return _error("The signed-in account changed. Sign in to the original account to save.", 401)

    body = _json_body(request)
    body = {} if body is None and not request.body else body
    if not isinstance(body, dict):
        return _error("Body must be a JSON object")

    try:
        game_id = uuid.UUID(str(body["id"])) if "id" in body else uuid.uuid4()
    except (ValueError, TypeError, AttributeError):
        return _error("id must be a UUID")

    try:
        name = validate_name(body["name"]) if "name" in body else None
        document = body.get("document") or new_game_document(name)
        if name:
            validate_object(document, "document")
            validate_object(document.get("project"), "project")
            document["project"]["name"] = name
        validate_document(document)
    except DocumentError as exc:
        return _error(str(exc))

    with transaction.atomic():
        # Serialise creates for this owner, including a retried first autosave.
        type(request.jwt_user).objects.select_for_update().get(pk=request.jwt_user.pk)
        existing = Game.objects.select_for_update().filter(pk=game_id).first()
        if existing:
            return JsonResponse(_detail(existing)) if existing.owner_id == request.user_id else _error("Game id unavailable", 409)
        if Game.objects.filter(owner_id=request.user_id).count() >= MAX_GAMES_PER_USER:
            return _error(f"You can have at most {MAX_GAMES_PER_USER} games")
        try:
            with transaction.atomic():
                game = Game.objects.create(id=game_id, owner=request.jwt_user, name=document["project"]["name"])
        except IntegrityError:
            return _error("Game id unavailable", 409)
        save_document(game, document)
        return JsonResponse(_detail(game, request.user_id), status=201)


# GET    /api/canvas/games/<id>/   the whole game
# PUT    /api/canvas/games/<id>/   replace the whole document
# PATCH  /api/canvas/games/<id>/   rename
# DELETE /api/canvas/games/<id>/   delete
@require_http_methods(["GET", "PUT", "PATCH", "DELETE"])
@jwt_required
@rate_limit("canvas", **CANVAS_RATE_LIMIT)
def game_detail(request, game_id):
    """
    GET    -> 200 {<game summary>, "document": {<GameDocument>}}
    PUT    body: {<GameDocument>}  -> 200 same as GET
    PATCH  body: {"name": "New name"} -> 200 same as GET
    DELETE -> 204 (the game and all its sections)
    404 if the game doesn't exist or isn't yours.
    """
    if request.method != "GET" and request.headers.get("X-Bark-Owner", request.user_id) != request.user_id:
        return _error("The signed-in account changed. Sign in to the original account to save.", 401)
    if request.method == "GET":
        with transaction.atomic():
            game = get_game(request.user_id, game_id, for_update=True)
            return JsonResponse(_detail(game, request.user_id)) if game else _not_found()

    body = _json_body(request) if request.method in ("PUT", "PATCH") else None
    with transaction.atomic():
        game = get_game(request.user_id, game_id, for_update=True)
        if game is None:
            return _not_found()
        if request.method in ("PATCH", "DELETE") and game.owner_id != request.user_id:
            return _error("Only the owner can rename or delete this workspace", 403)
        if game.collaboration and request.method == "PUT":
            return _error("This workspace uses live editing. Reopen it to connect.", 409)

        expected = request.headers.get("If-Match")
        if expected is not None:
            digits = expected[1:-1]
            if not (expected.startswith('"') and expected.endswith('"') and digits.isascii() and digits.isdigit() and len(digits) <= 10):
                return _error('If-Match must be a quoted revision')
            if int(digits) != game.revision:
                return JsonResponse({"error": "This game changed in another tab.", "revision": game.revision}, status=412)

        if request.method == "DELETE":
            game.delete()
            return HttpResponse(status=204)

        try:
            if request.method == "PUT":
                save_document(game, body)
            else:
                _require_object(body)
                game.name = validate_name(body.get("name"))
                game.save(update_fields=["name", "updated_at"])
                game.touch()
        except DocumentError as exc:
            transaction.set_rollback(True)
            return _error(str(exc))
        return JsonResponse(_detail(game, request.user_id))


def _require_object(body):
    if not isinstance(body, dict):
        raise DocumentError("Body must be a JSON object")


# ---- one-per-game sections ------------------------------------------------------------------

def _read_section(game, section):
    if section == "script":
        return script_to_json(game.script)
    if section == "properties":
        return game.properties
    return getattr(game, section).data  # settings, cameras, input


def _write_section(game, section, value):
    if section == "script":
        validate_script(value)
        for field, field_value in script_fields(value).items():
            setattr(game.script, field, field_value)
        game.script.save()
    elif section == "properties":
        game.properties = validate_object(value, "properties")
        game.save(update_fields=["properties", "updated_at"])
    elif section == "input":
        game.input.data = validate_input(value)
        game.input.save()
    else:  # settings, cameras
        row = getattr(game, section)
        row.data = validate_object(value, section)
        row.save()


# GET/PUT /api/canvas/games/<id>/{settings,cameras,input,properties,script}/
@require_http_methods(["GET", "PUT"])
@jwt_required
@rate_limit("canvas", **CANVAS_RATE_LIMIT)
def section(request, game_id, section):
    """
    GET -> 200 {"revision": n, "<section>": {...}}
    PUT body: the section's new value (the whole object; e.g. all of settings)
        -> 200 {"revision": n, "<section>": {...}}   400 if invalid
    """
    if request.method == "GET":
        game = get_game(request.user_id, game_id)
        if game is None:
            return _not_found()
        if game.collaboration and request.method != "GET":
            return _error("This workspace uses live editing. Reopen it to connect.", 409)
        return JsonResponse({"revision": game.revision, section: _read_section(game, section)})

    value = _json_body(request)
    with transaction.atomic():
        game = get_game(request.user_id, game_id, for_update=True)
        if game is None:
            return _not_found()
        if game.collaboration and request.method != "GET":
            return _error("This workspace uses live editing. Reopen it to connect.", 409)
        try:
            _write_section(game, section, value)
        except DocumentError as exc:
            transaction.set_rollback(True)
            return _error(str(exc))
        game.touch()
    return JsonResponse({"revision": game.revision, section: _read_section(game, section)})


# ---- entities -----------------------------------------------------------------------------

def _check_parent(game, entity_id, parent_id):
    """Raise DocumentError unless giving `entity_id` this parent keeps the hierarchy valid."""
    parents = dict(game.entities.values_list("item_id", "parent_id"))
    parents[entity_id] = parent_id
    validate_hierarchy(parents)


# GET  /api/canvas/games/<id>/entities/   all entities, in order
# POST /api/canvas/games/<id>/entities/   add an entity at the end
@require_http_methods(["GET", "POST"])
@jwt_required
@rate_limit("canvas", **CANVAS_RATE_LIMIT)
def entities(request, game_id):
    """
    GET  -> 200 {"revision": n, "entities": [{...}, ...]}
    POST body: {<entity>} with a new "id" and a "transform"
         -> 201 {"revision": n, "entity": {...}}   400 invalid   409 id already used
    """
    if request.method == "GET":
        game = get_game(request.user_id, game_id)
        if game is None:
            return _not_found()
        if game.collaboration and request.method != "GET":
            return _error("This workspace uses live editing. Reopen it to connect.", 409)
        return JsonResponse({"revision": game.revision, "entities": [entity_to_json(e) for e in game.entities.all()]})

    body = _json_body(request)
    with transaction.atomic():
        game = get_game(request.user_id, game_id, for_update=True)
        if game is None:
            return _not_found()
        if game.collaboration and request.method != "GET":
            return _error("This workspace uses live editing. Reopen it to connect.", 409)
        try:
            validate_entity(body)
            if game.entities.filter(item_id=body["id"]).exists():
                return _error(f"An entity with id {body['id']!r} already exists", status=409)
            if game.entities.count() >= MAX_ENTITIES:
                raise DocumentError(f"A game can have at most {MAX_ENTITIES} entities")
            _check_parent(game, body["id"], body.get("parentId"))
        except DocumentError as exc:
            return _error(str(exc))
        position = (game.entities.aggregate(last=Max("position"))["last"] or 0) + 1
        entity = Entity.objects.create(game=game, position=position, **entity_fields(body))
        game.touch()
    return JsonResponse({"revision": game.revision, "entity": entity_to_json(entity)}, status=201)


# GET    /api/canvas/games/<id>/entities/<entity_id>/   one entity
# PUT    /api/canvas/games/<id>/entities/<entity_id>/   replace it
# PATCH  /api/canvas/games/<id>/entities/<entity_id>/   change some of its keys
# DELETE /api/canvas/games/<id>/entities/<entity_id>/   delete it and its children
@require_http_methods(["GET", "PUT", "PATCH", "DELETE"])
@jwt_required
@rate_limit("canvas", **CANVAS_RATE_LIMIT)
def entity(request, game_id, entity_id):
    """
    GET    -> 200 {"revision": n, "entity": {...}}
    PUT    body: the whole entity ("id" may be left out; if present it must match the URL)
    PATCH  body: only the keys to change, e.g. {"transform": {...}} or {"visible": false}.
           Each key is replaced whole (transform replaces the whole transform).
           -> 200 {"revision": n, "entity": {...}}   400 invalid
    DELETE -> 200 {"revision": n, "deleted": ["<id>", "<child id>", ...]}
    """
    if request.method == "GET":
        game = get_game(request.user_id, game_id)
        row = game and game.entities.filter(item_id=entity_id).first()
        if not row:
            return _not_found("Entity" if game else "Game")
        return JsonResponse({"revision": game.revision, "entity": entity_to_json(row)})

    body = _json_body(request) if request.method in ("PUT", "PATCH") else None
    with transaction.atomic():
        game = get_game(request.user_id, game_id, for_update=True)
        if game is None:
            return _not_found()
        if game.collaboration and request.method != "GET":
            return _error("This workspace uses live editing. Reopen it to connect.", 409)
        row = game.entities.filter(item_id=entity_id).first()
        if row is None:
            return _not_found("Entity")

        if request.method == "DELETE":
            deleted = [entity_id, *descendants_of(game, entity_id)]
            game.entities.filter(item_id__in=deleted).delete()
            game.object_scripts = {key: value for key, value in game.object_scripts.items() if key not in deleted}
            game.save(update_fields=["object_scripts"])
            game.touch()
            return JsonResponse({"revision": game.revision, "deleted": deleted})

        try:
            _require_object(body)
            if body.get("id", entity_id) != entity_id:
                raise DocumentError("An entity's id can't be changed")
            updated = {**entity_to_json(row), **body} if request.method == "PATCH" else {**body, "id": entity_id}
            validate_entity(updated)
            _check_parent(game, entity_id, updated.get("parentId"))
        except DocumentError as exc:
            return _error(str(exc))
        for field, value in entity_fields(updated).items():
            setattr(row, field, value)
        row.save()
        game.touch()
    return JsonResponse({"revision": game.revision, "entity": entity_to_json(row)})


# ---- libraries: assets, materials, prefabs --------------------------------------------------

def _library(game, library):
    return getattr(game, library)


# GET  /api/canvas/games/<id>/{assets,materials,prefabs}/   the list
# POST /api/canvas/games/<id>/{assets,materials,prefabs}/   add an item at the end
@require_http_methods(["GET", "POST"])
@jwt_required
@rate_limit("canvas", **CANVAS_RATE_LIMIT)
def library(request, game_id, library):
    """
    GET  -> 200 {"revision": n, "<library>": [{...}, ...]}
    POST body: {<item>} with a new "id" -> 201 {"revision": n, "item": {...}}   409 id already used
    """
    if request.method == "GET":
        game = get_game(request.user_id, game_id)
        if game is None:
            return _not_found()
        if game.collaboration and request.method != "GET":
            return _error("This workspace uses live editing. Reopen it to connect.", 409)
        return JsonResponse({"revision": game.revision, library: [i.data for i in _library(game, library).all()]})

    body = _json_body(request)
    with transaction.atomic():
        game = get_game(request.user_id, game_id, for_update=True)
        if game is None:
            return _not_found()
        if game.collaboration and request.method != "GET":
            return _error("This workspace uses live editing. Reopen it to connect.", 409)
        items = _library(game, library)
        try:
            validate_library_item(body, library)
            if items.filter(item_id=body["id"]).exists():
                return _error(f"{library}: id {body['id']!r} already exists", status=409)
            if items.count() >= MAX_LIBRARY_ITEMS:
                raise DocumentError(f"A game can have at most {MAX_LIBRARY_ITEMS} {library}")
        except DocumentError as exc:
            return _error(str(exc))
        position = (items.aggregate(last=Max("position"))["last"] or 0) + 1
        item = LIBRARIES[library].objects.create(game=game, item_id=body["id"], position=position, data=body)
        game.touch()
    return JsonResponse({"revision": game.revision, "item": item.data}, status=201)


# GET    /api/canvas/games/<id>/{assets,materials,prefabs}/<item_id>/
# PUT    /api/canvas/games/<id>/{assets,materials,prefabs}/<item_id>/
# DELETE /api/canvas/games/<id>/{assets,materials,prefabs}/<item_id>/
@require_http_methods(["GET", "PUT", "DELETE"])
@jwt_required
@rate_limit("canvas", **CANVAS_RATE_LIMIT)
def library_item(request, game_id, library, item_id):
    """
    GET    -> 200 {"revision": n, "item": {...}}
    PUT    body: the whole item ("id" may be left out; if present it must match the URL)
           -> 200 {"revision": n, "item": {...}}
    DELETE -> 200 {"revision": n, "deleted": "<item_id>"}
    """
    if request.method == "GET":
        game = get_game(request.user_id, game_id)
        row = game and _library(game, library).filter(item_id=item_id).first()
        if not row:
            return _not_found("Item" if game else "Game")
        return JsonResponse({"revision": game.revision, "item": row.data})

    body = _json_body(request) if request.method == "PUT" else None
    with transaction.atomic():
        game = get_game(request.user_id, game_id, for_update=True)
        if game is None:
            return _not_found()
        if game.collaboration and request.method != "GET":
            return _error("This workspace uses live editing. Reopen it to connect.", 409)
        row = _library(game, library).filter(item_id=item_id).first()
        if row is None:
            return _not_found("Item")

        if request.method == "DELETE":
            row.delete()
            game.touch()
            return JsonResponse({"revision": game.revision, "deleted": item_id})

        try:
            _require_object(body)
            if body.get("id", item_id) != item_id:
                raise DocumentError("An item's id can't be changed")
            row.data = validate_library_item({**body, "id": item_id}, library)
        except DocumentError as exc:
            return _error(str(exc))
        row.save()
        game.touch()
    return JsonResponse({"revision": game.revision, "item": row.data})
