"""Tests for the canvas app: models/document conversion, validation, access, and every view.

    docker compose exec server python manage.py test canvas

They also run in the background every time the server container starts. lib/testing.py
keeps the rate-limit counters on redis DB 15 with a private prefix per parallel worker.
"""
import copy
import json
import uuid
from unittest import mock

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import Client

from authenticator.models import User
from authenticator.tokens import create_access_token
from lib.decorators.rate_limit import _cache_key
from lib.testing import IsolatedTestCase

from . import document as doc
from .defaults import NEW_GAME, new_game_document
from .models import Asset, Entity, Game, GameScript, Material, Prefab

SECTIONS = ("settings", "cameras", "input", "properties", "script")
LIBRARIES = ("assets", "materials", "prefabs")


def sample(**project_changes):
    """A copy of the default document, with some project keys changed."""
    document = copy.deepcopy(NEW_GAME)
    document["project"].update(project_changes)
    return document


def entity(entity_id, parent=None, **changes):
    base = {
        "id": entity_id,
        "name": entity_id.title(),
        "tags": [],
        "enabled": True,
        "visible": True,
        "parentId": parent,
        "transform": {"position": {"x": 0, "y": 0, "z": 0}, "rotation": {"x": 0, "y": 0, "z": 0, "w": 1}, "scale": {"x": 1, "y": 1, "z": 1}},
        "visual": {"kind": "sphere", "size": {"x": 1, "y": 1, "z": 1}},
        "collider": None,
        "body": None,
        "properties": {},
        "character": None,
        "interaction": None,
    }
    return {**base, **changes}


class CanvasTestCase(IsolatedTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.make_user("alice")
        self.client = self.client_for(self.user)

    def make_user(self, username):
        return User.objects.create(
            user_id=str(uuid.uuid4()), username=username, email=f"{username}@example.com", password=make_password("x")
        )

    def client_for(self, user):
        client = Client()
        client.cookies[settings.JWT_ACCESS_COOKIE] = create_access_token(user)
        return client

    def api(self, method, path, data=None, client=None):
        body = "" if data is None else json.dumps(data)
        return (client or self.client).generic(method, f"/api/canvas/{path}", body, content_type="application/json")

    def create_game(self, document=None, client=None, **extra):
        payload = {**({"document": document} if document is not None else {}), **extra}
        response = self.api("POST", "games/", payload, client=client)
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()


# ---- document.py: conversion ------------------------------------------------------------

class DocumentConversionTests(CanvasTestCase):
    def new_game(self, document):
        game = Game.objects.create(owner=self.user, name="x")
        doc.save_document(game, document)
        return Game.objects.get(pk=game.pk)

    def test_round_trip_is_exact(self):
        self.assertEqual(doc.to_document(self.new_game(sample())), NEW_GAME)

    def test_sections_are_stored_in_their_own_rows(self):
        game = self.new_game(sample())
        self.assertEqual(game.name, "My Game")
        self.assertEqual(game.settings.data["gravity"], {"x": 0, "y": -9.81, "z": 0})
        self.assertEqual(game.cameras.data["fieldOfView"], 60)
        self.assertEqual(game.input.data["jump"], ["Space"])
        self.assertEqual(game.script.language, "python")
        ground = game.entities.get()
        self.assertEqual((ground.item_id, ground.name, ground.position), ("ground", "Ground", 0))
        self.assertEqual(ground.body["mode"], "static")

    def test_entity_order_is_preserved(self):
        ids = ["c", "a", "b"]
        game = self.new_game(sample(entities=[entity(i) for i in ids]))
        self.assertEqual([e["id"] for e in doc.to_document(game)["project"]["entities"]], ids)

    def test_unknown_keys_survive_a_round_trip(self):
        document = sample(entities=[entity("e", futureField={"a": 1})], newProjectKey=[1, 2])
        document["script"] = {"language": "blocks", "workspace": {"blocks": {}}, "backup": {"python": "x"}}
        self.assertEqual(doc.to_document(self.new_game(document)), document)

    def test_libraries_round_trip(self):
        document = sample(
            assets=[{"id": "tree", "url": "data:model/gltf-binary;base64,AA=="}],
            materials=[{"id": "red", "color": "#f00"}],
            prefabs=[{"id": "coin", "entities": []}],
        )
        game = self.new_game(document)
        self.assertEqual(doc.to_document(game), document)
        self.assertEqual((Asset.objects.count(), Material.objects.count(), Prefab.objects.count()), (1, 1, 1))

    def test_save_replaces_every_section(self):
        game = self.new_game(sample(entities=[entity("a"), entity("b")]))
        doc.save_document(game, sample(entities=[entity("z")]))
        self.assertEqual(list(game.entities.values_list("item_id", flat=True)), ["z"])

    def test_touch_bumps_revision(self):
        game = self.new_game(sample())
        before = game.revision
        game.touch()
        self.assertEqual(game.revision, before + 1)

    def test_descendants(self):
        game = self.new_game(sample(entities=[entity("a"), entity("b", "a"), entity("c", "b"), entity("d")]))
        self.assertEqual(sorted(doc.descendants_of(game, "a")), ["b", "c"])
        self.assertEqual(doc.descendants_of(game, "d"), [])


# ---- document.py: validation ------------------------------------------------------------

class ValidationTests(CanvasTestCase):
    def assertInvalid(self, document, message):
        with self.assertRaisesMessage(doc.DocumentError, message):
            doc.validate_document(document)

    def test_default_document_is_valid(self):
        doc.validate_document(sample())

    def test_document_shape(self):
        self.assertInvalid(None, "document must be an object")
        self.assertInvalid({**sample(), "version": 2}, "document version must be 1")
        self.assertInvalid({**sample(), "project": []}, "project must be an object")
        self.assertInvalid(sample(version=3), "project.version must be 1")

    def test_name(self):
        self.assertInvalid(sample(name=""), "name must be a non-empty string")
        self.assertInvalid(sample(name="x" * 201), "name is longer than 200")

    def test_entities(self):
        self.assertInvalid(sample(entities={}), "project.entities must be a list")
        self.assertInvalid(sample(entities=[entity("a"), entity("a")]), "duplicate id 'a'")
        self.assertInvalid(sample(entities=[{"id": "a"}]), "transform must be an object")
        self.assertInvalid(sample(entities=[entity("")]), "id must be a non-empty string")
        self.assertInvalid(sample(entities=[entity("a", tags="x")]), "tags must be a list of strings")
        self.assertInvalid(sample(entities=[entity("a", visible="yes")]), "visible must be true or false")
        self.assertInvalid(sample(entities=[entity("a", body=[1])]), "body must be an object or null")

    def test_hierarchy(self):
        self.assertInvalid(sample(entities=[entity("a", "missing")]), "parent 'missing' does not exist")
        self.assertInvalid(sample(entities=[entity("a", "a")]), "can't be its own parent")
        self.assertInvalid(sample(entities=[entity("a", "b"), entity("b", "a")]), "creates a cycle")

    def test_entity_limit(self):
        with mock.patch.object(doc, "MAX_ENTITIES", 2):
            self.assertInvalid(sample(entities=[entity("a"), entity("b"), entity("c")]), "more than 2 items")

    def test_libraries(self):
        self.assertInvalid(sample(assets=[{"url": "x"}]), "assets item: id must be a non-empty string")
        self.assertInvalid(sample(prefabs=[{"id": "p"}, {"id": "p"}]), "duplicate id 'p'")
        self.assertInvalid(sample(materials="red"), "project.materials must be a list")

    def test_sections(self):
        self.assertInvalid(sample(settings=[]), "project.settings must be an object")
        self.assertInvalid(sample(input={"jump": "Space"}), "input.jump must be a list of key codes")

    def test_script(self):
        document = sample()
        for script, message in [
            ({"language": "lua", "source": ""}, "script.language must be one of"),
            ({"language": "python"}, "script.source must be a string"),
            ({"language": "blocks"}, "script.workspace must be an object"),
            ({"language": "python", "source": "x" * (doc.MAX_SCRIPT_CHARS + 1)}, "script.source is longer"),
        ]:
            with self.subTest(script=str(script)[:40]):
                self.assertInvalid({**document, "script": script}, message)


# ---- protection: JWT, rate limit, ownership ------------------------------------------------

class ProtectionTests(CanvasTestCase):
    def setUp(self):
        super().setUp()
        self.game_id = self.create_game()["id"]

    def every_endpoint(self):
        g = f"games/{self.game_id}"
        routes = [("GET", "games/"), ("POST", "games/"), ("GET", f"{g}/"), ("PUT", f"{g}/"), ("PATCH", f"{g}/"), ("DELETE", f"{g}/"),
                  ("GET", f"{g}/entities/"), ("POST", f"{g}/entities/"), ("GET", f"{g}/entities/ground/"),
                  ("PUT", f"{g}/entities/ground/"), ("PATCH", f"{g}/entities/ground/"), ("DELETE", f"{g}/entities/ground/")]
        routes += [(m, f"{g}/{s}/") for s in SECTIONS for m in ("GET", "PUT")]
        routes += [(m, f"{g}/{lib}/") for lib in LIBRARIES for m in ("GET", "POST")]
        routes += [(m, f"{g}/{lib}/x/") for lib in LIBRARIES for m in ("GET", "PUT", "DELETE")]
        return routes

    def test_every_endpoint_needs_a_jwt(self):
        anonymous = Client()
        for method, path in self.every_endpoint():
            with self.subTest(method=method, path=path):
                self.assertEqual(self.api(method, path, {}, client=anonymous).status_code, 401)

    def test_bearer_header_works_too(self):
        client = Client(HTTP_AUTHORIZATION=f"Bearer {create_access_token(self.user)}")
        self.assertEqual(self.api("GET", "games/", client=client).status_code, 200)

    def test_every_endpoint_is_rate_limited_per_user(self):
        cache.set(_cache_key("canvas", self.user.user_id), settings.CANVAS_REQUESTS_PER_MINUTE, 60)
        for method, path in self.every_endpoint():
            with self.subTest(method=method, path=path):
                response = self.api(method, path, {})
                self.assertEqual(response.status_code, 429)
                self.assertEqual(response["Retry-After"], "60")
        other = self.client_for(self.make_user("bob"))
        self.assertEqual(self.api("GET", "games/", client=other).status_code, 200)

    def test_requests_count_towards_the_limit(self):
        self.api("GET", "games/")
        self.api("GET", f"games/{self.game_id}/")
        self.assertGreaterEqual(cache.get(_cache_key("canvas", self.user.user_id)), 2)

    def test_other_users_games_are_invisible(self):
        bob = self.client_for(self.make_user("bob"))
        self.assertEqual(self.api("GET", "games/", client=bob).json()["games"], [])
        for method, path in self.every_endpoint():
            if path.startswith("games/") and path != "games/":
                with self.subTest(method=method, path=path):
                    self.assertEqual(self.api(method, path, {"name": "x"}, client=bob).status_code, 404)
        self.assertTrue(Game.objects.filter(pk=self.game_id).exists())

    def test_unknown_game_is_404(self):
        self.assertEqual(self.api("GET", f"games/{uuid.uuid4()}/").status_code, 404)

    def test_wrong_method_is_405(self):
        self.assertEqual(self.api("POST", f"games/{self.game_id}/").status_code, 405)
        self.assertEqual(self.api("DELETE", f"games/{self.game_id}/settings/").status_code, 405)

    def test_deleted_user_cannot_create_games(self):
        self.user.delete()
        self.assertEqual(self.api("POST", "games/", {}).status_code, 401)


# ---- games --------------------------------------------------------------------------------

class GameTests(CanvasTestCase):
    def test_list_starts_empty(self):
        self.assertEqual(self.api("GET", "games/").json(), {"games": []})

    def test_create_from_defaults(self):
        game = self.create_game()
        self.assertEqual(game["document"], NEW_GAME)
        self.assertEqual(game["name"], "My Game")
        self.assertEqual(game["revision"], 1)
        uuid.UUID(game["id"])
        self.assertEqual(Game.objects.get(pk=game["id"]).owner_id, self.user.user_id)

    def test_create_with_name(self):
        game = self.create_game(name="  Maze  ")
        self.assertEqual(game["name"], "Maze")
        self.assertEqual(game["document"], new_game_document("Maze"))

    def test_create_with_document(self):
        document = sample(name="Custom", entities=[entity("a"), entity("b", "a")])
        self.assertEqual(self.create_game(document)["document"], document)

    def test_create_with_document_and_name(self):
        self.assertEqual(self.create_game(sample(), name="Renamed")["document"]["project"]["name"], "Renamed")

    def test_create_rejects_invalid(self):
        for payload in ({"document": sample(name="")}, {"name": ""}, [1], {"document": {"version": 1}}):
            with self.subTest(payload=payload):
                self.assertEqual(self.api("POST", "games/", payload).status_code, 400)
        self.assertFalse(Game.objects.exists())

    def test_create_rejects_bad_json(self):
        response = self.client.post("/api/canvas/games/", "nope", content_type="application/json")
        self.assertEqual(response.status_code, 400)

    def test_game_limit(self):
        with mock.patch("canvas.views.MAX_GAMES_PER_USER", 2):
            self.create_game()
            self.create_game()
            response = self.api("POST", "games/", {})
        self.assertEqual(response.status_code, 400)
        self.assertIn("at most 2 games", response.json()["error"])

    def test_list_is_mine_and_newest_first(self):
        first, second = self.create_game(name="First"), self.create_game(name="Second")
        self.create_game(client=self.client_for(self.make_user("bob")))
        games = self.api("GET", "games/").json()["games"]
        self.assertEqual([g["id"] for g in games], [second["id"], first["id"]])
        self.assertEqual(set(games[0]), {"id", "name", "revision", "created_at", "updated_at"})

    def test_get(self):
        game = self.create_game()
        response = self.api("GET", f"games/{game['id']}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), game)

    def test_put_replaces_the_document(self):
        game = self.create_game()
        document = sample(name="Rebuilt", entities=[entity("x")], settings={"background": "#000"})
        response = self.api("PUT", f"games/{game['id']}/", document)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["document"], document)
        self.assertEqual(response.json()["name"], "Rebuilt")
        self.assertEqual(response.json()["revision"], game["revision"] + 1)

    def test_invalid_put_changes_nothing(self):
        game = self.create_game()
        response = self.api("PUT", f"games/{game['id']}/", sample(entities=[entity("a", "missing")]))
        self.assertEqual(response.status_code, 400)
        self.assertIn("does not exist", response.json()["error"])
        self.assertEqual(self.api("GET", f"games/{game['id']}/").json(), game)

    def test_patch_renames(self):
        game = self.create_game()
        response = self.api("PATCH", f"games/{game['id']}/", {"name": "New name"})
        self.assertEqual(response.json()["name"], "New name")
        self.assertEqual(response.json()["document"]["project"]["name"], "New name")
        self.assertEqual(response.json()["revision"], game["revision"] + 1)

    def test_patch_rejects_bad_names(self):
        game = self.create_game()
        for body in ({"name": ""}, {}, [1]):
            with self.subTest(body=body):
                self.assertEqual(self.api("PATCH", f"games/{game['id']}/", body).status_code, 400)
        self.assertEqual(self.api("GET", f"games/{game['id']}/").json()["name"], "My Game")

    def test_delete_removes_everything(self):
        game = self.create_game(sample(assets=[{"id": "a"}]))
        self.assertEqual(self.api("DELETE", f"games/{game['id']}/").status_code, 204)
        self.assertEqual(self.api("GET", f"games/{game['id']}/").status_code, 404)
        self.assertEqual((Game.objects.count(), Entity.objects.count(), Asset.objects.count(), GameScript.objects.count()), (0, 0, 0, 0))


# ---- one-per-game sections ------------------------------------------------------------------

class SectionTests(CanvasTestCase):
    def setUp(self):
        super().setUp()
        self.game = self.create_game()
        self.base = f"games/{self.game['id']}"

    def test_get_each_section(self):
        project = NEW_GAME["project"]
        expected = {"settings": project["settings"], "cameras": project["cameras"], "input": project["input"],
                    "properties": project["properties"], "script": NEW_GAME["script"]}
        for section, value in expected.items():
            with self.subTest(section=section):
                self.assertEqual(self.api("GET", f"{self.base}/{section}/").json(), {"revision": 1, section: value})

    def test_put_each_section(self):
        new_values = {
            "settings": {**NEW_GAME["project"]["settings"], "gravity": {"x": 0, "y": -3, "z": 0}},
            "cameras": {**NEW_GAME["project"]["cameras"], "fieldOfView": 90},
            "input": {"jump": ["Space", "KeyJ"]},
            "properties": {"score": 0},
            "script": {"language": "blocks", "workspace": {"blocks": {"languageVersion": 0, "blocks": []}}},
        }
        revision = 1
        for section, value in new_values.items():
            with self.subTest(section=section):
                response = self.api("PUT", f"{self.base}/{section}/", value)
                self.assertEqual(response.status_code, 200, response.content)
                revision += 1
                self.assertEqual(response.json(), {"revision": revision, section: value})
        document = self.api("GET", f"{self.base}/").json()["document"]
        self.assertEqual(document["project"]["settings"]["gravity"]["y"], -3)
        self.assertEqual(document["project"]["properties"], {"score": 0})
        self.assertEqual(document["script"], new_values["script"])
        self.assertEqual(document["project"]["entities"], NEW_GAME["project"]["entities"])  # untouched

    def test_invalid_values_change_nothing(self):
        for section, value in [("settings", []), ("cameras", "x"), ("input", {"jump": "Space"}),
                               ("properties", None), ("script", {"language": "lua"})]:
            with self.subTest(section=section):
                self.assertEqual(self.api("PUT", f"{self.base}/{section}/", value).status_code, 400)
        self.assertEqual(self.api("GET", f"{self.base}/").json(), self.game)


# ---- entities -----------------------------------------------------------------------------

class EntityTests(CanvasTestCase):
    def setUp(self):
        super().setUp()
        self.game = self.create_game()
        self.base = f"games/{self.game['id']}/entities"

    def ids(self):
        return [e["id"] for e in self.api("GET", f"{self.base}/").json()["entities"]]

    def test_list(self):
        response = self.api("GET", f"{self.base}/").json()
        self.assertEqual(response, {"revision": 1, "entities": NEW_GAME["project"]["entities"]})

    def test_create_appends(self):
        response = self.api("POST", f"{self.base}/", entity("player"))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json(), {"revision": 2, "entity": entity("player")})
        self.assertEqual(self.ids(), ["ground", "player"])

    def test_create_after_a_delete_still_appends(self):
        self.api("POST", f"{self.base}/", entity("a"))
        self.api("DELETE", f"{self.base}/ground/")
        self.api("POST", f"{self.base}/", entity("b"))
        self.assertEqual(self.ids(), ["a", "b"])

    def test_create_with_parent(self):
        self.assertEqual(self.api("POST", f"{self.base}/", entity("hat", "ground")).status_code, 201)

    def test_create_errors(self):
        self.assertEqual(self.api("POST", f"{self.base}/", entity("ground")).status_code, 409)
        self.assertEqual(self.api("POST", f"{self.base}/", {"id": "x"}).status_code, 400)
        self.assertEqual(self.api("POST", f"{self.base}/", entity("x", "missing")).status_code, 400)
        self.assertEqual(self.api("POST", f"{self.base}/", None).status_code, 400)
        self.assertEqual(self.ids(), ["ground"])

    def test_entity_limit(self):
        with mock.patch("canvas.views.MAX_ENTITIES", 1):
            response = self.api("POST", f"{self.base}/", entity("x"))
        self.assertEqual(response.status_code, 400)

    def test_get_one(self):
        response = self.api("GET", f"{self.base}/ground/")
        self.assertEqual(response.json(), {"revision": 1, "entity": NEW_GAME["project"]["entities"][0]})
        self.assertEqual(self.api("GET", f"{self.base}/nope/").status_code, 404)

    def test_put_replaces(self):
        replacement = entity("ground", name="Floor")
        del replacement["id"]
        response = self.api("PUT", f"{self.base}/ground/", replacement)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["entity"], entity("ground", name="Floor"))
        self.assertEqual(response.json()["revision"], 2)

    def test_patch_changes_only_given_keys(self):
        ground = NEW_GAME["project"]["entities"][0]
        transform = {**ground["transform"], "position": {"x": 1, "y": 2, "z": 3}}
        response = self.api("PATCH", f"{self.base}/ground/", {"transform": transform, "visible": False})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["entity"], {**ground, "transform": transform, "visible": False})

    def test_id_cannot_change(self):
        self.assertEqual(self.api("PATCH", f"{self.base}/ground/", {"id": "floor"}).status_code, 400)
        self.assertEqual(self.api("PUT", f"{self.base}/ground/", entity("floor")).status_code, 400)

    def test_patch_rejects_bad_values_and_cycles(self):
        self.api("POST", f"{self.base}/", entity("child", "ground"))
        self.assertEqual(self.api("PATCH", f"{self.base}/ground/", {"parentId": "child"}).status_code, 400)
        self.assertEqual(self.api("PATCH", f"{self.base}/ground/", {"transform": None}).status_code, 400)
        self.assertEqual(self.api("PATCH", f"{self.base}/ground/", {"parentId": "ground"}).status_code, 400)
        self.assertIsNone(self.api("GET", f"{self.base}/ground/").json()["entity"]["parentId"])

    def test_delete_removes_children_too(self):
        self.api("POST", f"{self.base}/", entity("child", "ground"))
        self.api("POST", f"{self.base}/", entity("grandchild", "child"))
        self.api("POST", f"{self.base}/", entity("other"))
        response = self.api("DELETE", f"{self.base}/ground/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(sorted(response.json()["deleted"]), ["child", "grandchild", "ground"])
        self.assertEqual(self.ids(), ["other"])

    def test_delete_unknown_is_404(self):
        self.assertEqual(self.api("DELETE", f"{self.base}/nope/").status_code, 404)

    def test_changes_show_up_in_the_whole_document(self):
        self.api("POST", f"{self.base}/", entity("coin"))
        document = self.api("GET", f"games/{self.game['id']}/").json()["document"]
        self.assertEqual([e["id"] for e in document["project"]["entities"]], ["ground", "coin"])


# ---- libraries ----------------------------------------------------------------------------

class LibraryTests(CanvasTestCase):
    def setUp(self):
        super().setUp()
        self.game = self.create_game()

    def test_crud_for_each_library(self):
        for library in LIBRARIES:
            with self.subTest(library=library):
                base = f"games/{self.game['id']}/{library}"
                self.assertEqual(self.api("GET", f"{base}/").json()[library], [])

                created = self.api("POST", f"{base}/", {"id": "one", "v": 1})
                self.assertEqual(created.status_code, 201)
                self.assertEqual(created.json()["item"], {"id": "one", "v": 1})
                self.api("POST", f"{base}/", {"id": "two"})
                self.assertEqual([i["id"] for i in self.api("GET", f"{base}/").json()[library]], ["one", "two"])

                self.assertEqual(self.api("GET", f"{base}/one/").json()["item"], {"id": "one", "v": 1})
                self.assertEqual(self.api("PUT", f"{base}/one/", {"v": 2}).json()["item"], {"id": "one", "v": 2})

                self.assertEqual(self.api("DELETE", f"{base}/one/").json()["deleted"], "one")
                self.assertEqual(self.api("GET", f"{base}/one/").status_code, 404)
                document = self.api("GET", f"games/{self.game['id']}/").json()["document"]
                self.assertEqual(document["project"][library], [{"id": "two"}])

    def test_errors(self):
        base = f"games/{self.game['id']}/assets"
        self.api("POST", f"{base}/", {"id": "a"})
        self.assertEqual(self.api("POST", f"{base}/", {"id": "a"}).status_code, 409)
        self.assertEqual(self.api("POST", f"{base}/", {"url": "x"}).status_code, 400)
        self.assertEqual(self.api("PUT", f"{base}/a/", {"id": "b"}).status_code, 400)
        self.assertEqual(self.api("PUT", f"{base}/missing/", {}).status_code, 404)
        self.assertEqual(self.api("DELETE", f"{base}/missing/").status_code, 404)

    def test_library_limit(self):
        with mock.patch("canvas.views.MAX_LIBRARY_ITEMS", 0):
            self.assertEqual(self.api("POST", f"games/{self.game['id']}/materials/", {"id": "m"}).status_code, 400)

    def test_each_write_bumps_the_revision(self):
        base = f"games/{self.game['id']}/prefabs"
        revisions = [
            self.api("POST", f"{base}/", {"id": "p"}).json()["revision"],
            self.api("PUT", f"{base}/p/", {"x": 1}).json()["revision"],
            self.api("DELETE", f"{base}/p/").json()["revision"],
        ]
        self.assertEqual(revisions, [2, 3, 4])
