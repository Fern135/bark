"""JWT and password-reset tokens for the authenticator app.

Access tokens follow the contract ws/ checks (see ws/app/auth.py and the README):
signed with JWT_SECRET/JWT_ALGORITHM, claims sub, iat, exp, iss, aud, type="access".
`decode_access_token` is here so your view decorators can reuse it.
"""
from datetime import datetime, timedelta, timezone

import jwt
from django.conf import settings
from django.core import signing
from django.utils.crypto import salted_hmac

PASSWORD_RESET_SALT = "authenticator.password-reset"


def create_access_token(user) -> str:
    now = datetime.now(timezone.utc)
    claims = {
        "sub": user.user_id,  # the public id; never the database pk
        "iat": now,
        "exp": now + timedelta(minutes=settings.JWT_ACCESS_TTL_MINUTES),
        "iss": settings.JWT_ISSUER,
        "aud": settings.JWT_AUDIENCE,
        "type": "access",
    }
    return jwt.encode(claims, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Return the claims of a valid access token; raises jwt.PyJWTError otherwise."""
    claims = jwt.decode(
        token,
        settings.JWT_SECRET,
        algorithms=[settings.JWT_ALGORITHM],
        issuer=settings.JWT_ISSUER,
        audience=settings.JWT_AUDIENCE,
        options={"require": ["exp", "iat", "sub"]},
    )
    if claims.get("type") != "access":
        raise jwt.InvalidTokenError("Not an access token")
    return claims


def _password_fingerprint(user) -> str:
    # Changes whenever the password hash changes, so a reset link works only once.
    return salted_hmac(PASSWORD_RESET_SALT, user.password).hexdigest()[:16]


def create_password_reset_token(user) -> str:
    return signing.dumps({"u": user.user_id, "p": _password_fingerprint(user)}, salt=PASSWORD_RESET_SALT)


def read_password_reset_token(token: str) -> dict:
    """Return {"u": user_id, "p": fingerprint}; raises signing.BadSignature (incl. expired)."""
    return signing.loads(token, salt=PASSWORD_RESET_SALT, max_age=settings.PASSWORD_RESET_MINUTES * 60)


def password_reset_token_matches(user, payload: dict) -> bool:
    return payload.get("u") == user.user_id and payload.get("p") == _password_fingerprint(user)
