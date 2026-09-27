import copy
import json
from pathlib import Path
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from django.conf import settings
from django.core.cache import cache
from django.test import Client, override_settings

from authenticator.models import User
from authenticator.tokens import create_access_token
from lib.testing import IsolatedTestCase
from .views import call_openai, checked_suggestion, valid_body

BODY = {"revision": "1", "snapshot": {
    "language": "python", "python": "from bark import game\n@game.on_start\nasync def start():\n    game.wait(1)",
    "sourceMap": {}, "blocks": [], "context": {}, "diagnostics": [],
}, "dismissed": []}
HINT = {"category": "bug", "message": "Add await before game.wait(1) so the handler pauses.", "issueKey": "missing-await", "line": 4, "blockId": None}


@override_settings(BYTE_HINTS_ENABLED=True, OPENAI_API_KEY="test-placeholder", OPENAI_MODEL="gpt-5.4-mini-2026-03-17")
class ReviewTests(IsolatedTestCase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create(user_id="coach-user", username="coach-user", email="coach@example.test", password="unused")
        self.client.cookies[settings.JWT_ACCESS_COOKIE] = create_access_token(self.user)

    def post(self, body=None, client=None):
        return (client or self.client).post("/api/coach/review/", BODY if body is None else body, content_type="application/json")

    @patch("coach.views.call_openai", return_value={"suggestion": HINT})
    def test_valid_review_is_read_only_and_no_store(self, provider):
        response = self.post()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"revision": "1", "suggestion": HINT})
        self.assertEqual(response["Cache-Control"], "no-store")
        provider.assert_called_once_with(BODY)

    @patch("coach.views.call_openai", return_value={"suggestion": None})
    def test_null_is_success(self, provider):
        self.assertIsNone(self.post().json()["suggestion"])

    @patch("coach.views.call_openai")
    def test_authentication_and_csrf(self, provider):
        self.assertEqual(self.post(client=Client()).status_code, 401)
        csrf = Client(enforce_csrf_checks=True)
        csrf.cookies[settings.JWT_ACCESS_COOKIE] = create_access_token(self.user)
        self.assertEqual(self.post(client=csrf).status_code, 403)
        provider.assert_not_called()

    @patch("coach.views.call_openai")
    def test_deleted_user_is_unauthorized(self, provider):
        self.user.delete()
        self.assertEqual(self.post().status_code, 401)
        provider.assert_not_called()

    @patch("coach.views.call_openai")
    def test_disabled_or_missing_key(self, provider):
        for options in ({"BYTE_HINTS_ENABLED": False}, {"OPENAI_API_KEY": ""}):
            with self.settings(**options):
                self.assertEqual(self.post().status_code, 503)
        provider.assert_not_called()

    @patch("coach.views.call_openai")
    def test_body_limits_and_validation(self, provider):
        body = copy.deepcopy(BODY)
        body["snapshot"]["python"] = "x" * 65536
        self.assertEqual(self.post(body).status_code, 413)
        for bad in ({}, [], {**BODY, "revision": 3}, {**BODY, "dismissed": ["bad"]}):
            self.assertEqual(self.post(bad).status_code, 400)
        self.assertEqual(self.client.post("/api/coach/review/", "{", content_type="application/json").status_code, 400)
        provider.assert_not_called()

    @patch("coach.views.call_openai", return_value={"suggestion": None})
    def test_budget_reserved_before_provider(self, provider):
        def upstream(_):
            self.assertEqual(self.post().status_code, 429)
            return {"suggestion": None}
        provider.side_effect = upstream
        self.assertEqual(self.post().status_code, 200)
        provider.assert_called_once()
        response = self.post()
        self.assertEqual(response["Retry-After"], "45")

    def test_cache_reservation_has_one_concurrent_winner(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            won = list(pool.map(lambda _: cache.add("coach-concurrent-test", True, timeout=45), range(20)))
        self.assertEqual(sum(won), 1)

    @patch("coach.views.call_openai", side_effect=TimeoutError("private upstream detail"))
    def test_failure_is_quiet_and_keeps_budget(self, provider):
        with self.assertLogs("coach.views", level="WARNING") as logs:
            response = self.post()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response["Retry-After"], "120")
        self.assertNotIn("private", response.content.decode() + str(logs.output))
        self.assertEqual(self.post().status_code, 429)

    @patch("coach.views.call_openai", side_effect=urllib.error.HTTPError("https://api.openai.com", 429, "private", {"Retry-After": "180"}, None))
    def test_upstream_retry_after(self, provider):
        self.assertEqual(self.post()["Retry-After"], "180")

    @patch("coach.views.call_openai", return_value={"suggestion": {**HINT, "line": 999}})
    def test_invalid_model_location(self, provider):
        self.assertEqual(self.post().status_code, 503)

    @patch("coach.views.call_openai", return_value={"suggestion": HINT})
    def test_reworded_dismissed_issue_is_suppressed(self, provider):
        body = copy.deepcopy(BODY)
        body["dismissed"] = [{"issueKey": "missing-await", "message": "Different wording", "target": "game.wait(1)"}]
        self.assertIsNone(self.post(body).json()["suggestion"])

    def test_block_reference_validation(self):
        body = copy.deepcopy(BODY)
        body["snapshot"].update(language="blocks", blocks=[{"id": "b1", "label": "wait 1 seconds"}], sourceMap={"4": "b1"})
        self.assertTrue(valid_body(body))
        hint = {**HINT, "blockId": "b1"}
        self.assertEqual(checked_suggestion({"suggestion": hint}, body["snapshot"]), hint)
        for changes in ({"blockId": "gone"}, {"line": 3}, {"line": True}, {"message": "One. Two. Three."}):
            with self.assertRaises(ValueError):
                checked_suggestion({"suggestion": {**hint, **changes}}, body["snapshot"])

    def test_quality_fixtures_match_request_contract(self):
        for fixture in json.loads(Path(__file__).with_name("fixtures.json").read_text()):
            body = copy.deepcopy(BODY)
            body["snapshot"].update({key: fixture[key] for key in ("python", "language", "sourceMap", "blocks") if key in fixture})
            self.assertTrue(valid_body(body), fixture["name"])

    @patch("coach.views.urllib.request.urlopen")
    def test_provider_request_and_structured_output(self, urlopen):
        urlopen.return_value.__enter__.return_value.read.return_value = json.dumps({"status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps({"suggestion": HINT})}]}]}).encode()
        self.assertEqual(call_openai(BODY), {"suggestion": HINT})
        request = urlopen.call_args.args[0]
        payload = json.loads(request.data)
        self.assertFalse(payload["store"])
        self.assertEqual(payload["max_output_tokens"], 2000)
        self.assertEqual(urlopen.call_args.kwargs["timeout"], 20)
        self.assertTrue(payload["text"]["format"]["strict"])
        self.assertNotIn("tools", payload)
        self.assertIn("untrusted data", payload["instructions"])
        self.assertNotIn("test-placeholder", json.dumps(payload))

    @patch("coach.views.urllib.request.urlopen")
    def test_refused_incomplete_and_malformed_provider_outputs(self, urlopen):
        for data in (
            {"status": "incomplete"},
            {"status": "completed", "output": [{"type": "message", "content": [{"type": "refusal", "refusal": "No"}]}]},
            {"status": "completed", "output": []},
        ):
            urlopen.return_value.__enter__.return_value.read.return_value = json.dumps(data).encode()
            with self.assertRaises(ValueError):
                call_openai(BODY)

    @patch("coach.views.urllib.request.urlopen", side_effect=TimeoutError())
    def test_no_provider_retry(self, urlopen):
        with self.assertRaises(TimeoutError):
            call_openai(BODY)
        urlopen.assert_called_once()
