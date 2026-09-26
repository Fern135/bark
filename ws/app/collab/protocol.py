"""Wire models. Every inbound frame is validated here before it reaches any room state.

Mirrors ws/COLLAB-PROTOCOL.md and scripting/src/collab/types.ts. Outbound frames are
plain dicts built by the helpers at the bottom — there is no value in validating our own
output, and dicts keep the hot fan-out path allocation-free.
"""

from typing import Annotated, Any, Literal, Union, get_args

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from .. import config

OpKind = Literal[
    "create",
    "replace",
    "attach",
    "detach",
    "move",
    "delete",
    "var_set",
    "var_delete",
    "project",
]

OP_KINDS: tuple[str, ...] = get_args(OpKind)


class Op(BaseModel):
    """An op carries arbitrary Blockly block JSON, so only the envelope is typed here.

    Semantic validation lives in ops.apply_op, which raises OpError with a wire code.
    """

    model_config = ConfigDict(extra="allow")

    op: OpKind


class _Base(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # Client-side generation counter. Echoed nowhere; the client uses it to discard its own
    # stale traffic after a resync, exactly like `session` in scripting/src/session.ts.
    epoch: int = 0


class Join(_Base):
    type: Literal["join"]
    doc: str
    have: int | None = None
    # Required when doc == "new": the document to seed the room from.
    document: dict[str, Any] | None = None


class Lock(_Base):
    type: Literal["lock"]
    blockId: str = Field(max_length=256)
    nonce: int = 0


class Unlock(_Base):
    type: Literal["unlock"]
    blockId: str = Field(max_length=256)


class Commit(_Base):
    type: Literal["commit"]
    base: int
    ops: list[Op] = Field(min_length=1, max_length=config.MAX_OPS_PER_COMMIT)
    hash: str | None = Field(default=None, max_length=128)
    nonce: int = 0


class Presence(_Base):
    type: Literal["presence"]
    blockId: str | None = Field(default=None, max_length=256)


class Heartbeat(_Base):
    type: Literal["heartbeat"]


class Auth(_Base):
    """Only seen before `join`, and only when there is no cookie. Handled in main._authenticate."""

    type: Literal["auth"]
    token: str


ClientMessage = Annotated[
    Union[Join, Lock, Unlock, Commit, Presence, Heartbeat, Auth],
    Field(discriminator="type"),
]

_adapter: TypeAdapter[ClientMessage] = TypeAdapter(ClientMessage)


class ProtocolError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def parse_client_message(raw: Any) -> ClientMessage:
    """Validate one decoded frame, or raise ProtocolError("INVALID_OP", ...)."""
    try:
        return _adapter.validate_python(raw)
    except ValidationError as exc:
        # Report the first problem only: the full pydantic tree leaks our schema shape.
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(part) for part in first.get("loc", ())) or "message"
        raise ProtocolError("INVALID_OP", f"{where}: {first.get('msg', 'is invalid')}") from exc


def check_depth(value: Any, limit: int = config.MAX_BLOCK_DEPTH) -> None:
    """Guard against pathologically nested block JSON before it reaches json.dumps.

    The walkers in ops.py are iterative, but canonical() is not, so a deep enough tree
    would hit Python's recursion limit while hashing.
    """
    stack = [(value, 0)]
    while stack:
        node, depth = stack.pop()
        if depth > limit:
            raise ProtocolError("LIMIT_EXCEEDED", "Block structure is nested too deeply.")
        if isinstance(node, dict):
            stack.extend((child, depth + 1) for child in node.values())
        elif isinstance(node, list):
            stack.extend((child, depth + 1) for child in node)


# ---- outbound frames -------------------------------------------------------------

def ready(user_id: str) -> dict:
    return {"type": "ready", "user": user_id}


def snapshot(doc_id: str, rev: int, document: dict, locks: list[dict], peers: list[dict]) -> dict:
    return {
        "type": "snapshot",
        "doc": doc_id,
        "rev": rev,
        "document": document,
        "locks": locks,
        "peers": peers,
    }


def patch(rev: int, ops: list[dict], by: str, doc_hash: str | None) -> dict:
    return {"type": "patch", "rev": rev, "ops": ops, "by": by, "hash": doc_hash}


def ack(nonce: int, rev: int) -> dict:
    return {"type": "ack", "nonce": nonce, "rev": rev}


def lock_state(block_id: str, owner: dict | None, nonce: int | None = None) -> dict:
    frame = {"type": "lock_state", "blockId": block_id, "owner": owner}
    if nonce is not None:
        frame["nonce"] = nonce
    return frame


def presence(peers: list[dict]) -> dict:
    return {"type": "presence", "peers": peers}


def error(code: str, message: str, rev: int | None = None) -> dict:
    frame = {"type": "error", "code": code, "message": message}
    if rev is not None:
        frame["rev"] = rev
    return frame
