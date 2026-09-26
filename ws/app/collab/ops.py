"""Pure document algebra: apply ops to a GameDocument, index blocks, decide lock conflicts.

No I/O, no FastAPI, no asyncpg — everything here is a function of plain dicts, so it is
cheap to unit test and safe to call while holding a database transaction.

The workspace is native Blockly JSON:

    {"variables": [{"name": ..., "id": ...}],
     "blocks": {"languageVersion": 0, "blocks": [<root block>, ...]}}

A block is a tree. Children hang off `inputs[NAME].block` / `inputs[NAME].shadow` and
`next.block` / `next.shadow`. Shadow blocks are treated as *content* of their parent, never
as identities of their own — see ws/COLLAB-PROTOCOL.md.
"""

import hashlib
import json
from dataclasses import dataclass
from typing import Any, Iterator

# The document-level lock. Conflicts with every block, and is what `project` ops require.
DOC_LOCK = "*"


class OpError(Exception):
    """Raised when an op cannot be applied. `code` matches the wire error codes."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Node:
    """Where a block sits. `parent` is None for a root."""

    id: str
    parent: str | None
    depth: int


def workspace_of(document: dict) -> dict:
    """The mutable workspace inside a GameDocument, created if the script has none yet."""
    script = document.setdefault("script", {})
    if script.get("language") != "blocks":
        # A python-language script keeps its blocks in blocksBackup; collaborate on that.
        workspace = script.get("blocksBackup")
        if not isinstance(workspace, dict):
            raise OpError("INVALID_OP", "This document has no block workspace to edit.")
        return workspace
    workspace = script.get("workspace")
    if not isinstance(workspace, dict):
        workspace = {"blocks": {"languageVersion": 0, "blocks": []}}
        script["workspace"] = workspace
    return workspace


def _roots(workspace: dict) -> list:
    blocks = workspace.setdefault("blocks", {"languageVersion": 0, "blocks": []})
    roots = blocks.setdefault("blocks", [])
    if not isinstance(roots, list):
        raise OpError("INVALID_OP", "workspace.blocks.blocks must be a list.")
    return roots


def _children(block: dict) -> Iterator[tuple[dict, str, dict]]:
    """Yield (holder, key, child) for each real (non-shadow) child of `block`.

    `holder` is the dict that owns the reference, so a caller can rewrite or delete it.
    """
    inputs = block.get("inputs")
    if isinstance(inputs, dict):
        for holder in inputs.values():
            if isinstance(holder, dict) and isinstance(holder.get("block"), dict):
                yield holder, "block", holder["block"]
    following = block.get("next")
    if isinstance(following, dict) and isinstance(following.get("block"), dict):
        yield following, "block", following["block"]


def build_index(workspace: dict) -> dict[str, Node]:
    """Map every real block id to its position. Shadows are skipped: they have no identity."""
    index: dict[str, Node] = {}
    stack: list[tuple[dict, str | None, int]] = [(root, None, 0) for root in _roots(workspace) if isinstance(root, dict)]
    while stack:
        block, parent, depth = stack.pop()
        block_id = block.get("id")
        if isinstance(block_id, str):
            index[block_id] = Node(id=block_id, parent=parent, depth=depth)
            parent_for_children: str | None = block_id
        else:
            # An id-less block (hand-authored fixtures do this) cannot be addressed by an
            # op, but its children still might be, so keep walking under the same parent.
            parent_for_children = parent
        for _holder, _key, child in _children(block):
            stack.append((child, parent_for_children, depth + 1))
    return index


def ancestors(index: dict[str, Node], block_id: str) -> list[str]:
    """Ids from `block_id`'s parent up to its root. Cycle-safe."""
    chain: list[str] = []
    seen = {block_id}
    node = index.get(block_id)
    while node is not None and node.parent is not None and node.parent not in seen:
        chain.append(node.parent)
        seen.add(node.parent)
        node = index.get(node.parent)
    return chain


def conflicts(index: dict[str, Node], requested: str, held: str) -> bool:
    """True when a lock on `held` would block work on `requested`.

    A lock covers its whole subtree, so two locks conflict when they are equal or when
    either is an ancestor of the other. The document lock conflicts with everything.
    """
    if requested == held or DOC_LOCK in (requested, held):
        return True
    return held in ancestors(index, requested) or requested in ancestors(index, held)


def find(workspace: dict, block_id: str) -> tuple[Any, Any, dict] | None:
    """Locate a block as (container, key, block), where container[key] is the block.

    The container is either the roots list (key is an int index) or the `{"block": ...}`
    holder inside an input / next (key is "block").
    """
    roots = _roots(workspace)
    for position, root in enumerate(roots):
        if isinstance(root, dict) and root.get("id") == block_id:
            return roots, position, root
    stack = [root for root in roots if isinstance(root, dict)]
    while stack:
        block = stack.pop()
        for holder, key, child in _children(block):
            if child.get("id") == block_id:
                return holder, key, child
            stack.append(child)
    return None


def _take(workspace: dict, block_id: str) -> dict:
    """Detach a block from wherever it sits and return it."""
    located = find(workspace, block_id)
    if located is None:
        raise OpError("NOT_FOUND", f"Block {block_id!r} is not in this document.")
    container, key, block = located
    if isinstance(key, int):
        container.pop(key)
    else:
        container.pop(key, None)
    return block


def _require(op: dict, field: str) -> Any:
    value = op.get(field)
    if value is None:
        raise OpError("INVALID_OP", f"Op {op.get('op')!r} is missing {field!r}.")
    return value


def _coerce_position(block: dict, x: Any, y: Any) -> None:
    block["x"] = int(x or 0)
    block["y"] = int(y or 0)


def primary(op: dict) -> str | None:
    """The block whose lock the sender must hold, or None when the op needs no lock."""
    kind = op.get("op")
    if kind in ("replace", "attach", "detach", "move", "delete"):
        value = op.get("id")
        return value if isinstance(value, str) else None
    if kind == "project":
        return DOC_LOCK
    return None


def touched(op: dict) -> list[str]:
    """Every block this op reads or writes, for the "nobody else owns it" check."""
    ids: list[str] = []
    first = primary(op)
    if first:
        ids.append(first)
    if op.get("op") == "attach" and isinstance(op.get("parent"), str):
        ids.append(op["parent"])
    return ids


def apply_op(document: dict, op: dict) -> None:
    """Apply one op in place. Raises OpError; the caller must not persist on failure."""
    kind = op.get("op")
    if kind == "project":
        project = _require(op, "project")
        if not isinstance(project, dict):
            raise OpError("INVALID_OP", "project must be an object.")
        document["project"] = project
        return

    workspace = workspace_of(document)

    if kind == "create":
        block = _require(op, "block")
        if not isinstance(block, dict) or not isinstance(block.get("id"), str):
            raise OpError("INVALID_OP", "create needs a block with an id.")
        if find(workspace, block["id"]) is not None:
            raise OpError("INVALID_OP", f"Block {block['id']!r} already exists.")
        _coerce_position(block, op.get("x"), op.get("y"))
        _roots(workspace).append(block)

    elif kind == "replace":
        block_id = _require(op, "id")
        block = _require(op, "block")
        if not isinstance(block, dict):
            raise OpError("INVALID_OP", "replace needs a block object.")
        located = find(workspace, block_id)
        if located is None:
            raise OpError("NOT_FOUND", f"Block {block_id!r} is not in this document.")
        container, key, existing = located
        block = dict(block)
        block["id"] = block_id
        if isinstance(key, int):
            # Roots keep their canvas position unless the replacement carries one.
            block.setdefault("x", existing.get("x", 0))
            block.setdefault("y", existing.get("y", 0))
        else:
            block.pop("x", None)
            block.pop("y", None)
        container[key] = block

    elif kind == "attach":
        block_id = _require(op, "id")
        parent_id = _require(op, "parent")
        connection = _require(op, "connection")
        if not isinstance(connection, dict):
            raise OpError("INVALID_OP", "attach needs a connection object.")
        if parent_id == block_id or parent_id in _subtree_ids(workspace, block_id):
            raise OpError("INVALID_OP", "A block cannot be attached inside itself.")
        parent_located = find(workspace, parent_id)
        if parent_located is None:
            raise OpError("NOT_FOUND", f"Parent {parent_id!r} is not in this document.")
        parent = parent_located[2]

        # Resolve and check the target slot *before* detaching anything. Taking the block
        # first would lose it entirely if the slot turned out to be occupied.
        to_next = connection.get("next") is True
        name = connection.get("input")
        if not to_next and not isinstance(name, str):
            raise OpError("INVALID_OP", "attach needs connection.input or connection.next.")
        if to_next:
            existing = parent.get("next")
        else:
            inputs = parent.get("inputs")
            existing = inputs.get(name) if isinstance(inputs, dict) else None
        if existing is not None and not isinstance(existing, dict):
            raise OpError("INVALID_OP", "Target connection is malformed.")
        occupant = existing.get("block") if isinstance(existing, dict) else None
        if isinstance(occupant, dict):
            if occupant.get("id") == block_id:
                return  # already attached exactly here; nothing to do
            raise OpError("INVALID_OP", "Target connection is already occupied.")

        block = _take(workspace, block_id)
        block.pop("x", None)
        block.pop("y", None)
        if to_next:
            parent.setdefault("next", {})["block"] = block
        else:
            parent.setdefault("inputs", {}).setdefault(name, {})["block"] = block

    elif kind == "detach":
        block_id = _require(op, "id")
        block = _take(workspace, block_id)
        _coerce_position(block, op.get("x"), op.get("y"))
        _roots(workspace).append(block)

    elif kind == "move":
        block_id = _require(op, "id")
        located = find(workspace, block_id)
        if located is None:
            raise OpError("NOT_FOUND", f"Block {block_id!r} is not in this document.")
        container, key, block = located
        if not isinstance(key, int):
            raise OpError("INVALID_OP", "move only repositions a root block; use attach/detach.")
        _coerce_position(block, op.get("x"), op.get("y"))

    elif kind == "delete":
        _take(workspace, _require(op, "id"))

    elif kind == "var_set":
        var_id = _require(op, "id")
        name = _require(op, "name")
        variables = workspace.setdefault("variables", [])
        for variable in variables:
            if isinstance(variable, dict) and variable.get("id") == var_id:
                variable["name"] = name
                break
        else:
            variables.append({"id": var_id, "name": name})

    elif kind == "var_delete":
        var_id = _require(op, "id")
        variables = workspace.get("variables")
        if isinstance(variables, list):
            workspace["variables"] = [
                v for v in variables if not (isinstance(v, dict) and v.get("id") == var_id)
            ]

    else:
        raise OpError("INVALID_OP", f"Unknown op {kind!r}.")


def _subtree_ids(workspace: dict, block_id: str) -> set[str]:
    located = find(workspace, block_id)
    if located is None:
        return set()
    ids: set[str] = set()
    stack = [located[2]]
    while stack:
        block = stack.pop()
        found = block.get("id")
        if isinstance(found, str):
            ids.add(found)
        for _holder, _key, child in _children(block):
            stack.append(child)
    return ids


def apply_ops(document: dict, ops: list[dict]) -> None:
    """Apply ops in order. All or nothing: the caller passes a copy and swaps on success."""
    for op in ops:
        if not isinstance(op, dict):
            raise OpError("INVALID_OP", "Each op must be an object.")
        apply_op(document, op)


def canonical(value: Any) -> str:
    """Stable JSON for hashing: sorted keys, no incidental whitespace."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def workspace_hash(document: dict) -> str:
    """sha256 over the canonical workspace. Clients compare this to detect divergence."""
    try:
        workspace = workspace_of(document)
    except OpError:
        workspace = {}
    return hashlib.sha256(canonical(workspace).encode("utf-8")).hexdigest()
