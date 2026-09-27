import pytest
import asyncio
from types import SimpleNamespace
from app.collab import canvas_store  # Configure Canvas before importing its validation error.
from app.collab.presence import presence
from canvas.collaboration_ops import OpError


def test_legacy_workspace_client_is_told_to_reload():
    from app.collab.workspaces import handle
    with pytest.raises(OpError, match="Reload Bark"):
        asyncio.run(handle(SimpleNamespace(), {"type": "join", "protocol": 2}))


def test_presence_is_bounded_and_drops_identity_and_unknown_fields():
    point = {"x": 1, "y": 2, "z": 3}
    result = presence({"user": "impostor", "conn": "impostor", "camera": {"position": point, "target": point}, "selected": "box", "view": "code", "document": "ignored"})
    assert result == {"camera": {"position": point, "target": point}, "selected": "box", "view": "code", "preview": None}


@pytest.mark.parametrize("coordinate", [float("nan"), float("inf"), True, "1", 1e20])
def test_presence_rejects_bad_coordinates(coordinate):
    with pytest.raises(OpError):
        presence({"camera": {"position": {"x": coordinate, "y": 0, "z": 0}, "target": {"x": 0, "y": 0, "z": 0}}})
