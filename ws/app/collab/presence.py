"""Bounded, transient editor awareness. Identity always comes from the connection."""
import math
from canvas.collaboration_ops import OpError


def vector(value, keys="xyz"):
    if not isinstance(value, dict) or any(isinstance(value.get(k), bool) or not isinstance(value.get(k), (int, float)) or not math.isfinite(value[k]) or abs(value[k]) > 1e7 for k in keys):
        raise OpError("INVALID_OP", "Invalid presence coordinates")
    return {k: value[k] for k in keys}


def presence(message):
    result = {}
    camera = message.get("camera")
    if camera is not None:
        if not isinstance(camera, dict):
            raise OpError("INVALID_OP", "Invalid camera")
        result["camera"] = {key: vector(camera.get(key)) for key in ("position", "target")}
    selected = message.get("selected")
    if selected is not None and (not isinstance(selected, str) or len(selected) > 256):
        raise OpError("INVALID_OP", "Invalid selection")
    result["selected"] = selected
    result["view"] = message.get("view") if message.get("view") in ("viewport", "code", "design") else "viewport"
    preview = message.get("preview")
    result["preview"] = None
    if preview is not None:
        if not isinstance(preview, dict) or not isinstance(preview.get("id"), str) or len(preview["id"]) > 256 or not isinstance(preview.get("transform"), dict):
            raise OpError("INVALID_OP", "Invalid transform preview")
        transform = preview["transform"]
        result["preview"] = {"id": preview["id"], "transform": {key: vector(transform.get(key), "xyzw" if key == "rotation" else "xyz") for key in ("position", "rotation", "scale")}}
    return result
