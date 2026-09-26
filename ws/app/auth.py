import jwt

from . import config


class AuthError(Exception):
    pass


def decode_token(token: str) -> dict:
    """Validate a JWT issued by the Django server and return its claims."""
    try:
        claims = jwt.decode(
            token,
            config.JWT_SECRET,
            algorithms=[config.JWT_ALGORITHM],
            issuer=config.JWT_ISSUER,
            audience=config.JWT_AUDIENCE,
            options={"require": ["exp", "iat", "sub"]},
        )
    except jwt.PyJWTError as exc:
        raise AuthError(str(exc)) from exc
    if claims.get("type", "access") != "access":
        raise AuthError("Not an access token")
    return claims
