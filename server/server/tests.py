"""Project-wide settings: CORS for the web frontend, and internal hosts for web (SSR) and ws.

    docker compose exec server python manage.py test server
"""
from django.conf import settings
from django.test import override_settings

from lib.testing import IsolatedTestCase

WEB_ORIGIN = "http://localhost:8080"


@override_settings(CORS_ALLOWED_ORIGINS=[WEB_ORIGIN])
class CorsTests(IsolatedTestCase):
    def preflight(self, path, origin):
        return self.client.options(
            path,
            HTTP_ORIGIN=origin,
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS="content-type,x-csrftoken",
        )

    def test_web_origin_may_call_the_api_with_cookies(self):
        response = self.preflight("/api/canvas/games/", WEB_ORIGIN)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Access-Control-Allow-Origin"], WEB_ORIGIN)
        self.assertEqual(response["Access-Control-Allow-Credentials"], "true")
        self.assertIn("x-csrftoken", response["Access-Control-Allow-Headers"])

    def test_actual_request_gets_cors_headers(self):
        response = self.client.get("/api/auth/csrf/", HTTP_ORIGIN=WEB_ORIGIN)
        self.assertEqual(response["Access-Control-Allow-Origin"], WEB_ORIGIN)

    def test_other_origins_get_no_cors_headers(self):
        for origin in ("http://evil.example", "http://localhost:3000", "null"):
            with self.subTest(origin=origin):
                response = self.preflight("/api/canvas/games/", origin)
                self.assertNotIn("Access-Control-Allow-Origin", response)

    def test_only_the_api_is_covered(self):
        response = self.client.get("/admin/login/", HTTP_ORIGIN=WEB_ORIGIN)
        self.assertNotIn("Access-Control-Allow-Origin", response)

    def test_requests_without_origin_are_unaffected(self):
        # Server-to-server calls (ws, web SSR) send no Origin header.
        response = self.client.get("/api/auth/csrf/")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("Access-Control-Allow-Origin", response)


class InternalHostTests(IsolatedTestCase):
    def test_server_hostname_is_allowed(self):
        # web's server-side rendering and ws reach Django at http://server:8000.
        self.assertIn("server", settings.ALLOWED_HOSTS)
        self.assertEqual(self.client.get("/api/auth/csrf/", HTTP_HOST="server:8000").status_code, 200)

    def test_public_hosts_still_allowed(self):
        self.assertEqual(self.client.get("/api/auth/csrf/", HTTP_HOST="localhost").status_code, 200)

    def test_unknown_hosts_are_rejected(self):
        self.assertEqual(self.client.get("/api/auth/csrf/", HTTP_HOST="evil.example").status_code, 400)
