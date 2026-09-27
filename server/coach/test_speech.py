import json
import urllib.error
from email.message import Message
from unittest.mock import patch

from django.conf import settings
from django.test import Client, override_settings

from authenticator.models import User
from authenticator.tokens import create_access_token
from lib.testing import IsolatedTestCase
from .speech import MAX_AUDIO, synthesize

TIP = "Make a treasure hunt with your Gem and Flag."
AUDIO = b"ID3-test-audio"


@override_settings(BYTE_VOICE_ENABLED=True, ELEVENLABS_API_KEY="private-test-key",
                   ELEVENLABS_VOICE_ID="MkTSSXNgnBULS6ek4pon", ELEVENLABS_MODEL_ID="eleven_flash_v2_5")
class SpeechTests(IsolatedTestCase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create(user_id="voice-user", username="voice-user", email="voice@example.test", password="unused")
        self.client.cookies[settings.JWT_ACCESS_COOKIE] = create_access_token(self.user)

    def post(self, body=None, client=None):
        return (client or self.client).post("/api/coach/speech/", {"text": TIP} if body is None else body, content_type="application/json")

    @patch("coach.speech.synthesize", return_value=AUDIO)
    def test_speaks_tip_as_private_audio(self, provider):
        response = self.post({"text": f"  {TIP}  "})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, AUDIO)
        self.assertEqual(response["Content-Type"], "audio/mpeg")
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        provider.assert_called_once_with(TIP)

    @patch("coach.speech.synthesize")
    def test_requires_current_account_post_and_csrf(self, provider):
        self.assertEqual(self.post(client=Client()).status_code, 401)
        csrf = Client(enforce_csrf_checks=True)
        csrf.cookies[settings.JWT_ACCESS_COOKIE] = create_access_token(self.user)
        self.assertEqual(self.post(client=csrf).status_code, 403)
        self.assertEqual(self.client.get("/api/coach/speech/").status_code, 405)
        self.user.delete()
        self.assertEqual(self.post().status_code, 401)
        provider.assert_not_called()

    @patch("coach.speech.synthesize")
    def test_rejects_invalid_long_and_provider_override_requests(self, provider):
        for body in ({}, [], {"text": 7}, {"text": " "}, {"text": "x" * 801},
                     {"text": TIP, "voice_id": "other"}, {"text": TIP, "model_id": "other"}):
            self.assertEqual(self.post(body).status_code, 400)
        self.assertEqual(self.post({"text": "x" * 8192}).status_code, 413)
        self.assertEqual(self.client.post("/api/coach/speech/", "{", content_type="application/json").status_code, 400)
        provider.assert_not_called()

    @patch("coach.speech.synthesize")
    def test_missing_key_and_disabled_voice_leave_text_features_available(self, provider):
        for config in ({"ELEVENLABS_API_KEY": ""}, {"BYTE_VOICE_ENABLED": False}):
            with self.settings(**config):
                response = self.post()
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response["Retry-After"], "120")
                self.assertEqual(response["Cache-Control"], "no-store")
        provider.assert_not_called()

    @patch("coach.speech.time.time", return_value=120)
    @patch("coach.speech.synthesize", return_value=AUDIO)
    def test_budget_is_per_user_and_reserved_before_provider(self, provider, clock):
        for _ in range(6):
            self.assertEqual(self.post().status_code, 200)
        response = self.post()
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response["Retry-After"], "60")
        self.assertEqual(provider.call_count, 6)
        other = User.objects.create(user_id="other-voice", username="other-voice", email="other@example.test", password="unused")
        self.client.cookies[settings.JWT_ACCESS_COOKIE] = create_access_token(other)
        self.assertEqual(self.post().status_code, 200)

    @patch("coach.speech.synthesize")
    def test_only_one_outstanding_call_and_lock_is_released(self, provider):
        def upstream(_):
            self.assertEqual(self.post().status_code, 429)
            return AUDIO
        provider.side_effect = upstream
        self.assertEqual(self.post().status_code, 200)
        provider.assert_called_once()
        provider.side_effect = None
        provider.return_value = AUDIO
        self.assertEqual(self.post().status_code, 200)

    @patch("coach.speech.time.time", return_value=120)
    @patch("coach.speech.synthesize", side_effect=TimeoutError("private upstream detail"))
    def test_failures_are_private_and_count_toward_budget(self, provider, clock):
        with self.assertLogs("coach.speech", level="WARNING") as logs:
            responses = [self.post() for _ in range(6)]
        self.assertTrue(all(response.status_code == 503 for response in responses))
        self.assertNotIn("private", responses[0].content.decode() + str(logs.output))
        self.assertEqual(self.post().status_code, 429)

    @patch("coach.speech.urllib.request.urlopen")
    def test_provider_uses_chosen_voice_server_key_and_bounded_read(self, urlopen):
        upstream = urlopen.return_value.__enter__.return_value
        upstream.headers = Message()
        upstream.headers["Content-Type"] = "audio/mpeg"
        upstream.read.return_value = AUDIO
        self.assertEqual(synthesize(TIP), AUDIO)
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.elevenlabs.io/v1/text-to-speech/MkTSSXNgnBULS6ek4pon?output_format=mp3_44100_128")
        self.assertEqual(json.loads(request.data), {"text": TIP, "model_id": "eleven_flash_v2_5"})
        self.assertEqual(request.get_header("Xi-api-key"), "private-test-key")
        self.assertEqual(urlopen.call_args.kwargs["timeout"], 20)
        upstream.read.assert_called_once_with(MAX_AUDIO + 1)

    @patch("coach.speech.urllib.request.urlopen")
    def test_rejects_non_audio_empty_or_oversized_upstream(self, urlopen):
        upstream = urlopen.return_value.__enter__.return_value
        for kind, data in (("application/json", b"{}"), ("audio/mpeg", b""), ("audio/mpeg", b"x" * (MAX_AUDIO + 1))):
            upstream.headers = Message()
            upstream.headers["Content-Type"] = kind
            upstream.read.return_value = data
            with self.assertRaises(ValueError):
                synthesize(TIP)

    @patch("coach.speech.synthesize", side_effect=urllib.error.HTTPError("https://api.elevenlabs.io", 401, "secret detail", {}, None))
    def test_provider_auth_failure_is_not_exposed_as_user_auth_failure(self, provider):
        response = self.post()
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("secret detail", response.content.decode())
