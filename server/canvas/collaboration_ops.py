"""Resource edits shared by the websocket service and Canvas transactions."""
import copy
import hashlib
import json
import struct
import uuid

class OpError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(document):
    # IEEE-754 encoding avoids Python/JS differences such as 1.0 versus 1.
    def normalized(value):
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return ["#number", struct.pack(">d", float(value) if value else 0.0).hex()]
        if isinstance(value, list):
            return [normalized(v) for v in value]
        if isinstance(value, dict):
            return {k: normalized(v) for k, v in value.items()}
        return value
    return hashlib.sha256(canonical(normalized(document)).encode()).hexdigest()


def roots(document):
    script = document["script"]
    return script.get("workspace", {}).get("blocks", {}).get("blocks", []) if script["language"] == "blocks" else []


def value_at(document, resource):
    if resource == "*":
        return document
    if resource == "script":
        return document["script"]
    kind, _, key = resource.partition(":")
    if kind == "entity":
        return next((e for e in document["project"]["entities"] if e["id"] == key), None)
    if kind == "block":
        return next((b for b in roots(document) if b.get("id") == key), None)
    if kind == "section" and key in {"settings", "cameras", "input", "properties", "assets", "materials", "prefabs", "name"}:
        return document["project"].get(key)
    if resource == "variables":
        return document["script"].get("workspace", {}).get("variables", [])
    raise OpError("INVALID_OP", "Unknown editing resource")


def conflicts(a, b, document):
    if a == b or "*" in (a, b):
        return True
    script_resources = lambda r: r in ("script", "variables") or r.startswith("block:")
    if any(r in ("script", "variables") for r in (a, b)) and script_resources(a) and script_resources(b):
        return True
    if a.startswith("entity:") and b.startswith("entity:"):
        parents = {e["id"]: e.get("parentId") for e in document["project"]["entities"]}
        def ancestor(child, parent):
            seen = set()
            while child and child not in seen:
                seen.add(child)
                child = parents.get(child)
                if child == parent:
                    return True
            return False
        return ancestor(a[7:], b[7:]) or ancestor(b[7:], a[7:])
    return False


def apply_ops(document, ops):
    result = copy.deepcopy(document)
    for op in ops:
        if not isinstance(op, dict) or op.get("op") != "set" or not isinstance(op.get("resource"), str) or "before" not in op or "value" not in op:
            raise OpError("INVALID_OP", "Expected a resource edit with before and value")
        resource, value = op["resource"], copy.deepcopy(op["value"])
        if value_at(result, resource) != op["before"]:
            raise OpError("CONFLICT", "This item changed. Keep your work as a copy or reload.")
        if resource == "*":
            result = value
        elif resource == "script":
            result["script"] = value
        elif resource == "variables":
            result["script"]["workspace"]["variables"] = value
        elif resource.startswith("section:"):
            result["project"][resource[8:]] = value
        else:
            kind, key = resource.split(":", 1)
            items = result["project"]["entities"] if kind == "entity" else roots(result)
            old = next((i for i, item in enumerate(items) if item.get("id") == key), None)
            if value is not None and (not isinstance(value, dict) or value.get("id") != key):
                raise OpError("INVALID_OP", "Resource id cannot change")
            if old is not None:
                if value is None:
                    items.pop(old)
                else:
                    items[old] = value
            elif value is not None:
                items.append(value)
    return result


def assign_block_ids(document):
    """Legacy starter/import documents may omit Blockly's optional IDs."""
    changed = False
    def workspace(value):
        seen = set()
        def block(node):
            nonlocal changed
            if not isinstance(node, dict):
                return
            if not node.get("id") or node["id"] in seen:
                node["id"] = str(uuid.uuid4())
                changed = True
            seen.add(node["id"])
            for connection in [*node.get("inputs", {}).values(), node.get("next", {})]:
                for key in ("block", "shadow"):
                    if key in connection:
                        block(connection[key])
        for root in value.get("blocks", {}).get("blocks", []):
            block(root)
    script = document["script"]
    for key in ("workspace", "blocksBackup"):
        if isinstance(script.get(key), dict):
            workspace(script[key])
    return changed
