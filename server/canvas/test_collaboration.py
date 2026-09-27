import copy
import uuid
from datetime import timedelta
from django.utils import timezone
from .tests import CanvasTestCase, sample, entity
from . import collaboration as service
from .collaboration_ops import OpError
from .models import Game, WorkspaceMember, WorkspaceLock
from .document import to_document


class CollaborationTests(CanvasTestCase):
    def setUp(self):
        super().setUp()
        self.editor = self.make_user("editor")
        self.stranger = self.make_user("stranger")
        self.game = self.create_game(sample(entities=[entity("one"), entity("two")]))
        self.id = self.game["id"]
        self.conn = str(uuid.uuid4())
        self.other = str(uuid.uuid4())
        self.url = f"/api/canvas/games/{self.id}/workspace/"

    def enable(self):
        response = self.client.post(self.url, {}, content_type="application/json", HTTP_IF_MATCH=f'"{self.game["revision"]}"')
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["code"]

    def join(self, code):
        return self.api("POST", "workspaces/join/", {"code": code}, self.client_for(self.editor))

    def op(self, resource="entity:one", name="Changed"):
        before = service.snapshot(self.user.user_id, self.id)["document"]["project"]["entities"][0]
        after = copy.deepcopy(before); after["name"] = name
        return {"op": "set", "resource": resource, "before": before, "value": after}

    def test_invite_only_access_and_single_owner(self):
        self.enable()
        with self.assertRaises(OpError): service.snapshot(self.stranger.user_id, self.id)
        self.assertEqual(self.api("GET", f"games/{self.id}/", client=self.client_for(self.stranger)).status_code, 404)
        self.assertEqual(self.api("DELETE", f"games/{self.id}/members/{self.user.user_id}/").status_code, 400)
        self.assertEqual(Game.objects.get(pk=self.id).owner_id, self.user.user_id)

    def test_reset_disable_and_idempotent_join(self):
        code = self.enable()
        self.assertEqual(self.join(code).status_code, 200)
        self.assertEqual(self.join(code).status_code, 200)
        self.assertEqual(WorkspaceMember.objects.count(), 1)
        fresh = self.client.post(self.url, {}, content_type="application/json").json()["code"]
        self.assertNotEqual(code, fresh)
        self.assertEqual(self.join(code).status_code, 404)
        self.client.delete(self.url)
        self.assertEqual(self.join(fresh).status_code, 404)
        self.assertEqual(service.snapshot(self.editor.user_id, self.id)["rev"], self.game["revision"])

    def test_editor_permissions_and_code_privacy(self):
        self.join(self.enable()); client = self.client_for(self.editor)
        self.assertIsNone(client.get(self.url).json()["code"])
        for method in ("post", "delete"):
            self.assertEqual(getattr(client, method)(self.url, {}, content_type="application/json").status_code, 403)
        for method in ("PATCH", "DELETE"):
            self.assertEqual(self.api(method, f"games/{self.id}/", {"name": "No"}, client).status_code, 403)
        self.assertEqual(self.api("GET", "games/", client=client).json()["games"][0]["role"], "editor")

    def test_shared_http_writes_rejected_but_reads_work(self):
        self.enable()
        for path, body in [("", self.game["document"]), ("settings/", {}), ("entities/one/", entity("one"))]:
            self.assertEqual(self.api("PUT", f"games/{self.id}/{path}", body).status_code, 409)
            self.assertEqual(self.api("GET", f"games/{self.id}/{path}").status_code, 200)

    def test_atomic_activation_revision(self):
        response = self.client.post(self.url, {}, content_type="application/json", HTTP_IF_MATCH='"0"')
        self.assertEqual(response.status_code, 412)
        self.assertFalse(Game.objects.get(pk=self.id).collaboration)

    def test_commit_retry_and_canvas_roundtrip(self):
        self.enable(); user = self.user.user_id
        service.acquire(user, self.id, self.conn, ["entity:one"])
        commit_id = str(uuid.uuid4()); ops = [self.op()]
        first = service.commit(user, self.id, self.conn, commit_id, self.game["revision"], ops)
        second = service.commit(user, self.id, self.conn, commit_id, self.game["revision"], ops)
        self.assertEqual(first["rev"], second["rev"])
        self.assertEqual(to_document(Game.objects.get(pk=self.id))["project"]["entities"][0]["name"], "Changed")
        self.assertEqual(len(service.replay(user, self.id, self.game["revision"])), 1)

    def test_python_source_commits_without_exclusive_lease(self):
        self.join(self.enable())
        user = self.user.user_id
        original = service.snapshot(user, self.id)["document"]
        service.acquire(user, self.id, self.conn, ["script"])
        frame = service.commit(user, self.id, self.conn, str(uuid.uuid4()), self.game["revision"], [{"op": "set", "resource": "script", "before": original["script"], "value": {"language": "python", "source": "# start\n"}}])
        service.release(user, self.id, self.conn)
        op = {"op": "set", "resource": "source", "before": "# start\n", "value": "# start\n# owner\n"}
        first = service.commit(user, self.id, self.conn, str(uuid.uuid4()), frame["rev"], [op])
        with self.assertRaises(OpError) as error:
            service.commit(self.editor.user_id, self.id, self.other, str(uuid.uuid4()), frame["rev"], [op])
        self.assertEqual(error.exception.code, "REV_MISMATCH")
        op = {**op, "before": op["value"], "value": op["value"] + "# peer\n"}
        service.commit(self.editor.user_id, self.id, self.other, str(uuid.uuid4()), first["rev"], [op])
        self.assertEqual(service.snapshot(user, self.id)["document"]["script"]["source"], op["value"])
        service.acquire(user, self.id, self.conn, ["*"])
        with self.assertRaises(OpError) as error:
            service.commit(self.editor.user_id, self.id, self.other, str(uuid.uuid4()), first["rev"] + 1, [{**op, "before": op["value"]}])
        self.assertEqual(error.exception.code, "LOCK_HELD")

    def test_stale_revision_and_before_value(self):
        self.enable(); user = self.user.user_id
        service.acquire(user, self.id, self.conn, ["entity:one"])
        ops = [self.op()]
        result = service.commit(user, self.id, self.conn, str(uuid.uuid4()), self.game["revision"], ops)
        for revision in (self.game["revision"], result["rev"]):
            with self.assertRaises(OpError): service.commit(user, self.id, self.conn, str(uuid.uuid4()), revision, ops)

    def test_locks_are_per_connection_and_expire(self):
        self.join(self.enable()); user = self.user.user_id
        service.acquire(user, self.id, self.conn, ["entity:one"])
        with self.assertRaises(OpError): service.acquire(user, self.id, self.other, ["entity:one"])
        service.acquire(self.editor.user_id, self.id, self.other, ["entity:two"])
        with self.assertRaises(OpError): service.acquire(self.editor.user_id, self.id, self.other, ["*"])
        WorkspaceLock.objects.filter(connection=self.conn).update(expires_at=timezone.now() - timedelta(seconds=1))
        service.acquire(self.editor.user_id, self.id, self.other, ["entity:one"])

    def test_removed_member_cannot_commit_or_rejoin(self):
        self.join(self.enable()); user = self.editor.user_id
        service.acquire(user, self.id, self.other, ["entity:one"])
        self.api("DELETE", f"games/{self.id}/members/{user}/")
        with self.assertRaises(OpError): service.snapshot(user, self.id)
        with self.assertRaises(OpError): service.commit(user, self.id, self.other, str(uuid.uuid4()), self.game["revision"], [self.op()])
        self.assertFalse(WorkspaceLock.objects.filter(user_id=user).exists())

    def test_editor_document_replacement_cannot_rename(self):
        self.join(self.enable()); user = self.editor.user_id
        service.acquire(user, self.id, self.other, ["*"])
        original = service.snapshot(user, self.id)["document"]
        changed = copy.deepcopy(original); changed["project"]["name"] = "Stolen name"
        with self.assertRaises(OpError): service.commit(user, self.id, self.other, str(uuid.uuid4()), self.game["revision"], [{"op": "set", "resource": "*", "before": original, "value": changed}])

    def test_leave_preserves_workspace(self):
        self.join(self.enable()); user = self.editor.user_id
        response = self.api("DELETE", f"games/{self.id}/members/{user}/", client=self.client_for(self.editor))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(Game.objects.filter(pk=self.id).exists())

    def test_script_and_asset_replacement_roundtrip(self):
        self.enable(); user = self.user.user_id
        service.acquire(user, self.id, self.conn, ["*"])
        original = service.snapshot(user, self.id)["document"]
        updated = copy.deepcopy(original)
        updated["script"] = {"language": "python", "source": "print('shared')", "blocksBackup": {"blocks": {"languageVersion": 0, "blocks": []}}}
        updated["project"]["assets"] = [{"id": "texture", "type": "texture", "url": "data:image/png;base64,YQ=="}]
        service.commit(user, self.id, self.conn, str(uuid.uuid4()), self.game["revision"], [{"op": "set", "resource": "*", "before": original, "value": updated}])
        actual = service.snapshot(user, self.id)["document"]
        self.assertEqual(actual["script"], updated["script"])
        self.assertEqual(actual["project"]["assets"], updated["project"]["assets"])

    def test_heartbeat_does_not_revive_expired_lock(self):
        self.enable(); user = self.user.user_id
        service.acquire(user, self.id, self.conn, ["entity:one"])
        WorkspaceLock.objects.filter(connection=self.conn).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(service.state(user, self.id, self.conn)["locks"], [])

    def test_rename_gap_requires_snapshot(self):
        self.enable(); user = self.user.user_id
        self.api("PATCH", f"games/{self.id}/", {"name": "Renamed"})
        self.assertIsNone(service.replay(user, self.id, self.game["revision"]))
        self.assertEqual(service.snapshot(user, self.id)["document"]["project"]["name"], "Renamed")

    def test_activation_assigns_stable_block_ids_once(self):
        document = copy.deepcopy(self.game["document"])
        document["script"] = {"language": "blocks", "workspace": {"blocks": {"languageVersion": 0, "blocks": [{"type": "bark_start", "inputs": {"DO": {"block": {"type": "text_print"}}}}]}}}
        response = self.api("PUT", f"games/{self.id}/", document)
        self.assertEqual(response.status_code, 200)
        self.game = response.json()
        code = self.enable()
        first = service.snapshot(self.user.user_id, self.id)
        root = first["document"]["script"]["workspace"]["blocks"]["blocks"][0]
        self.assertTrue(root["id"])
        self.assertTrue(root["inputs"]["DO"]["block"]["id"])
        self.join(code)
        self.assertEqual(service.snapshot(self.editor.user_id, self.id)["document"], first["document"])
        self.client.post(self.url, {}, content_type="application/json")
        self.assertEqual(service.snapshot(self.user.user_id, self.id)["rev"], first["rev"])
