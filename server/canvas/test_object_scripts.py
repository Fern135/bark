import uuid
from django.test import Client

from .tests import CanvasTestCase, sample, entity
from .document import validate_document, DocumentError, to_document, save_document
from .collaboration_ops import apply_ops, conflicts, value_at, OpError
from .models import Game
from .test_collaboration import CollaborationTests
from . import collaboration as service


class ObjectScriptDocumentTests(CanvasTestCase):
    def document(self):
        return {**sample(entities=[entity("one"), entity("child", "one")]), "version": 2,
                "objectScripts": {"one": {"language": "python", "source": "print(this.id)"},
                                  "child": {"language": "blocks", "workspace": {}}}}

    def test_database_roundtrip_and_entity_delete(self):
        document = self.document()
        created = self.create_game(document)
        game = Game.objects.get(pk=created["id"])
        self.assertEqual(to_document(game)["objectScripts"], document["objectScripts"])
        result = self.api("DELETE", f"games/{game.pk}/entities/one/")
        self.assertEqual(result.status_code, 200)
        game.refresh_from_db()
        self.assertEqual(game.object_scripts, {})

    def test_published_player_document_preserves_object_code(self):
        document = self.document()
        created = self.create_game(document)
        url = f"/api/marketplace/games/{created['id']}/"
        result = self.client.put(url + "publication/", {"is_public": True}, content_type="application/json")
        self.assertEqual(result.status_code, 200)
        public = Client().get(url).json()["document"]
        self.assertEqual(public["version"], 2)
        self.assertEqual(public["script"], document["script"])
        self.assertEqual(public["objectScripts"], document["objectScripts"])

    def test_legacy_upgrade_is_an_atomic_edit(self):
        document = sample(entities=[entity("one")])
        script = {"language": "python", "source": "print(this.id)"}
        updated = apply_ops(document, [
            {"op": "set", "resource": "version", "before": 1, "value": 2},
            {"op": "set", "resource": "object:one:script", "before": None, "value": script}])
        validate_document(updated)
        self.assertEqual(updated["script"], document["script"])
        self.assertEqual(updated["objectScripts"], {"one": script})
        self.assertEqual(apply_ops(updated, [{"op": "set", "resource": "version", "before": 1, "value": 2}]), updated)

    def test_rejects_missing_owners_and_malformed_scripts(self):
        document = self.document()
        document["objectScripts"]["missing"] = {"language": "python", "source": ""}
        with self.assertRaisesMessage(DocumentError, "does not exist"):
            validate_document(document)
        document = self.document()
        document["objectScripts"]["one"]["source"] = 42
        with self.assertRaises(DocumentError):
            validate_document(document)

    def test_object_resources_are_isolated_and_deletion_is_atomic(self):
        document = self.document()
        resource = "object:one:source"
        changed = apply_ops(document, [{"op": "set", "resource": resource, "before": value_at(document, resource), "value": "x = 2"}])
        self.assertEqual(changed["script"], document["script"])
        self.assertEqual(changed["objectScripts"]["one"]["source"], "x = 2")
        self.assertFalse(conflicts("object:one:script", "object:child:source", document))
        self.assertFalse(conflicts("script", "object:one:source", document))
        self.assertTrue(conflicts("object:one:script", "object:one:source", document))
        self.assertTrue(conflicts("*", "object:one:source", document))
        ops = [{"op": "set", "resource": "entity:child", "before": value_at(document, "entity:child"), "value": None},
               {"op": "set", "resource": "object:child:script", "before": document["objectScripts"]["child"], "value": None}]
        validate_document(apply_ops(document, ops))
        self.assertIn("child", document["objectScripts"])


class ObjectScriptCollaborationTests(CollaborationTests):
    def test_object_source_is_concurrent_and_script_locks_stay_local(self):
        game = Game.objects.get(pk=self.id)
        document = to_document(game)
        document.update(version=2, objectScripts={id: {"language": "python", "source": "x = 1"} for id in ("one", "two")})
        save_document(game, document)
        self.game["revision"] = game.revision
        self.join(self.enable())
        service.acquire(self.user.user_id, self.id, self.conn, ["object:one:script"])
        revision = service.snapshot(self.editor.user_id, self.id)["rev"]
        op = {"op": "set", "resource": "object:two:source", "before": "x = 1", "value": "x = 2"}
        result = service.commit(self.editor.user_id, self.id, self.other, str(uuid.uuid4()), revision, [op])
        self.assertEqual(result["type"], "patch")
        with self.assertRaises(OpError):
            service.commit(self.editor.user_id, self.id, self.other, str(uuid.uuid4()), result["rev"], [{**op, "resource": "object:one:source"}])
