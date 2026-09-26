"""Authentication API, mounted at /api/auth/ (see authenticator/urls.py).

All endpoints take and return JSON. From the browser, call them with the shared axios instance
in web/src/lib/api.ts, which sends cookies and the CSRF header automatically:

    await api.get("/auth/csrf/");  // once, before the first POST, to get the csrftoken cookie
    await api.post("/auth/login/", { username, password });

Recovery endpoints always answer the same way whether or not the account exists, so they can't
be used to find out who has an account.
"""
import json
import logging
import uuid

from asgiref.sync import sync_to_async
from django.conf import settings
from django.contrib.auth.hashers import acheck_password, make_password
from django.contrib.auth.password_validation import validate_password
from django.core import signing
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.core.validators import validate_email
from django.http.response import JsonResponse
from django.middleware.csrf import rotate_token
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from lib.decorators import jwt_required, rate_limit
from lib.decorators.rate_limit import aclear, body_field

from .models import DemoEmail, User
from .tokens import (
    create_access_token,
    create_password_reset_token,
    password_reset_token_matches,
    read_password_reset_token,
)

log = logging.getLogger(__name__)

RECOVERY_SENT = {"message": "If an account exists for that email, we've sent instructions to it."}


def _json_body(request):
    """Parsed JSON object from the request body, or None if it isn't a JSON object."""
    try:
        data = json.loads(request.body or b"{}")
    except (ValueError, UnicodeDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _clean_email(value):
    """Normalised email, or None if it's missing or invalid."""
    email = str(value or "").strip().lower()
    try:
        validate_email(email)
    except ValidationError:
        return None
    return email


async def _send_email(to, subject, body):
    try:
        await sync_to_async(send_mail)(subject, body, None, [to])
    except Exception:
        # Never reveal delivery problems to the caller; that would leak whether the account exists.
        log.exception("authenticator: failed to send %r", subject)


# GET /api/auth/csrf/
@require_GET
@ensure_csrf_cookie
async def csrf(request):
    """
    Sets the `csrftoken` cookie. Django rejects POSTs without it (403), so the frontend
    calls this once before its first POST; axios then sends it back as X-CSRFToken.

    Response 200: {"message": "CSRF cookie set"}
    """
    return JsonResponse({"message": "CSRF cookie set"})


# POST /api/auth/login/
@require_POST
@rate_limit(
    "login",
    key=body_field("username", "email"),  # per account, whichever field was sent
    limit=settings.LOGIN_MAX_FAILURES,
    window=settings.LOGIN_LOCKOUT_MINUTES * 60,
    count_statuses={401},  # only failed logins count (unknown names too, so lockouts don't reveal accounts)
    reset_statuses={200},  # a successful login clears the counter
    message=f"Too many failed login attempts. Try again in {settings.LOGIN_LOCKOUT_MINUTES} minutes.",
)
async def login(request):
    """
    Body: {"username": "alice", "password": "..."}   ("username" may also be the email)

    Response 200: {"message": "Logged in", "user": {"user_id", "username", "email"}}
        plus an HttpOnly cookie (JWT_ACCESS_COOKIE, default `access_token`) holding the JWT.
        The browser sends it automatically to /api/ and /ws/; JavaScript can't read it.
        The login lasts JWT_ACCESS_TTL_MINUTES (default 1 week), then the user logs in again.
    Response 400: missing fields.   401: wrong username or password.
    Response 429: too many failed attempts for this account (LOGIN_MAX_FAILURES within
                  LOGIN_LOCKOUT_MINUTES). Even the right password is refused until the lock
                  expires or the password is reset. The gateway also limits each IP (proxy/nginx.conf).
    """
    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "Invalid JSON body"}, status=400)

    identifier = str(data.get("username") or data.get("email") or "").strip()
    password = data.get("password")
    if not identifier or not isinstance(password, str) or not password:
        return JsonResponse({"error": "Missing required fields"}, status=400)

    if "@" in identifier:
        user = await User.objects.filter(email__iexact=identifier.lower()).afirst()
    else:
        user = await User.objects.filter(username=identifier).afirst()

    if user is None:
        # Hash anyway so unknown usernames take as long as wrong passwords (no user enumeration).
        make_password(password)
        return JsonResponse({"error": "Invalid username or password"}, status=401)

    if not await acheck_password(password, user.password):
        return JsonResponse({"error": "Invalid username or password"}, status=401)

    response = JsonResponse({
        "message": "Logged in",
        "user": {"user_id": user.user_id, "username": user.username, "email": user.email},
    })
    response.set_cookie(
        settings.JWT_ACCESS_COOKIE,
        create_access_token(user),
        max_age=settings.JWT_ACCESS_TTL_MINUTES * 60,
        httponly=True,                     # not readable from JavaScript
        secure=settings.JWT_COOKIE_SECURE,  # HTTPS only (and http://localhost)
        samesite="Lax",                    # not sent on cross-site POSTs
        path="/",                          # needed for both /api/ and /ws/
    )
    rotate_token(request)  # new CSRF token for the new session
    return response


# GET /api/auth/me/
@require_GET
@jwt_required(load_user=True)
async def me(request):
    """
    The logged-in user. Requires the JWT cookie (see lib/decorators/jwt_required.py).
    The frontend can call it on load to check whether someone is logged in.

    Response 200: {"user": {"user_id", "username", "email"}}
    Response 401: {"error": "Authentication required"}  (no cookie, expired, or invalid)
    """
    user = request.jwt_user
    return JsonResponse({"user": {"user_id": user.user_id, "username": user.username, "email": user.email}})


# POST /api/auth/logout/
@require_POST
async def logout(request):
    """
    Deletes the JWT cookie.

    Response 200: {"message": "Logged out"}
    """
    response = JsonResponse({"message": "Logged out"})
    response.delete_cookie(settings.JWT_ACCESS_COOKIE, path="/", samesite="Lax")
    return response


# POST /api/auth/forgot-password/
@require_POST
async def forgot_password(request):
    """
    Body: {"email": "alice@example.com"}

    Emails a reset link: {FRONTEND_URL}/reset-password?token=...  The token expires after
    PASSWORD_RESET_MINUTES and stops working once the password changes.
    The frontend page at that URL posts the token and new password to /api/auth/reset-password/.

    Response 200: always the same message, whether or not the account exists.
    Response 400: missing or invalid email.
    """
    if not settings.ACCOUNT_RECOVERY_ENABLED:
        return JsonResponse({"error": "Account recovery is not available yet."}, status=503)
    data = _json_body(request)
    email = _clean_email(data.get("email")) if data else None
    if email is None:
        return JsonResponse({"error": "A valid email is required"}, status=400)

    user = await User.objects.filter(email__iexact=email).afirst()
    if user is not None:
        link = f"{settings.FRONTEND_URL}/reset-password?token={create_password_reset_token(user)}"
        await _send_email(
            user.email,
            "Reset your Bark password",
            f"Hi {user.username},\n\n"
            f"Use this link to choose a new password. It expires in {settings.PASSWORD_RESET_MINUTES} minutes:\n\n"
            f"{link}\n\n"
            "If you didn't ask for this, you can ignore this email.",
        )
    return JsonResponse(RECOVERY_SENT)


# POST /api/auth/reset-password/
@require_POST
async def reset_password(request):
    """
    Body: {"token": "<from the email link>", "password": "<new password>"}

    Response 200: {"message": "Password updated"}   (log in again afterwards)
    Response 400: invalid/expired/used token, or the password fails Django's password
                  validators (AUTH_PASSWORD_VALIDATORS): {"error": ..., "details": [...]}
    """
    if not settings.ACCOUNT_RECOVERY_ENABLED:
        return JsonResponse({"error": "Account recovery is not available yet."}, status=503)
    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "Invalid JSON body"}, status=400)

    token = data.get("token")
    password = data.get("password")
    if not isinstance(token, str) or not isinstance(password, str) or not password:
        return JsonResponse({"error": "Missing required fields"}, status=400)

    invalid = JsonResponse({"error": "This reset link is invalid or has expired"}, status=400)
    try:
        payload = read_password_reset_token(token)
    except signing.BadSignature:  # includes SignatureExpired
        return invalid

    user = await User.objects.filter(user_id=payload.get("u")).afirst()
    if user is None or not password_reset_token_matches(user, payload):
        return invalid

    try:
        validate_password(password, user=user)
    except ValidationError as exc:
        return JsonResponse({"error": "Password is too weak", "details": exc.messages}, status=400)

    user.password = make_password(password)
    await user.asave(update_fields=["password", "updated_at"])
    # Resetting the password is the way out of a login lockout.
    await aclear("login", user.username, user.email)
    return JsonResponse({"message": "Password updated"})


# POST /api/auth/forgot-username/
@require_POST
async def forgot_username(request):
    """
    Body: {"email": "alice@example.com"}

    Emails the username registered to that address.

    Response 200: always the same message, whether or not the account exists.
    Response 400: missing or invalid email.
    """
    if not settings.ACCOUNT_RECOVERY_ENABLED:
        return JsonResponse({"error": "Account recovery is not available yet."}, status=503)
    data = _json_body(request)
    email = _clean_email(data.get("email")) if data else None
    if email is None:
        return JsonResponse({"error": "A valid email is required"}, status=400)

    user = await User.objects.filter(email__iexact=email).afirst()
    if user is not None:
        await _send_email(
            user.email,
            "Your Bark username",
            f"Your Bark username is: {user.username}\n\n"
            f"Log in at {settings.FRONTEND_URL}\n\n"
            "If you didn't ask for this, you can ignore this email.",
        )
    return JsonResponse(RECOVERY_SENT)


# GET /api/auth/demo-inbox/?email=alice@example.com
@require_GET
async def demo_inbox(request):
    """
    Demo only (DEMO_EMAIL=1): the emails the app "sent" to an address, newest first, so the
    demo can show reset links and usernames without a real mail server. Returns 404 when
    DEMO_EMAIL=0. Anyone who knows an address can read its inbox, so never enable it for real users.

    Response 200: {"email": "...", "messages": [{"subject", "body", "from", "sent_at"}, ...]}  (latest 20)
    Response 400: missing or invalid email.   404: demo inbox disabled.
    """
    if not settings.DEMO_EMAIL:
        return JsonResponse({"error": "Not found"}, status=404)

    email = _clean_email(request.GET.get("email"))
    if email is None:
        return JsonResponse({"error": "A valid email is required"}, status=400)

    messages = [
        {"subject": m.subject, "body": m.body, "from": m.from_email, "sent_at": m.sent_at.isoformat()}
        async for m in DemoEmail.objects.filter(to=email)[:20]
    ]
    return JsonResponse({"email": email, "messages": messages})


# POST /api/auth/register/
async def register(request):
    """
    username = models.CharField(max_length=100)
    password = models.CharField(max_length=100)
    email = models.EmailField()
    """

    if request.method == "POST":
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "Invalid JSON body"}, status=400)

        # .get() so a missing field is a 400 below, not a KeyError (500)
        user_name = str(data.get("username") or "").strip()
        password  = data.get("password")
        email     = str(data.get("email") or "").strip().lower()

        if not isinstance(password, str):
            password = ""

        # Validate required fields
        if not user_name or not password or not email:
            return JsonResponse({"error": "Missing required fields"}, status=400)

        # check if email already exists (case insensitive)
        if await User.objects.filter(email__iexact=email).aexists():
            return JsonResponse({"error": "Email already registered"}, status=400)

        # Validate email format
        try:
            validate_email(email)
        except ValidationError:
            return JsonResponse({"error": "Invalid email format"}, status=400)

        # Validate password strength (AUTH_PASSWORD_VALIDATORS in settings.py). The unsaved
        # User lets the similarity check reject passwords close to the username or email.
        try:
            validate_password(password, user=User(username=user_name, email=email))
        except ValidationError as exc:
            return JsonResponse({"error": "Password is too weak", "details": exc.messages}, status=400)

        # Check if user already exists
        if await User.objects.filter(username=user_name).aexists():
            return JsonResponse({"error": "User already exists"}, status=400)

        # Create new user
        user = await User.objects.acreate(
            user_id=str(uuid.uuid4()),  # random id used for collaboration
            username=user_name,
            password=make_password(password),
            email=email
        )

        # if there's a problem
        if not user:
            return JsonResponse({"error": "Failed to create user"}, status=500)

        # Return success response
        return JsonResponse({"message": "User created successfully"}, status=201)

    else:
        return JsonResponse({"message" : "method not allowed"}, status=405)
