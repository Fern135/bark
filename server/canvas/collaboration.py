"""Durable collaboration. All mutations serialize on the Canvas game row."""
import uuid
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from authenticator.models import User
from .access import get_game
from .models import WorkspaceLock, WorkspaceOperation
from .document import to_document, save_document, validate_document
from .collaboration_ops import is_source, OpError, apply_ops, conflicts, value_at, digest, canonical

LOCK_SECONDS = 30


def authorized(user, game_id):
    game = get_game(user, game_id, for_update=True)
    if game is None or not game.collaboration:
        raise OpError("FORBIDDEN", "This workspace is no longer available to you.")
    return game


def lock_json(lock):
    return {"resource": lock.resource, "user": lock.user_id, "conn": str(lock.connection)}


def live_locks(game):
    game.locks.filter(expires_at__lte=timezone.now()).delete()
    return list(game.locks.all())


@transaction.atomic
def snapshot(user, game_id, connection=None):
    game = authorized(user, game_id)
    if connection:
        game.locks.filter(connection=connection).update(expires_at=timezone.now() + timedelta(seconds=LOCK_SECONDS))
    document = to_document(game)
    ids = [game.owner_id, *game.members.values_list("user_id", flat=True)]
    members = [{"user": u.user_id, "name": u.username, "role": "owner" if u.user_id == game.owner_id else "editor"} for u in User.objects.filter(user_id__in=ids)]
    return {"type": "snapshot", "protocol": 3, "doc": str(game.id), "rev": game.revision,
            "document": document, "hash": digest(document), "locks": [lock_json(l) for l in live_locks(game)], "members": members}


@transaction.atomic
def state(user, game_id, connection=None):
    game = authorized(user, game_id)
    # Do not revive an expired lease.
    live_locks(game)
    if connection:
        game.locks.filter(connection=connection).update(expires_at=timezone.now() + timedelta(seconds=LOCK_SECONDS))
    ids = [game.owner_id, *game.members.values_list("user_id", flat=True)]
    return {"rev": game.revision, "locks": [lock_json(l) for l in game.locks.all()],
            "members": [{"user": u.user_id, "name": u.username, "role": "owner" if u.user_id == game.owner_id else "editor"} for u in User.objects.filter(user_id__in=ids)]}


@transaction.atomic
def acquire(user, game_id, connection, resources):
    game = authorized(user, game_id)
    document = to_document(game)
    locks = live_locks(game)
    for resource in resources:
        if is_source(resource):
            raise OpError("INVALID_OP", "Python source is edited concurrently without a lease")
        value_at(document, resource)
        for held in locks:
            if str(held.connection) != connection and conflicts(resource, held.resource, document):
                raise OpError("LOCK_HELD", f"{User.objects.get(user_id=held.user_id).username} is editing this item.")
    for resource in resources:
        WorkspaceLock.objects.update_or_create(game=game, resource=resource, defaults={"user_id": user, "connection": connection, "expires_at": timezone.now() + timedelta(seconds=LOCK_SECONDS)})
    return [lock_json(l) for l in live_locks(game)]


@transaction.atomic
def release(user, game_id, connection, resources=None):
    # Removing a member must not prevent disconnect cleanup.
    locks = WorkspaceLock.objects.filter(game_id=game_id, connection=connection, user_id=user)
    if resources is not None:
        locks = locks.filter(resource__in=resources)
    locks.delete()


@transaction.atomic
def commit(user, game_id, connection, commit_id, base, ops):
    game = authorized(user, game_id)
    commit_id = uuid.UUID(commit_id)
    previous = game.operations.filter(commit_id=commit_id).first()
    if previous:
        if previous.user_id != user or previous.ops != ops:
            raise OpError("INVALID_OP", "Commit id was already used")
        return {"type": "ack", "commitId": str(commit_id), "rev": previous.revision}
    if game.revision != base:
        raise OpError("REV_MISMATCH", "New edits arrived. Synchronizing…")
    document = to_document(game)
    locks = live_locks(game)
    for op in ops:
        resource = op.get("resource", "")
        if not is_source(resource) and not any(str(l.connection) == connection and (l.resource == resource or l.resource == "*") for l in locks):
            raise OpError("NOT_LOCKED", "Acquire this item before editing")
        if any(str(l.connection) != connection and conflicts(resource, l.resource, document) for l in locks):
            raise OpError("LOCK_HELD", "Another editor holds this item")
        if resource.startswith("entity:") and isinstance(op.get("value"), dict):
            parent = op["value"].get("parentId")
            old_parent = (op.get("before") or {}).get("parentId")
            if parent and parent != old_parent:
                target = f"entity:{parent}"
                if not any(str(l.connection) == connection and l.resource in (target, "*") for l in locks):
                    raise OpError("NOT_LOCKED", "Acquire the new parent before reparenting")
    candidate = apply_ops(document, ops)
    if len(canonical(candidate).encode()) > 10 * 1024 * 1024:
        raise OpError("LIMIT_EXCEEDED", "This world exceeds the 10 MB document limit")
    if candidate["project"]["name"] != game.name and game.owner_id != user:
        raise OpError("FORBIDDEN", "Only the owner can rename the workspace")
    validate_document(candidate)
    save_document(game, candidate)
    game.refresh_from_db()
    WorkspaceOperation.objects.create(game=game, revision=game.revision, commit_id=commit_id, user_id=user, connection=connection, ops=ops)
    return {"type": "patch", "rev": game.revision, "ops": ops, "by": user, "conn": connection,
            "commitId": str(commit_id), "hash": digest(to_document(game))}


@transaction.atomic
def replay(user, game_id, have):
    game = authorized(user, game_id)
    entries = list(game.operations.filter(revision__gt=have).order_by("revision"))
    if have > game.revision or len(entries) != game.revision - have:
        return None
    return [{"type": "patch", "rev": op.revision, "ops": op.ops, "by": op.user_id,
             "conn": str(op.connection), "commitId": str(op.commit_id)} for op in entries]
