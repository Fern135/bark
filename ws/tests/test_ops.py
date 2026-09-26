"""Document algebra: applying ops, indexing blocks, and deciding lock conflicts.

These are pure-function tests: no database, no websocket, no event loop.
"""

import json

import pytest

from app.collab import ops


def document() -> dict:
    """A small workspace with a nested stack, a shadow, and one loose root."""
    return {
        "version": 1,
        "project": {"entities": []},
        "script": {
            "language": "blocks",
            "workspace": {
                "variables": [{"name": "score", "id": "v1"}],
                "blocks": {
                    "languageVersion": 0,
                    "blocks": [
                        {
                            "type": "bark_start",
                            "id": "start",
                            "x": 30,
                            "y": 30,
                            "inputs": {
                                "DO": {
                                    "block": {
                                        "type": "bark_notify",
                                        "id": "n1",
                                        "inputs": {
                                            "TEXT": {
                                                "shadow": {
                                                    "type": "text",
                                                    "id": "s1",
                                                    "fields": {"TEXT": "hi"},
                                                }
                                            }
                                        },
                                        "next": {"block": {"type": "bark_jump", "id": "j1"}},
                                    }
                                }
                            },
                        },
                        {"type": "bark_loose", "id": "loose", "x": 500, "y": 40},
                    ],
                },
            },
        },
    }


@pytest.fixture
def doc() -> dict:
    return document()


@pytest.fixture
def workspace(doc: dict) -> dict:
    return ops.workspace_of(doc)


# ---- indexing ------------------------------------------------------------------------

def test_index_covers_real_blocks_only(workspace):
    index = ops.build_index(workspace)
    assert set(index) == {"start", "n1", "j1", "loose"}
    # Shadows are default values, not identities, so they are never addressable by an op.
    assert "s1" not in index


def test_index_records_parents_and_depth(workspace):
    index = ops.build_index(workspace)
    assert index["start"].parent is None
    assert index["n1"].parent == "start"
    assert index["j1"].parent == "n1"
    assert index["j1"].depth == 2
    assert ops.ancestors(index, "j1") == ["n1", "start"]


def test_index_keeps_walking_past_id_less_blocks():
    """Hand-authored fixtures (playground/sample.ts) omit ids; their children still count."""
    doc = {
        "script": {
            "language": "blocks",
            "workspace": {
                "blocks": {
                    "languageVersion": 0,
                    "blocks": [{"type": "a", "next": {"block": {"type": "b", "id": "real"}}}],
                }
            },
        }
    }
    index = ops.build_index(ops.workspace_of(doc))
    assert set(index) == {"real"}
    assert index["real"].parent is None


# ---- lock conflicts ------------------------------------------------------------------

@pytest.mark.parametrize(
    "requested,held,expected",
    [
        ("n1", "n1", True),          # the same block
        ("j1", "start", True),       # an ancestor's lock covers the descendant
        ("start", "j1", True),       # and a descendant's lock blocks the ancestor
        ("loose", "start", False),   # separate stacks are independent
        ("loose", ops.DOC_LOCK, True),
        (ops.DOC_LOCK, "n1", True),
    ],
)
def test_conflicts(workspace, requested, held, expected):
    index = ops.build_index(workspace)
    assert ops.conflicts(index, requested, held) is expected


def test_conflicts_survives_a_cycle():
    """A malformed document must not hang the lock check."""
    index = {
        "a": ops.Node(id="a", parent="b", depth=1),
        "b": ops.Node(id="b", parent="a", depth=1),
    }
    assert ops.conflicts(index, "a", "b") is True


# ---- moves ---------------------------------------------------------------------------

def test_move_repositions_a_root(doc, workspace):
    ops.apply_op(doc, {"op": "move", "id": "loose", "x": 11, "y": 22})
    assert ops.find(workspace, "loose")[2]["x"] == 11


def test_move_rejects_a_connected_block(doc):
    with pytest.raises(ops.OpError) as caught:
        ops.apply_op(doc, {"op": "move", "id": "n1", "x": 1, "y": 2})
    assert caught.value.code == "INVALID_OP"


def test_detach_then_attach(doc, workspace):
    ops.apply_op(doc, {"op": "detach", "id": "j1", "x": 300, "y": 300})
    assert ops.build_index(workspace)["j1"].parent is None
    assert ops.find(workspace, "n1")[2].get("next", {}).get("block") is None

    ops.apply_op(doc, {"op": "attach", "id": "j1", "parent": "start", "connection": {"next": True}})
    assert ops.build_index(workspace)["j1"].parent == "start"
    # A connected block has no canvas position; only roots do.
    assert "x" not in ops.find(workspace, "j1")[2]


def test_attach_refuses_a_cycle(doc):
    with pytest.raises(ops.OpError) as caught:
        ops.apply_op(doc, {"op": "attach", "id": "start", "parent": "n1", "connection": {"next": True}})
    assert caught.value.code == "INVALID_OP"


def test_attach_to_an_occupied_slot_changes_nothing(doc, workspace):
    """Regression: the block used to be detached before the slot was checked, losing it."""
    before = json.dumps(workspace, sort_keys=True)
    with pytest.raises(ops.OpError) as caught:
        ops.apply_op(doc, {"op": "attach", "id": "loose", "parent": "start", "connection": {"input": "DO"}})
    assert caught.value.code == "INVALID_OP"
    assert ops.find(workspace, "loose") is not None
    assert json.dumps(workspace, sort_keys=True) == before


def test_attach_in_place_is_a_noop(doc, workspace):
    before = json.dumps(workspace, sort_keys=True)
    ops.apply_op(doc, {"op": "attach", "id": "n1", "parent": "start", "connection": {"input": "DO"}})
    assert json.dumps(workspace, sort_keys=True) == before


def test_attach_needs_a_connection(doc):
    with pytest.raises(ops.OpError) as caught:
        ops.apply_op(doc, {"op": "attach", "id": "loose", "parent": "start", "connection": {}})
    assert caught.value.code == "INVALID_OP"


# ---- replace -------------------------------------------------------------------------

def test_replace_keeps_identity_and_root_position(doc, workspace):
    before_x = ops.find(workspace, "start")[2]["x"]
    ops.apply_op(
        doc,
        {"op": "replace", "id": "start", "block": {"type": "bark_start", "extraState": {"hasElse": True}}},
    )
    block = ops.find(workspace, "start")[2]
    assert block["id"] == "start"
    assert block["x"] == before_x
    assert block["extraState"] == {"hasElse": True}


def test_replace_overwrites_the_whole_subtree(doc, workspace):
    """By design: the client always sends the full subtree, and its lock guarantees nobody
    else was editing inside it. This is what buys the small op set."""
    ops.apply_op(doc, {"op": "replace", "id": "start", "block": {"type": "bark_start"}})
    assert "n1" not in ops.build_index(workspace)


def test_replace_strips_position_from_a_connected_block(doc, workspace):
    ops.apply_op(doc, {"op": "replace", "id": "n1", "block": {"type": "bark_notify", "x": 9, "y": 9}})
    block = ops.find(workspace, "n1")[2]
    assert "x" not in block and block["id"] == "n1"


# ---- create / delete -----------------------------------------------------------------

def test_create_adds_a_root(doc, workspace):
    ops.apply_op(doc, {"op": "create", "block": {"type": "bark_hud", "id": "h1"}, "x": 7, "y": 8})
    assert ops.build_index(workspace)["h1"].parent is None
    assert ops.find(workspace, "h1")[2]["y"] == 8


def test_create_rejects_a_duplicate_id(doc):
    with pytest.raises(ops.OpError) as caught:
        ops.apply_op(doc, {"op": "create", "block": {"type": "bark_hud", "id": "loose"}, "x": 0, "y": 0})
    assert caught.value.code == "INVALID_OP"


def test_delete_removes_the_subtree(doc, workspace):
    ops.apply_op(doc, {"op": "delete", "id": "n1"})
    index = ops.build_index(workspace)
    assert not {"n1", "j1"} & set(index)
    assert "loose" in index


def test_missing_block_is_not_found(doc):
    with pytest.raises(ops.OpError) as caught:
        ops.apply_op(doc, {"op": "delete", "id": "ghost"})
    assert caught.value.code == "NOT_FOUND"


def test_unknown_op_is_rejected(doc):
    with pytest.raises(ops.OpError) as caught:
        ops.apply_op(doc, {"op": "teleport", "id": "n1"})
    assert caught.value.code == "INVALID_OP"


# ---- variables -----------------------------------------------------------------------

def test_variables_are_keyed_by_id(doc, workspace):
    ops.apply_op(doc, {"op": "var_set", "id": "v1", "name": "points"})
    assert workspace["variables"][0]["name"] == "points"
    ops.apply_op(doc, {"op": "var_set", "id": "v2", "name": "lives"})
    assert len(workspace["variables"]) == 2
    ops.apply_op(doc, {"op": "var_delete", "id": "v1"})
    assert [v["id"] for v in workspace["variables"]] == ["v2"]


# ---- authorisation helpers -----------------------------------------------------------

@pytest.mark.parametrize(
    "op,expected",
    [
        ({"op": "create", "block": {}}, None),
        ({"op": "var_set", "id": "v1", "name": "x"}, None),
        ({"op": "replace", "id": "b7"}, "b7"),
        ({"op": "delete", "id": "b7"}, "b7"),
        ({"op": "project", "project": {}}, ops.DOC_LOCK),
    ],
)
def test_primary_names_the_block_needing_a_lock(op, expected):
    assert ops.primary(op) == expected


def test_attach_touches_the_parent_too():
    """So dropping a block into someone else's stack is denied."""
    assert ops.touched({"op": "attach", "id": "b7", "parent": "b2"}) == ["b7", "b2"]


# ---- project + hashing ---------------------------------------------------------------

def test_project_op_replaces_the_whole_value(doc):
    ops.apply_op(doc, {"op": "project", "project": {"entities": [{"id": "player"}]}})
    assert doc["project"]["entities"] == [{"id": "player"}]


def test_hash_is_key_order_independent_but_content_sensitive():
    a = {"script": {"language": "blocks", "workspace": {"b": 1, "a": 2}}}
    b = {"script": {"language": "blocks", "workspace": {"a": 2, "b": 1}}}
    c = {"script": {"language": "blocks", "workspace": {"a": 3, "b": 1}}}
    assert ops.workspace_hash(a) == ops.workspace_hash(b)
    assert ops.workspace_hash(a) != ops.workspace_hash(c)


# ---- script flavours -----------------------------------------------------------------

def test_python_documents_collaborate_on_the_blocks_backup():
    doc = {
        "script": {
            "language": "python",
            "source": "x = 1",
            "blocksBackup": {"blocks": {"languageVersion": 0, "blocks": []}},
        }
    }
    assert ops.workspace_of(doc) is doc["script"]["blocksBackup"]


def test_python_document_without_a_backup_is_rejected():
    with pytest.raises(ops.OpError) as caught:
        ops.workspace_of({"script": {"language": "python", "source": "x = 1"}})
    assert caught.value.code == "INVALID_OP"


def test_apply_ops_is_all_or_nothing_for_the_caller(doc):
    """apply_ops mutates in place, so callers pass a copy and swap only on success."""
    candidate = json.loads(json.dumps(doc))
    with pytest.raises(ops.OpError):
        ops.apply_ops(candidate, [
            {"op": "move", "id": "loose", "x": 1, "y": 1},
            {"op": "delete", "id": "ghost"},
        ])
    assert ops.find(ops.workspace_of(doc), "loose")[2]["x"] == 500
