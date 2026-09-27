import secrets
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from lib.decorators import jwt_required, rate_limit
from .access import get_game
from .models import Game, WorkspaceMember
from .document import to_document, save_document
from .collaboration_ops import assign_block_ids
from .views import _json_body, _error, _summary, CANVAS_RATE_LIMIT


def roster(game):
    users = [game.owner, *(m.user for m in game.members.select_related("user"))]
    return [{"user": u.user_id, "name": u.username, "role": "owner" if u.user_id == game.owner_id else "editor"} for u in users]


@require_http_methods(["GET", "POST", "DELETE"])
@jwt_required
@rate_limit("canvas", **CANVAS_RATE_LIMIT)
def workspace(request, game_id):
    with transaction.atomic():
        game = get_game(request.user_id, game_id, for_update=True)
        if not game:
            return _error("Workspace not found", 404)
        owner = game.owner_id == request.user_id
        if request.method != "GET":
            if not owner:
                return _error("Only the owner can manage invitations", 403)
            if request.method == "POST":
                expected = request.headers.get("If-Match")
                if not game.collaboration and expected != f'"{game.revision}"':
                    return _error("Save your latest edits and try again", 412)
                if not game.collaboration:
                    document = to_document(game)
                    if assign_block_ids(document):
                        save_document(game, document)
                        game.refresh_from_db()
                game.collaboration = True
                game.invite_code = secrets.token_urlsafe(12)
            else:
                game.invite_code = None
            game.save(update_fields=["collaboration", "invite_code"])
        return JsonResponse({"members": roster(game), "enabled": game.collaboration,
                             "code": game.invite_code if owner else None})


@require_http_methods(["POST"])
@jwt_required(load_user=True)
@rate_limit("workspace_join", key=lambda r: r.user_id, limit=20, window=60)
def join(request):
    body = _json_body(request)
    code = body.get("code") if isinstance(body, dict) else None
    if not isinstance(code, str) or not code.strip() or len(code) > 48:
        return _error("Enter a valid invite code")
    with transaction.atomic():
        game = Game.objects.select_for_update().filter(invite_code=code.strip(), collaboration=True).first()
        if not game:
            return _error("This invite is invalid or has been disabled", 404)
        if game.owner_id != request.user_id:
            WorkspaceMember.objects.get_or_create(game=game, user=request.jwt_user)
        return JsonResponse(_summary(game, request.user_id))


@require_http_methods(["DELETE"])
@jwt_required
@rate_limit("canvas", **CANVAS_RATE_LIMIT)
def member(request, game_id, user_id):
    with transaction.atomic():
        game = get_game(request.user_id, game_id, for_update=True)
        if not game:
            return _error("Workspace not found", 404)
        if user_id == game.owner_id:
            return _error("A workspace must retain its owner", 400)
        if request.user_id not in (game.owner_id, user_id):
            return _error("Only the owner can remove other editors", 403)
        game.members.filter(user_id=user_id).delete()
        game.locks.filter(user_id=user_id).delete()
        return JsonResponse({"members": roster(game)})
