import base64
import uuid
from datetime import timedelta
from django.test import Client
from django.utils import timezone
from canvas.tests import CanvasTestCase, sample
from canvas.models import Game, WorkspaceMember
from canvas import collaboration
from .models import Publication


class PublishingTests(CanvasTestCase):
    def setUp(self):
        super().setUp()
        self.game = self.create_game(name="Forest adventure")
        self.url = f"/api/marketplace/games/{self.game['id']}/"
        self.visitor = Client()

    def publish(self, value=True, client=None):
        return (client or self.client).put(self.url + "publication/", {"is_public": value}, content_type="application/json")

    def test_private_and_owner_only(self):
        self.assertEqual(self.visitor.get(self.url).status_code, 404)
        self.assertEqual(self.visitor.get("/api/marketplace/games/").json()["count"], 0)
        other = self.make_user("other")
        client = self.client_for(other)
        self.assertEqual(self.publish(client=client).status_code, 404)
        self.assertEqual(client.get(self.url + "publication/").status_code, 404)
        self.assertEqual(self.visitor.put(self.url + "publication/", {"is_public": True}, content_type="application/json").status_code, 401)

    def test_collaborator_sees_status_but_cannot_publish(self):
        other = self.make_user("editor")
        WorkspaceMember.objects.create(game_id=self.game["id"], user=other)
        client = self.client_for(other)
        self.assertEqual(self.publish(client=client).status_code, 404)
        self.publish()
        saved = self.api("GET", f"games/{self.game['id']}/", client=client)
        self.assertEqual(saved.json()["publication"], {"is_public": True})

    def test_publish_idempotent_and_no_document_revision_change(self):
        first = self.publish().json()
        self.assertEqual(first, self.publish().json())
        self.assertEqual(Game.objects.get(pk=self.game["id"]).revision, self.game["revision"])
        response = self.visitor.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response["Cache-Control"])
        self.assertNotIn("owner", response.json())
        self.assertNotIn("email", response.content.decode())

    def test_saved_edits_and_rename_are_live(self):
        self.publish()
        self.api("PUT", f"games/{self.game['id']}/", sample(name="New world"))
        public = self.visitor.get(self.url).json()
        self.assertEqual(public["name"], "New world")
        self.assertEqual(public["document"]["project"]["name"], "New world")
        self.assertEqual(public["revision"], self.game["revision"] + 1)

    def test_collaborator_commits_update_the_public_document(self):
        other = self.make_user("builder")
        WorkspaceMember.objects.create(game_id=self.game["id"], user=other)
        Game.objects.filter(pk=self.game["id"]).update(collaboration=True)
        self.publish()
        connection = str(uuid.uuid4())
        collaboration.acquire(other.user_id, self.game["id"], connection, ["section:properties"])
        result = collaboration.commit(other.user_id, self.game["id"], connection, str(uuid.uuid4()), self.game["revision"],
            [{"op": "set", "resource": "section:properties", "before": self.game["document"]["project"].get("properties"), "value": {"builtTogether": True}}])
        public = self.visitor.get(self.url).json()
        self.assertEqual(public["document"]["project"]["properties"], {"builtTogether": True})
        self.assertEqual(public["revision"], result["rev"])
        self.assertEqual(self.publish(False, self.client_for(other)).status_code, 404)

    def test_unpublish_republish_and_delete(self):
        first = self.publish().json()
        self.assertEqual(self.publish(False).status_code, 200)
        self.assertEqual(self.visitor.get(self.url).status_code, 404)
        self.assertEqual(self.visitor.get("/api/marketplace/games/").json()["count"], 0)
        self.assertEqual(self.publish().json()["published_at"], first["published_at"])
        self.api("DELETE", f"games/{self.game['id']}/")
        self.assertEqual(self.visitor.get(self.url).status_code, 404)
        self.assertEqual(Publication.objects.count(), 0)

    def test_search_pagination_and_lightweight_list(self):
        self.publish()
        self.assertEqual(self.visitor.get("/api/marketplace/games/?q=forest").json()["count"], 1)
        self.assertEqual(self.visitor.get("/api/marketplace/games/?q=alice").json()["count"], 1)
        self.assertEqual(self.visitor.get("/api/marketplace/games/?q=nothing").json()["count"], 0)
        row = self.visitor.get("/api/marketplace/games/").json()["games"][0]
        self.assertNotIn("document", row)
        self.assertEqual(self.visitor.get("/api/marketplace/games/?page=2").json()["games"], [])
        self.assertEqual(self.visitor.get("/api/marketplace/games/?page=bad").status_code, 400)

    def test_invalid_visibility_and_changed_account(self):
        self.assertEqual(self.client.put(self.url + "publication/", {"is_public": "true"}, content_type="application/json").status_code, 400)
        self.assertEqual(self.client.put(self.url + "publication/", {"is_public": True}, content_type="application/json", HTTP_X_BARK_OWNER="other").status_code, 401)

    def test_pages_are_distinct_and_newest_first(self):
        now = timezone.now()
        for index in range(26):
            game = Game.objects.create(owner=self.user, name=f"World {index}")
            Publication.objects.create(game=game, is_public=True, published_at=now + timedelta(seconds=index))
        first = self.visitor.get("/api/marketplace/games/").json()
        second = self.visitor.get("/api/marketplace/games/?page=2").json()
        self.assertEqual(first["count"], 26)
        self.assertTrue(first["has_more"])
        self.assertEqual(len(first["games"]), 24)
        self.assertEqual(first["games"][0]["name"], "World 25")
        self.assertEqual([game["name"] for game in second["games"]], ["World 1", "World 0"])
        self.assertFalse(second["has_more"])

    def test_cover_visibility_and_revision(self):
        self.publish()
        png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
        data = {"png": png, "revision": self.game["revision"]}
        self.assertEqual(self.client.put(self.url + "cover/", data, content_type="application/json").status_code, 204)
        self.assertEqual(self.visitor.get(self.url + "cover/").content, base64.b64decode(png))
        data["revision"] += 1
        self.assertEqual(self.client.put(self.url + "cover/", data, content_type="application/json").status_code, 409)
        self.publish(False)
        self.assertEqual(self.visitor.get(self.url + "cover/").status_code, 404)
