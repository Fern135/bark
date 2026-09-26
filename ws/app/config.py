import os


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _csv(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


# JWT settings must match the Django server, which issues the tokens.
JWT_SECRET = _required("JWT_SECRET")
JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")
JWT_ISSUER = os.environ.get("JWT_ISSUER", "bark-server")
JWT_AUDIENCE = os.environ.get("JWT_AUDIENCE", "bark-web")
JWT_ACCESS_COOKIE = os.environ.get("JWT_ACCESS_COOKIE", "access_token")

# Only browsers loaded from the Next.js frontend may open a socket.
ALLOWED_ORIGINS = _csv("WS_ALLOWED_ORIGINS")

# Seconds a client has to send its auth message when no cookie is present.
AUTH_TIMEOUT = float(os.environ.get("WS_AUTH_TIMEOUT", "5"))
MAX_MESSAGE_BYTES = int(os.environ.get("WS_MAX_MESSAGE_BYTES", "65536"))

DB_HOST = os.environ.get("POSTGRES_HOST", "db")
DB_PORT = int(os.environ.get("POSTGRES_PORT", "5432"))
DB_NAME = _required("POSTGRES_DB")
DB_USER = _required("POSTGRES_USER")
DB_PASSWORD = _required("POSTGRES_PASSWORD")
DB_POOL_MIN = int(os.environ.get("WS_DB_POOL_MIN", "1"))
DB_POOL_MAX = int(os.environ.get("WS_DB_POOL_MAX", "10"))
