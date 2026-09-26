"""Wire validation: every inbound frame is checked before it can touch room state."""

import pytest

from app.collab import protocol


def test_join_new_carries_a_document():
    message = protocol.parse_client_message(
        {"type": "join", "doc": "new", "document": {"version": 1}}
    )
    assert message.type == "join"
    assert message.doc == "new"
    assert message.document == {"version": 1}


def test_join_existing_may_ask_for_replay():
    message = protocol.parse_client_message({"type": "join", "doc": "abc", "have": 41})
    assert message.have == 41


def test_commit_requires_at_least_one_op():
    with pytest.raises(protocol.ProtocolError) as caught:
        protocol.parse_client_message({"type": "commit", "base": 1, "ops": []})
    assert caught.value.code == "INVALID_OP"


def test_commit_rejects_an_unknown_op_kind():
    with pytest.raises(protocol.ProtocolError):
        protocol.parse_client_message(
            {"type": "commit", "base": 1, "ops": [{"op": "drop_database"}]}
        )


def test_commit_caps_the_op_count():
    ops = [{"op": "delete", "id": f"b{i}"} for i in range(protocol.config.MAX_OPS_PER_COMMIT + 1)]
    with pytest.raises(protocol.ProtocolError):
        protocol.parse_client_message({"type": "commit", "base": 1, "ops": ops})


def test_op_keeps_its_arbitrary_block_payload():
    message = protocol.parse_client_message(
        {
            "type": "commit",
            "base": 0,
            "ops": [{"op": "replace", "id": "b1", "block": {"type": "x", "inputs": {}}}],
        }
    )
    dumped = message.ops[0].model_dump()
    assert dumped["block"] == {"type": "x", "inputs": {}}
    assert dumped["id"] == "b1"


def test_unknown_message_type_is_rejected():
    with pytest.raises(protocol.ProtocolError) as caught:
        protocol.parse_client_message({"type": "shutdown"})
    assert caught.value.code == "INVALID_OP"


def test_missing_type_is_rejected():
    with pytest.raises(protocol.ProtocolError):
        protocol.parse_client_message({"doc": "abc"})


def test_non_object_frame_is_rejected():
    with pytest.raises(protocol.ProtocolError):
        protocol.parse_client_message([1, 2, 3])


def test_epoch_defaults_to_zero_and_is_carried():
    assert protocol.parse_client_message({"type": "heartbeat"}).epoch == 0
    assert protocol.parse_client_message({"type": "heartbeat", "epoch": 9}).epoch == 9


def test_block_ids_are_length_capped():
    with pytest.raises(protocol.ProtocolError):
        protocol.parse_client_message({"type": "lock", "blockId": "x" * 500})


def test_depth_guard_rejects_pathological_nesting():
    deep: dict = {}
    node = deep
    for _ in range(protocol.config.MAX_BLOCK_DEPTH + 5):
        child: dict = {}
        node["inputs"] = {"A": {"block": child}}
        node = child
    with pytest.raises(protocol.ProtocolError) as caught:
        protocol.check_depth(deep)
    assert caught.value.code == "LIMIT_EXCEEDED"


def test_depth_guard_allows_a_realistic_stack():
    workspace = {"blocks": {"languageVersion": 0, "blocks": [{"type": "a", "id": "a"}]}}
    protocol.check_depth(workspace)  # must not raise


def test_outbound_frames_match_the_documented_shapes():
    assert protocol.ready("u1") == {"type": "ready", "user": "u1"}
    assert protocol.ack(4, 42) == {"type": "ack", "nonce": 4, "rev": 42}
    assert protocol.error("LOCK_HELD", "busy") == {
        "type": "error",
        "code": "LOCK_HELD",
        "message": "busy",
    }
    assert protocol.error("REV_MISMATCH", "behind", 7)["rev"] == 7
    # A released lock is an explicit null owner, never a missing key.
    assert protocol.lock_state("b7", None) == {"type": "lock_state", "blockId": "b7", "owner": None}
    assert protocol.lock_state("b7", {"user": "u1"}, 3)["nonce"] == 3
    assert protocol.patch(42, [], "u1", "h")["rev"] == 42
