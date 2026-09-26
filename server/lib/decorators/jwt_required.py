"""Protect Django views (sync or async) with the login JWT.

The token is read from the HttpOnly cookie set by /api/auth/login/ (JWT_ACCESS_COOKIE,
default `access_token`), or from an `Authorization: Bearer <jwt>` header for non-browser
clients. It must pass the same checks ws uses (signature, exp, iss, aud, type="access").

Usage:

    from lib.decorators import jwt_required

    @jwt_required
    async def my_projects(request):
        request.user_id      # the JWT's `sub` (User.user_id)
        request.jwt_claims   # all claims

    @jwt_required(load_user=True)   # also fetch the User row (401 if it was deleted)
    async def me(request):
        request.jwt_user     # authenticator.models.User

Without a valid token the view is not called and the client gets
401 {"error": "Authentication required"}.
"""
import functools

import jwt
from asgiref.sync import iscoroutinefunction, markcoroutinefunction, sync_to_async
from django.conf import settings
from django.http import JsonResponse

from authenticator.tokens import decode_access_token


def _token_from(request):
    token = request.COOKIES.get(settings.JWT_ACCESS_COOKIE)
    if token:
        return token
    header = request.META.get("HTTP_AUTHORIZATION", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip() or None
    return None


def _claims_from(request):
    """Claims of the request's valid JWT, or None."""
    token = _token_from(request)
    if not token:
        return None
    try:
        return decode_access_token(token)
    except jwt.PyJWTError:
        return None


def _unauthorized():
    response = JsonResponse({"error": "Authentication required"}, status=401)
    response["WWW-Authenticate"] = "Bearer"
    return response


def _get_user(user_id):
    from authenticator.models import User
    return User.objects.filter(user_id=user_id).first()


def jwt_required(view=None, *, load_user=False):
    """Use as @jwt_required or @jwt_required(load_user=True)."""
    def decorator(view):
        if iscoroutinefunction(view):
            @functools.wraps(view)
            async def wrapper(request, *args, **kwargs):
                claims = _claims_from(request)
                if claims is None:
                    return _unauthorized()
                request.jwt_claims = claims
                request.user_id = claims["sub"]
                if load_user:
                    request.jwt_user = await sync_to_async(_get_user)(request.user_id)
                    if request.jwt_user is None:
                        return _unauthorized()
                return await view(request, *args, **kwargs)

            return markcoroutinefunction(wrapper)

        @functools.wraps(view)
        def wrapper(request, *args, **kwargs):
            claims = _claims_from(request)
            if claims is None:
                return _unauthorized()
            request.jwt_claims = claims
            request.user_id = claims["sub"]
            if load_user:
                request.jwt_user = _get_user(request.user_id)
                if request.jwt_user is None:
                    return _unauthorized()
            return view(request, *args, **kwargs)

        return wrapper

    return decorator(view) if view is not None else decorator
