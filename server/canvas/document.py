"""Convert between a whole game document (the engine's GameDocument JSON) and the section
rows in canvas/models.py, and validate every piece before it is stored.

    to_document(game)             rows -> {"version": 1, "project": {...}, "script": {...}}
    save_document(game, document) validated document -> rows (replaces every section)
    validate_document(document)   raises DocumentError with a readable message

The validate_* functions for single sections are used by the section endpoints too, so a
section is checked the same way whether it arrives alone or inside a whole document.
Validation checks shape and references (types, ids, parents), not engine semantics; the
engine re-validates when it loads a project.
"""
from django.db import transaction

from .models import Asset, Entity, Game, GameCameras, GameInput, GameScript, GameSettings, Material, Prefab

DOCUMENT_VERSION = 2
PROJECT_VERSION = 1
MAX_ENTITIES = 2000            # the engine's default entity limit
MAX_LIBRARY_ITEMS = 500        # per list (assets, materials, prefabs)
MAX_ID_LENGTH = 100
MAX_NAME_LENGTH = 200
MAX_SCRIPT_CHARS = 200_000
SCRIPT_LANGUAGES = ("python", "blocks")

# project keys stored in their own models/fields; anything else goes to Game.project_extra
PROJECT_KEYS = ("version", "name", "entities", "assets", "materials", "prefabs", "properties", "settings", "cameras", "input")
# entity key in the document -> Entity field
ENTITY_FIELDS = {
    "id": "item_id",
    "name": "name",
    "tags": "tags",
    "enabled": "enabled",
    "visible": "visible",
    "parentId": "parent_id",
    "transform": "transform",
    "visual": "visual",
    "collider": "collider",
    "body": "body",
    "properties": "properties",
    "character": "character",
    "interaction": "interaction",
}
OPTIONAL_OBJECTS = ("visual", "collider", "body", "character", "interaction")
LIBRARIES = {"assets": Asset, "materials": Material, "prefabs": Prefab}


class DocumentError(ValueError):
    """The document (or a section of it) is not valid. str(error) is safe to show users."""


# ---- validation ---------------------------------------------------------------------------

def _require(condition, message):
    if not condition:
        raise DocumentError(message)


def _check_id(value, where):
    _require(isinstance(value, str) and value.strip(), f"{where}: id must be a non-empty string")
    _require(len(value) <= MAX_ID_LENGTH, f"{where}: id is longer than {MAX_ID_LENGTH} characters")


def validate_name(value):
    _require(isinstance(value, str) and value.strip(), "name must be a non-empty string")
    _require(len(value) <= MAX_NAME_LENGTH, f"name is longer than {MAX_NAME_LENGTH} characters")
    return value.strip()


def validate_object(value, what):
    _require(isinstance(value, dict), f"{what} must be an object")
    return value


def validate_input(value):
    validate_object(value, "input")
    for action, keys in value.items():
        _require(
            isinstance(keys, list) and all(isinstance(k, str) for k in keys),
            f"input.{action} must be a list of key codes (strings)",
        )
    return value


def validate_script(value):
    validate_object(value, "script")
    language = value.get("language")
    _require(language in SCRIPT_LANGUAGES, f"script.language must be one of: {', '.join(SCRIPT_LANGUAGES)}")
    source = value.get("source")
    if language == "python":
        _require(isinstance(source, str), "script.source must be a string for Python scripts")
    else:
        _require(isinstance(value.get("workspace"), dict), "script.workspace must be an object for block scripts")
        _require(source is None or isinstance(source, str), "script.source must be a string")
    _require(len(source or "") <= MAX_SCRIPT_CHARS, f"script.source is longer than {MAX_SCRIPT_CHARS} characters")
    return value


def validate_entity(entity, where="entity"):
    """Shape of one entity (not its parent link, which needs the other entities)."""
    validate_object(entity, where)
    _check_id(entity.get("id"), where)
    where = f"entity {entity['id']!r}"
    _require(isinstance(entity.get("transform"), dict), f"{where}: transform must be an object")
    _require(isinstance(entity.get("name", ""), str), f"{where}: name must be a string")
    _require(len(entity.get("name", "")) <= MAX_NAME_LENGTH, f"{where}: name is longer than {MAX_NAME_LENGTH} characters")
    tags = entity.get("tags", [])
    _require(isinstance(tags, list) and all(isinstance(t, str) for t in tags), f"{where}: tags must be a list of strings")
    for flag in ("enabled", "visible"):
        _require(isinstance(entity.get(flag, True), bool), f"{where}: {flag} must be true or false")
    parent = entity.get("parentId")
    _require(parent is None or isinstance(parent, str), f"{where}: parentId must be a string or null")
    _require(parent != entity["id"], f"{where}: an entity can't be its own parent")
    _require(isinstance(entity.get("properties", {}), dict), f"{where}: properties must be an object")
    for key in OPTIONAL_OBJECTS:
        _require(entity.get(key) is None or isinstance(entity[key], dict), f"{where}: {key} must be an object or null")
    return entity


def validate_hierarchy(parents):
    """parents: {entity_id: parent_id or None}. Every parent must exist, with no cycles."""
    for entity_id, parent in parents.items():
        _require(parent is None or parent in parents, f"entity {entity_id!r}: parent {parent!r} does not exist")
    for start in parents:
        seen, current = set(), start
        while current is not None:
            _require(current not in seen, f"entity {start!r}: parentId creates a cycle")
            seen.add(current)
            current = parents[current]


def validate_library_item(item, library):
    validate_object(item, f"{library} item")
    _check_id(item.get("id"), f"{library} item")
    return item


def _validate_unique_list(items, what, limit, validate_item):
    _require(isinstance(items, list), f"project.{what} must be a list")
    _require(len(items) <= limit, f"project.{what} has more than {limit} items")
    seen = set()
    for item in items:
        validate_item(item)
        _require(item["id"] not in seen, f"project.{what}: duplicate id {item['id']!r}")
        seen.add(item["id"])


def validate_document(document):
    validate_object(document, "document")
    _require(document.get("version") in (1, DOCUMENT_VERSION), f"document version must be {DOCUMENT_VERSION}")
    project = validate_object(document.get("project"), "project")
    _require(project.get("version", PROJECT_VERSION) == PROJECT_VERSION, f"project.version must be {PROJECT_VERSION}")
    validate_name(project.get("name"))

    entities = project.get("entities", [])
    _validate_unique_list(entities, "entities", MAX_ENTITIES, validate_entity)
    validate_hierarchy({e["id"]: e.get("parentId") for e in entities})
    for library in LIBRARIES:
        _validate_unique_list(project.get(library, []), library, MAX_LIBRARY_ITEMS, lambda i, lib=library: validate_library_item(i, lib))

    validate_object(project.get("properties", {}), "project.properties")
    validate_object(project.get("settings", {}), "project.settings")
    validate_object(project.get("cameras", {}), "project.cameras")
    validate_input(project.get("input", {}))
    validate_script(document.get("script"))
    scripts = document.get("objectScripts", {})
    validate_object(scripts, "objectScripts")
    _require("objectScripts" not in document or document["version"] == 2, "Object scripts require version 2")
    ids = {e["id"] for e in entities}
    for owner, script in scripts.items():
        _require(owner in ids, f"Script owner {owner!r} does not exist")
        validate_script(script)
    return document


# ---- rows -> JSON -------------------------------------------------------------------------

def entity_to_json(entity):
    data = {key: getattr(entity, field) for key, field in ENTITY_FIELDS.items()}
    return {**data, **entity.extra}


def script_to_json(script):
    data = {"language": script.language}
    if script.language == "python" or script.source:
        data["source"] = script.source
    if script.workspace is not None:
        data["workspace"] = script.workspace
    return {**data, **script.extra}


def to_document(game):
    """The whole game as the engine's GameDocument JSON."""
    project = {
        "version": game.project_version,
        "name": game.name,
        "entities": [entity_to_json(e) for e in game.entities.all()],
        **{library: [item.data for item in getattr(game, library).all()] for library in LIBRARIES},
        "properties": game.properties,
        "settings": game.settings.data,
        "cameras": game.cameras.data,
        "input": game.input.data,
        **game.project_extra,
    }
    return {"version": game.document_version, "project": project, "script": script_to_json(game.script), **({"objectScripts": game.object_scripts} if game.document_version >= 2 else {})}


# ---- JSON -> rows -------------------------------------------------------------------------

def entity_fields(entity):
    """Model field values for one validated entity dict (everything except game/position)."""
    fields = {field: entity[key] for key, field in ENTITY_FIELDS.items() if key in entity}
    fields.setdefault("name", "")
    fields["extra"] = {k: v for k, v in entity.items() if k not in ENTITY_FIELDS}
    return fields


def script_fields(script):
    known = ("language", "source", "workspace")
    return {
        "language": script["language"],
        "source": script.get("source") or "",
        "workspace": script.get("workspace"),
        "extra": {k: v for k, v in script.items() if k not in known},
    }


@transaction.atomic
def save_document(game, document):
    """Replace every section of `game` with a validated document. Bumps the revision."""
    validate_document(document)
    project = document["project"]

    game.document_version = document["version"]
    game.object_scripts = document.get("objectScripts", {})
    game.project_version = project.get("version", PROJECT_VERSION)
    game.name = validate_name(project["name"])
    game.properties = project.get("properties", {})
    game.project_extra = {k: v for k, v in project.items() if k not in PROJECT_KEYS}
    game.save()

    GameSettings.objects.update_or_create(game=game, defaults={"data": project.get("settings", {})})
    GameCameras.objects.update_or_create(game=game, defaults={"data": project.get("cameras", {})})
    GameInput.objects.update_or_create(game=game, defaults={"data": project.get("input", {})})
    GameScript.objects.update_or_create(game=game, defaults=script_fields(document["script"]))

    game.entities.all().delete()
    Entity.objects.bulk_create(
        Entity(game=game, position=i, **entity_fields(e)) for i, e in enumerate(project.get("entities", []))
    )
    for library, model in LIBRARIES.items():
        getattr(game, library).all().delete()
        model.objects.bulk_create(
            model(game=game, item_id=item["id"], position=i, data=item) for i, item in enumerate(project.get(library, []))
        )
    game.touch()
    return game


def descendants_of(game, entity_id):
    """Ids of every entity under `entity_id` (children, grandchildren, ...)."""
    children = {}
    for item_id, parent in game.entities.values_list("item_id", "parent_id"):
        children.setdefault(parent, []).append(item_id)
    found, stack = [], list(children.get(entity_id, []))
    while stack:
        current = stack.pop()
        found.append(current)
        stack.extend(children.get(current, []))
    return found
