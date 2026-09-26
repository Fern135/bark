"""Tests for the authenticator app: views, tokens, the demo email backend, and the shared
decorators in lib/decorators (jwt_required, rate_limit).

Run inside Docker (uses the real Postgres and redis). They also run automatically, in the
background, every time the server container starts (see server/Dockerfile and entrypoint.sh):

    docker compose exec server python manage.py test --parallel auto

The rate limiter stores its counters in redis. lib/testing.py keeps tests on redis DB 15
(never the app's DB 1), with a private key prefix per parallel worker. Outside Docker (no
DJANGO_CACHE_URL) they fall back to an in-memory cache and skip the checks that need redis.
"""
import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from unittest import mock, skipUnless

import jwt
from asgiref.sync import async_to_sync
from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.core import mail, signing
from django.core.cache import cache
from django.http import HttpResponse, JsonResponse
from django.test import Client, RequestFactory, override_settings

from lib.decorators import jwt_required, rate_limit
from lib.decorators.rate_limit import _cache_key, aclear, body_field, clear, client_ip
from lib.testing import APP_CACHE, TEST_REDIS_URL, USES_REDIS, IsolatedTestCase

from .models import DemoEmail, User
from .tokens import (
    create_access_token,
    create_password_reset_token,
    decode_access_token,
    password_reset_token_matches,
    read_password_reset_token,
)

# ---- test configuration ------------------------------------------------------------------

DEMO_BACKEND = "authenticator.email_backends.DemoInboxBackend"

PASSWORD = "Correct-Horse-9"
NEW_PASSWORD = "Brand-New-Pass-7"
MAX_FAILURES = settings.LOGIN_MAX_FAILURES


@override_settings(DEMO_EMAIL=True)
class AuthTestCase(IsolatedTestCase):
    def setUp(self):
        super().setUp()
        self.client = Client()

    def create_user(self, username="alice", email="alice@example.com", password=PASSWORD):
        return User.objects.create(
            user_id=str(uuid.uuid4()),
            username=username,
            email=email,
            password=make_password(password),
        )

    def post(self, path, data=None, client=None, **extra):
        return (client or self.client).post(f"/api/auth/{path}", data or {}, content_type="application/json", **extra)

    def login(self, username="alice", password=PASSWORD, client=None):
        return self.post("login/", {"username": username, "password": password}, client=client)


def jwt_with(**overrides):
    """A JWT like create_access_token's, with some claims changed (None removes a claim)."""
    now = datetime.now(timezone.utc)
    claims = {
        "sub": "user-1",
        "iat": now,
        "exp": now + timedelta(minutes=5),
        "iss": settings.JWT_ISSUER,
        "aud": settings.JWT_AUDIENCE,
        "type": "access",
    }
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def body(response):
    """JSON body of a response returned by calling a view directly (not via the test client)."""
    return json.loads(response.content)


def reset_token_from(message_body):
    return message_body.split("reset-password?token=", 1)[1].split()[0]


# ---- tokens.py -------------------------------------------------------------------------

class AccessTokenTests(AuthTestCase):
    def test_round_trip_claims(self):
        user = self.create_user()
        claims = decode_access_token(create_access_token(user))
        self.assertEqual(claims["sub"], user.user_id)
        self.assertEqual(claims["iss"], settings.JWT_ISSUER)
        self.assertEqual(claims["aud"], settings.JWT_AUDIENCE)
        self.assertEqual(claims["type"], "access")

    def test_lifetime_matches_setting(self):
        claims = decode_access_token(create_access_token(self.create_user()))
        self.assertEqual(claims["exp"] - claims["iat"], settings.JWT_ACCESS_TTL_MINUTES * 60)

    def test_login_lasts_one_week_by_default(self):
        self.assertEqual(settings.JWT_ACCESS_TTL_MINUTES, 7 * 24 * 60)

    def test_rejects_wrong_secret(self):
        token = jwt.encode({"sub": "x"}, "not-the-secret", algorithm=settings.JWT_ALGORITHM)
        with self.assertRaises(jwt.PyJWTError):
            decode_access_token(token)

    def test_rejects_expired(self):
        past = datetime.now(timezone.utc) - timedelta(hours=1)
        with self.assertRaises(jwt.ExpiredSignatureError):
            decode_access_token(jwt_with(iat=past - timedelta(minutes=5), exp=past))

    def test_rejects_wrong_audience(self):
        with self.assertRaises(jwt.InvalidAudienceError):
            decode_access_token(jwt_with(aud="someone-else"))

    def test_rejects_wrong_issuer(self):
        with self.assertRaises(jwt.InvalidIssuerError):
            decode_access_token(jwt_with(iss="someone-else"))

    def test_rejects_non_access_type(self):
        with self.assertRaises(jwt.InvalidTokenError):
            decode_access_token(jwt_with(type="refresh"))

    def test_rejects_missing_type(self):
        with self.assertRaises(jwt.InvalidTokenError):
            decode_access_token(jwt_with(type=None))

    def test_rejects_missing_sub(self):
        with self.assertRaises(jwt.MissingRequiredClaimError):
            decode_access_token(jwt_with(sub=None))

    def test_rejects_garbage(self):
        with self.assertRaises(jwt.PyJWTError):
            decode_access_token("not-a-jwt")


class PasswordResetTokenTests(AuthTestCase):
    def test_round_trip_matches_user(self):
        user = self.create_user()
        payload = read_password_reset_token(create_password_reset_token(user))
        self.assertTrue(password_reset_token_matches(user, payload))

    def test_stops_matching_after_password_change(self):
        user = self.create_user()
        payload = read_password_reset_token(create_password_reset_token(user))
        user.password = make_password(NEW_PASSWORD)
        self.assertFalse(password_reset_token_matches(user, payload))

    def test_does_not_match_another_user(self):
        alice = self.create_user()
        bob = self.create_user("bob", "bob@example.com")
        payload = read_password_reset_token(create_password_reset_token(alice))
        self.assertFalse(password_reset_token_matches(bob, payload))

    def test_tampered_token_is_rejected(self):
        token = create_password_reset_token(self.create_user())
        with self.assertRaises(signing.BadSignature):
            read_password_reset_token(token[:-2] + ("aa" if not token.endswith("aa") else "bb"))

    def test_expired_token_is_rejected(self):
        user = self.create_user()
        issued = time.time() - (settings.PASSWORD_RESET_MINUTES * 60 + 60)
        with mock.patch("django.core.signing.time.time", return_value=issued):
            token = create_password_reset_token(user)
        with self.assertRaises(signing.SignatureExpired):
            read_password_reset_token(token)


# ---- lib/decorators/jwt_required.py -----------------------------------------------------

@jwt_required
async def async_protected(request):
    return JsonResponse({"user_id": request.user_id, "sub": request.jwt_claims["sub"]})


@jwt_required
def sync_protected(request):
    return JsonResponse({"user_id": request.user_id})


@jwt_required(load_user=True)
async def async_protected_with_user(request):
    return JsonResponse({"username": request.jwt_user.username})


@jwt_required(load_user=True)
def sync_protected_with_user(request):
    return JsonResponse({"username": request.jwt_user.username})


class JwtRequiredTests(AuthTestCase):
    def setUp(self):
        super().setUp()
        self.factory = RequestFactory()
        self.user = self.create_user()
        self.token = create_access_token(self.user)

    def request(self, cookie=None, bearer=None):
        extra = {"HTTP_AUTHORIZATION": f"Bearer {bearer}"} if bearer is not None else {}
        request = self.factory.get("/", **extra)
        if cookie is not None:
            request.COOKIES[settings.JWT_ACCESS_COOKIE] = cookie
        return request

    def call(self, view, request):
        return async_to_sync(view)(request) if view in (async_protected, async_protected_with_user) else view(request)

    def test_no_token_is_401(self):
        for view in (async_protected, sync_protected):
            response = self.call(view, self.request())
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response["WWW-Authenticate"], "Bearer")

    def test_cookie_token_sets_request_attributes(self):
        response = self.call(async_protected, self.request(cookie=self.token))
        self.assertEqual(response.status_code, 200)
        self.assertJSONEqual(response.content, {"user_id": self.user.user_id, "sub": self.user.user_id})

    def test_bearer_token_is_accepted(self):
        response = self.call(async_protected, self.request(bearer=self.token))
        self.assertEqual(response.status_code, 200)

    def test_cookie_wins_over_bearer(self):
        other = create_access_token(self.create_user("bob", "bob@example.com"))
        response = self.call(async_protected, self.request(cookie=self.token, bearer=other))
        self.assertEqual(body(response)["user_id"], self.user.user_id)

    def test_invalid_tokens_are_401(self):
        past = datetime.now(timezone.utc) - timedelta(hours=1)
        for bad in ("garbage", self.token[:-1] + "x", jwt_with(iat=past, exp=past), jwt_with(type="refresh")):
            with self.subTest(token=bad[:20]):
                self.assertEqual(self.call(async_protected, self.request(cookie=bad)).status_code, 401)

    def test_empty_bearer_is_401(self):
        self.assertEqual(self.call(async_protected, self.request(bearer="")).status_code, 401)

    def test_sync_view_is_supported(self):
        response = self.call(sync_protected, self.request(cookie=self.token))
        self.assertEqual(response.status_code, 200)
        self.assertJSONEqual(response.content, {"user_id": self.user.user_id})

    def test_load_user_attaches_user(self):
        for view in (async_protected_with_user, sync_protected_with_user):
            response = self.call(view, self.request(cookie=self.token))
            self.assertEqual(response.status_code, 200)
            self.assertJSONEqual(response.content, {"username": "alice"})

    def test_load_user_for_deleted_user_is_401(self):
        self.user.delete()
        for view in (async_protected_with_user, sync_protected_with_user):
            self.assertEqual(self.call(view, self.request(cookie=self.token)).status_code, 401)


# ---- lib/decorators/rate_limit.py -------------------------------------------------------

def _status_view(request):
    return HttpResponse(status=int(request.GET.get("status", 200)))


async def _async_status_view(request):
    return _status_view(request)


class RateLimitTests(AuthTestCase):
    def setUp(self):
        super().setUp()
        self.factory = RequestFactory()

    def limited(self, view=_async_status_view, **options):
        options = {"key": client_ip, "limit": 3, "window": 60, **options}
        return rate_limit(options.pop("scope", "test"), **options)(view)

    def hit(self, view, status=200, ip="10.0.0.1"):
        request = self.factory.get(f"/?status={status}", HTTP_X_REAL_IP=ip)
        result = view(request)
        return async_to_sync(lambda: result)() if hasattr(result, "__await__") else result

    def test_allows_up_to_the_limit_then_429(self):
        view = self.limited()
        self.assertEqual([self.hit(view).status_code for _ in range(3)], [200, 200, 200])
        blocked = self.hit(view)
        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(blocked["Retry-After"], "60")
        self.assertIn("error", body(blocked))

    def test_blocked_requests_do_not_run_the_view(self):
        calls = []

        async def view(request):
            calls.append(1)
            return HttpResponse()

        limited = self.limited(view, limit=1)
        self.hit(limited)
        self.hit(limited)
        self.assertEqual(len(calls), 1)

    def test_sync_view_is_supported(self):
        view = self.limited(_status_view, limit=1)
        self.assertEqual(self.hit(view).status_code, 200)
        self.assertEqual(self.hit(view).status_code, 429)

    def test_keys_are_independent(self):
        view = self.limited(limit=1)
        self.assertEqual(self.hit(view, ip="10.0.0.1").status_code, 200)
        self.assertEqual(self.hit(view, ip="10.0.0.1").status_code, 429)
        self.assertEqual(self.hit(view, ip="10.0.0.2").status_code, 200)

    def test_scopes_are_independent(self):
        first, second = self.limited(scope="a", limit=1), self.limited(scope="b", limit=1)
        self.hit(first)
        self.assertEqual(self.hit(first).status_code, 429)
        self.assertEqual(self.hit(second).status_code, 200)

    def test_count_statuses_counts_only_matching_responses(self):
        view = self.limited(limit=2, count_statuses={401})
        for _ in range(5):
            self.assertEqual(self.hit(view, status=200).status_code, 200)
        self.hit(view, status=401)
        self.hit(view, status=401)
        self.assertEqual(self.hit(view, status=200).status_code, 429)

    def test_reset_statuses_clear_the_counter(self):
        view = self.limited(limit=2, count_statuses={401}, reset_statuses={200})
        self.hit(view, status=401)
        self.hit(view, status=200)  # resets
        self.hit(view, status=401)
        self.assertEqual(self.hit(view, status=401).status_code, 401)  # still allowed: count was reset
        self.assertEqual(self.hit(view, status=401).status_code, 429)

    def test_no_identifier_means_no_limit(self):
        view = self.limited(key=lambda request: None, limit=1)
        self.assertEqual([self.hit(view).status_code for _ in range(3)], [200, 200, 200])

    def test_custom_message(self):
        view = self.limited(limit=1, message="Slow down")
        self.hit(view)
        self.assertEqual(body(self.hit(view)), {"error": "Slow down"})

    def test_clear_and_aclear(self):
        view = self.limited(limit=1)
        self.hit(view)
        clear("test", "10.0.0.1")
        self.assertEqual(self.hit(view).status_code, 200)
        async_to_sync(aclear)("test", "10.0.0.1")
        self.assertEqual(self.hit(view).status_code, 200)

    def test_client_ip_prefers_x_real_ip(self):
        self.assertEqual(client_ip(self.factory.get("/", HTTP_X_REAL_IP="1.2.3.4")), "1.2.3.4")
        self.assertEqual(client_ip(self.factory.get("/", REMOTE_ADDR="5.6.7.8")), "5.6.7.8")

    def test_body_field(self):
        key = body_field("username", "email")

        def request(body):
            return self.factory.post("/", body, content_type="application/json")

        self.assertEqual(key(request('{"username": "  Alice "}')), "alice")
        self.assertEqual(key(request('{"email": "A@X.COM"}')), "a@x.com")
        self.assertEqual(key(request('{"username": "", "email": "a@x.com"}')), "a@x.com")
        self.assertIsNone(key(request('{"other": 1}')))
        self.assertIsNone(key(request("not json")))
        self.assertIsNone(key(request("[1, 2]")))

    @skipUnless(USES_REDIS, "needs redis (run inside Docker)")
    def test_counters_live_in_redis_with_a_ttl(self):
        import redis

        view = self.limited(limit=5, window=60)
        self.hit(view)
        self.hit(view)
        raw = redis.Redis.from_url(TEST_REDIS_URL)
        key = cache.make_key(_cache_key("test", "10.0.0.1"))
        self.assertEqual(int(raw.get(key)), 2)
        self.assertTrue(0 < raw.ttl(key) <= 60)

    @skipUnless(USES_REDIS, "needs redis (run inside Docker)")
    def test_counters_are_shared_across_processes(self):
        # Another gunicorn worker writing the same counter straight to redis is honoured here.
        import redis

        view = self.limited(limit=3)
        raw = redis.Redis.from_url(TEST_REDIS_URL)
        raw.set(cache.make_key(_cache_key("test", "10.0.0.9")), 3, ex=60)
        self.assertEqual(self.hit(view, ip="10.0.0.9").status_code, 429)

    @skipUnless(USES_REDIS, "needs redis (run inside Docker)")
    def test_tests_do_not_use_the_app_redis_database(self):
        self.assertNotEqual(TEST_REDIS_URL, APP_CACHE["LOCATION"])


# ---- views: csrf ------------------------------------------------------------------------

class CsrfViewTests(AuthTestCase):
    def test_sets_csrf_cookie(self):
        response = self.client.get("/api/auth/csrf/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("csrftoken", response.cookies)

    def test_post_only_rejected(self):
        self.assertEqual(self.client.post("/api/auth/csrf/").status_code, 405)

    def test_posts_need_the_csrf_token(self):
        client = Client(enforce_csrf_checks=True)
        self.assertEqual(self.post("logout/", client=client).status_code, 403)
        token = client.get("/api/auth/csrf/").cookies["csrftoken"].value
        self.assertEqual(self.post("logout/", client=client, HTTP_X_CSRFTOKEN=token).status_code, 200)


# ---- views: register --------------------------------------------------------------------

class RegisterViewTests(AuthTestCase):
    def register(self, **overrides):
        data = {"username": "alice", "email": "alice@example.com", "password": PASSWORD, **overrides}
        return self.post("register/", data)

    def test_creates_user_with_hashed_password_and_uuid(self):
        response = self.register()
        self.assertEqual(response.status_code, 201)
        user = User.objects.get(username="alice")
        self.assertNotEqual(user.password, PASSWORD)
        self.assertTrue(check_password(PASSWORD, user.password))
        uuid.UUID(user.user_id)  # raises if not a UUID

    def test_email_is_normalised(self):
        self.register(email="  Alice@Example.COM ")
        self.assertEqual(User.objects.get().email, "alice@example.com")

    def test_missing_fields(self):
        for field in ("username", "email", "password"):
            with self.subTest(field=field):
                data = {"username": "alice", "email": "alice@example.com", "password": PASSWORD}
                del data[field]
                response = self.post("register/", data)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["error"], "Missing required fields")

    def test_invalid_json(self):
        response = self.client.post("/api/auth/register/", "not json", content_type="application/json")
        self.assertEqual(response.status_code, 400)

    def test_invalid_email(self):
        response = self.register(email="not-an-email")
        self.assertEqual(response.json()["error"], "Invalid email format")

    def test_duplicate_email_is_case_insensitive(self):
        self.create_user(email="alice@example.com")
        response = self.register(username="alice2", email="ALICE@example.com")
        self.assertEqual(response.json()["error"], "Email already registered")

    def test_duplicate_username(self):
        self.create_user(username="alice", email="other@example.com")
        response = self.register()
        self.assertEqual(response.json()["error"], "User already exists")

    def test_weak_passwords_are_rejected(self):
        for password, reason in [
            ("password", "too common"),
            ("Ab1-", "too short"),
            ("839201746153", "entirely numeric"),
            ("Alice123", "too similar"),  # 77% similar to "alice"; Django rejects >= 70%
        ]:
            with self.subTest(password=password):
                response = self.register(password=password)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["error"], "Password is too weak")
                self.assertTrue(any(reason in d for d in response.json()["details"]), response.json())
        self.assertFalse(User.objects.exists())

    def test_get_not_allowed(self):
        self.assertEqual(self.client.get("/api/auth/register/").status_code, 405)


# ---- views: login / me / logout ---------------------------------------------------------

class LoginViewTests(AuthTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.create_user()

    def test_success_returns_user_and_jwt_cookie(self):
        response = self.login()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"], {"user_id": self.user.user_id, "username": "alice", "email": "alice@example.com"})
        cookie = response.cookies[settings.JWT_ACCESS_COOKIE]
        self.assertEqual(decode_access_token(cookie.value)["sub"], self.user.user_id)

    def test_cookie_attributes(self):
        cookie = self.login().cookies[settings.JWT_ACCESS_COOKIE]
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["samesite"], "Lax")
        self.assertEqual(cookie["path"], "/")
        self.assertEqual(cookie["max-age"], settings.JWT_ACCESS_TTL_MINUTES * 60)
        self.assertEqual(bool(cookie["secure"]), settings.JWT_COOKIE_SECURE)

    def test_login_by_email_is_case_insensitive(self):
        self.assertEqual(self.login(username="ALICE@example.com").status_code, 200)
        self.assertEqual(self.post("login/", {"email": "alice@example.com", "password": PASSWORD}).status_code, 200)

    def test_wrong_password_and_unknown_user_look_the_same(self):
        wrong = self.login(password="wrong")
        unknown = self.login(username="nobody")
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(unknown.status_code, 401)
        self.assertEqual(wrong.json(), unknown.json())
        self.assertNotIn(settings.JWT_ACCESS_COOKIE, wrong.cookies)

    def test_missing_fields_and_bad_json(self):
        self.assertEqual(self.post("login/", {"username": "alice"}).status_code, 400)
        self.assertEqual(self.post("login/", {"password": PASSWORD}).status_code, 400)
        self.assertEqual(self.post("login/", {"username": "alice", "password": 123}).status_code, 400)
        response = self.client.post("/api/auth/login/", "nope", content_type="application/json")
        self.assertEqual(response.status_code, 400)

    def test_get_not_allowed(self):
        self.assertEqual(self.client.get("/api/auth/login/").status_code, 405)

    def test_account_locks_after_max_failures_even_for_the_right_password(self):
        for _ in range(MAX_FAILURES):
            self.assertEqual(self.login(password="wrong").status_code, 401)
        locked = self.login()
        self.assertEqual(locked.status_code, 429)
        self.assertEqual(locked["Retry-After"], str(settings.LOGIN_LOCKOUT_MINUTES * 60))
        self.assertNotIn(settings.JWT_ACCESS_COOKIE, locked.cookies)

    def test_success_resets_the_failure_count(self):
        for _ in range(MAX_FAILURES - 1):
            self.login(password="wrong")
        self.assertEqual(self.login().status_code, 200)
        for _ in range(MAX_FAILURES - 1):
            self.login(password="wrong")
        self.assertEqual(self.login().status_code, 200)

    def test_lockout_is_per_account(self):
        self.create_user("bob", "bob@example.com")
        for _ in range(MAX_FAILURES):
            self.login(password="wrong")
        self.assertEqual(self.login().status_code, 429)
        self.assertEqual(self.login(username="bob").status_code, 200)

    def test_lockout_key_ignores_case(self):
        for _ in range(MAX_FAILURES):
            self.login(username="ALICE@EXAMPLE.COM", password="wrong")
        self.assertEqual(self.login(username="alice@example.com").status_code, 429)

    def test_unknown_usernames_also_lock(self):
        for _ in range(MAX_FAILURES):
            self.login(username="ghost", password="wrong")
        self.assertEqual(self.login(username="ghost", password="wrong").status_code, 429)

    def test_missing_fields_do_not_count_as_failures(self):
        for _ in range(MAX_FAILURES + 2):
            self.post("login/", {"username": "alice"})
        self.assertEqual(self.login().status_code, 200)


class MeViewTests(AuthTestCase):
    def test_requires_login(self):
        response = self.client.get("/api/auth/me/")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json(), {"error": "Authentication required"})

    def test_returns_logged_in_user(self):
        user = self.create_user()
        self.login()
        response = self.client.get("/api/auth/me/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["user_id"], user.user_id)

    def test_bearer_header(self):
        user = self.create_user()
        response = self.client.get("/api/auth/me/", HTTP_AUTHORIZATION=f"Bearer {create_access_token(user)}")
        self.assertEqual(response.status_code, 200)

    def test_post_not_allowed(self):
        self.assertEqual(self.client.post("/api/auth/me/").status_code, 405)


class LogoutViewTests(AuthTestCase):
    def test_deletes_the_cookie(self):
        self.create_user()
        self.login()
        response = self.post("logout/")
        self.assertEqual(response.status_code, 200)
        cookie = response.cookies[settings.JWT_ACCESS_COOKIE]
        self.assertEqual(cookie.value, "")
        self.assertEqual(cookie["max-age"], 0)
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)

    def test_get_not_allowed(self):
        self.assertEqual(self.client.get("/api/auth/logout/").status_code, 405)


# ---- views: forgot password / reset password --------------------------------------------

class ForgotPasswordViewTests(AuthTestCase):
    def test_emails_a_reset_link(self):
        user = self.create_user()
        response = self.post("forgot-password/", {"email": "ALICE@example.com"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertEqual(message.to, ["alice@example.com"])
        self.assertIn(f"{settings.FRONTEND_URL}/reset-password?token=", message.body)
        payload = read_password_reset_token(reset_token_from(message.body))
        self.assertTrue(password_reset_token_matches(user, payload))

    def test_unknown_email_gets_the_same_answer_and_no_email(self):
        self.create_user()
        known = self.post("forgot-password/", {"email": "alice@example.com"})
        unknown = self.post("forgot-password/", {"email": "ghost@example.com"})
        self.assertEqual(known.status_code, unknown.status_code)
        self.assertEqual(known.json(), unknown.json())
        self.assertEqual(len(mail.outbox), 1)

    def test_invalid_email(self):
        for body in ({}, {"email": "nope"}):
            self.assertEqual(self.post("forgot-password/", body).status_code, 400)

    def test_mail_failure_is_hidden(self):
        self.create_user()
        with mock.patch("authenticator.views.send_mail", side_effect=OSError("smtp down")):
            with self.assertLogs("authenticator.views", level="ERROR"):
                response = self.post("forgot-password/", {"email": "alice@example.com"})
        self.assertEqual(response.status_code, 200)


class ResetPasswordViewTests(AuthTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.create_user()
        self.token = create_password_reset_token(self.user)

    def reset(self, token=None, password=NEW_PASSWORD):
        return self.post("reset-password/", {"token": token or self.token, "password": password})

    def test_changes_the_password(self):
        response = self.reset()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.login(password=PASSWORD).status_code, 401)
        self.assertEqual(self.login(password=NEW_PASSWORD).status_code, 200)

    def test_token_works_only_once(self):
        self.reset()
        response = self.reset(password="Another-Pass-8")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "This reset link is invalid or has expired")

    def test_bad_token(self):
        self.assertEqual(self.reset(token="garbage").status_code, 400)

    def test_expired_token(self):
        issued = time.time() - (settings.PASSWORD_RESET_MINUTES * 60 + 60)
        with mock.patch("django.core.signing.time.time", return_value=issued):
            token = create_password_reset_token(self.user)
        self.assertEqual(self.reset(token=token).status_code, 400)

    def test_token_for_deleted_user(self):
        self.user.delete()
        self.assertEqual(self.reset().status_code, 400)

    def test_weak_password_is_rejected_and_nothing_changes(self):
        response = self.reset(password="123")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "Password is too weak")
        self.assertTrue(response.json()["details"])
        self.assertEqual(self.login(password=PASSWORD).status_code, 200)

    def test_missing_fields_and_bad_json(self):
        self.assertEqual(self.post("reset-password/", {"token": self.token}).status_code, 400)
        self.assertEqual(self.post("reset-password/", {"password": NEW_PASSWORD}).status_code, 400)
        response = self.client.post("/api/auth/reset-password/", "nope", content_type="application/json")
        self.assertEqual(response.status_code, 400)

    def test_reset_unlocks_a_locked_account(self):
        for _ in range(MAX_FAILURES):
            self.login(password="wrong")
        self.assertEqual(self.login(password=PASSWORD).status_code, 429)
        self.reset()
        self.assertEqual(self.login(password=NEW_PASSWORD).status_code, 200)

    def test_full_flow_through_the_email(self):
        self.post("forgot-password/", {"email": "alice@example.com"})
        token = reset_token_from(mail.outbox[0].body)
        self.assertEqual(self.reset(token=token).status_code, 200)
        self.assertEqual(self.login(password=NEW_PASSWORD).status_code, 200)


# ---- views: forgot username -------------------------------------------------------------

class ForgotUsernameViewTests(AuthTestCase):
    def test_emails_the_username(self):
        self.create_user()
        response = self.post("forgot-username/", {"email": "Alice@Example.com"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["alice@example.com"])
        self.assertIn("Your Bark username is: alice", mail.outbox[0].body)

    def test_unknown_email_gets_the_same_answer_and_no_email(self):
        self.create_user()
        known = self.post("forgot-username/", {"email": "alice@example.com"})
        unknown = self.post("forgot-username/", {"email": "ghost@example.com"})
        self.assertEqual(known.json(), unknown.json())
        self.assertEqual(len(mail.outbox), 1)

    def test_invalid_email(self):
        self.assertEqual(self.post("forgot-username/", {"email": "nope"}).status_code, 400)


# ---- demo email: backend + demo inbox view ----------------------------------------------

@override_settings(EMAIL_BACKEND=DEMO_BACKEND)
class DemoEmailTests(AuthTestCase):
    def test_backend_saves_instead_of_sending(self):
        mail.send_mail("Hello", "Body", "Bark <no-reply@localhost>", ["A@Example.com", "b@example.com"])
        self.assertEqual(sorted(DemoEmail.objects.values_list("to", flat=True)), ["a@example.com", "b@example.com"])
        self.assertEqual(DemoEmail.objects.first().subject, "Hello")

    def test_inbox_shows_emails_newest_first(self):
        self.create_user()
        self.post("forgot-username/", {"email": "alice@example.com"})
        self.post("forgot-password/", {"email": "alice@example.com"})
        DemoEmail.objects.filter(subject="Your Bark username").update(sent_at=datetime.now(timezone.utc) - timedelta(minutes=1))
        response = self.client.get("/api/auth/demo-inbox/", {"email": "ALICE@example.com"})
        self.assertEqual(response.status_code, 200)
        subjects = [m["subject"] for m in response.json()["messages"]]
        self.assertEqual(subjects, ["Reset your Bark password", "Your Bark username"])
        self.assertEqual(set(response.json()["messages"][0]), {"subject", "body", "from", "sent_at"})

    def test_inbox_only_shows_that_address(self):
        mail.send_mail("For bob", "x", None, ["bob@example.com"])
        response = self.client.get("/api/auth/demo-inbox/", {"email": "alice@example.com"})
        self.assertEqual(response.json()["messages"], [])

    def test_inbox_returns_at_most_20(self):
        for i in range(25):
            mail.send_mail(f"#{i}", "x", None, ["alice@example.com"])
        response = self.client.get("/api/auth/demo-inbox/", {"email": "alice@example.com"})
        self.assertEqual(len(response.json()["messages"]), 20)

    def test_reset_link_from_the_inbox_works(self):
        self.create_user()
        self.post("forgot-password/", {"email": "alice@example.com"})
        body = self.client.get("/api/auth/demo-inbox/", {"email": "alice@example.com"}).json()["messages"][0]["body"]
        response = self.post("reset-password/", {"token": reset_token_from(body), "password": NEW_PASSWORD})
        self.assertEqual(response.status_code, 200)

    def test_invalid_email(self):
        self.assertEqual(self.client.get("/api/auth/demo-inbox/", {"email": "nope"}).status_code, 400)
        self.assertEqual(self.client.get("/api/auth/demo-inbox/").status_code, 400)

    @override_settings(DEMO_EMAIL=False)
    def test_inbox_is_404_when_demo_email_is_off(self):
        self.assertEqual(self.client.get("/api/auth/demo-inbox/", {"email": "alice@example.com"}).status_code, 404)

    def test_post_not_allowed(self):
        self.assertEqual(self.client.post("/api/auth/demo-inbox/").status_code, 405)
