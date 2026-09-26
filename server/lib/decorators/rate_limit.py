"""Rate limiting for Django views (sync or async), backed by the Django cache.

The cache is redis in Docker (see CACHES in settings.py), so every gunicorn worker shares
the same counters. The gateway also limits per IP (proxy/nginx.conf); this is the
application-level layer on top.

Usage:

    from lib.decorators import rate_limit
    from lib.decorators.rate_limit import body_field, client_ip

    # At most 5 requests per IP per hour:
    @rate_limit("forgot-password", key=client_ip, limit=5, window=60 * 60)
    async def forgot_password(request): ...

    # Lock an account after 5 failed logins in 15 minutes: count only 401 responses,
    # and clear the counter on a successful (200) login:
    @rate_limit("login", key=body_field("username", "email"), limit=5, window=15 * 60,
                count_statuses={401}, reset_statuses={200})
    async def login(request): ...

Over the limit, the view is not called and the client gets 429 with a Retry-After header.
The window starts at the first counted request; later requests don't extend it.
"""
import functools
import hashlib
import json

from asgiref.sync import iscoroutinefunction, markcoroutinefunction
from django.core.cache import cache
from django.http import JsonResponse


# ---- key functions: request -> identifier string (None or "" skips limiting) -------------

def client_ip(request):
    """The client's IP. nginx sets X-Real-IP, and only nginx can reach the server container."""
    return request.META.get("HTTP_X_REAL_IP") or request.META.get("REMOTE_ADDR", "")


def body_field(*names):
    """Key on the first non-empty JSON body field among `names` (case-insensitive)."""
    def key(request):
        try:
            data = json.loads(request.body or b"{}")
        except (ValueError, UnicodeDecodeError):
            return None
        if not isinstance(data, dict):
            return None
        for name in names:
            value = data.get(name)
            if isinstance(value, str) and value.strip():
                return value.strip().lower()
        return None
    return key


# ---- counters ---------------------------------------------------------------------------

def _cache_key(scope, identifier):
    # Hashed so raw identifiers (usernames, emails, IPs) never appear as cache keys.
    return f"rate-limit:{scope}:" + hashlib.sha256(str(identifier).strip().lower().encode()).hexdigest()


def clear(scope, *identifiers):
    """Reset counters, e.g. clear("login", user.username, user.email) after a password reset."""
    cache.delete_many([_cache_key(scope, i) for i in identifiers if i])


async def aclear(scope, *identifiers):
    await cache.adelete_many([_cache_key(scope, i) for i in identifiers if i])


def _too_many(window, message):
    response = JsonResponse({"error": message}, status=429)
    response["Retry-After"] = str(window)
    return response


def rate_limit(scope, *, key, limit, window, count_statuses=None, reset_statuses=None, message=None):
    """
    scope           name of this limit; counters of different scopes never mix.
    key             request -> identifier (see client_ip, body_field). No identifier = no limit.
    limit           counted requests allowed per window.
    window          window length in seconds.
    count_statuses  count only responses with these status codes (default: every request).
    reset_statuses  clear the counter when the response has one of these status codes.
    message         error text for the 429 response.
    """
    message = message or f"Too many requests. Try again in {max(1, window // 60)} minutes."

    def should_count(response):
        return count_statuses is None or response.status_code in count_statuses

    def should_reset(response):
        return reset_statuses is not None and response.status_code in reset_statuses

    def decorator(view):
        if iscoroutinefunction(view):
            @functools.wraps(view)
            async def wrapper(request, *args, **kwargs):
                identifier = key(request)
                if not identifier:
                    return await view(request, *args, **kwargs)
                cache_key = _cache_key(scope, identifier)
                if await cache.aget(cache_key, 0) >= limit:
                    return _too_many(window, message)
                response = await view(request, *args, **kwargs)
                if should_reset(response):
                    await cache.adelete(cache_key)
                elif should_count(response):
                    await cache.aadd(cache_key, 0, timeout=window)
                    await cache.aincr(cache_key)
                return response

            return markcoroutinefunction(wrapper)

        @functools.wraps(view)
        def wrapper(request, *args, **kwargs):
            identifier = key(request)
            if not identifier:
                return view(request, *args, **kwargs)
            cache_key = _cache_key(scope, identifier)
            if cache.get(cache_key, 0) >= limit:
                return _too_many(window, message)
            response = view(request, *args, **kwargs)
            if should_reset(response):
                cache.delete(cache_key)
            elif should_count(response):
                cache.add(cache_key, 0, timeout=window)
                cache.incr(cache_key)
            return response

        return wrapper

    return decorator
