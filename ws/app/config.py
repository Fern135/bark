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
# Whole-document imports carry before/after values; Canvas enforces a 10 MiB document cap.
MAX_MESSAGE_BYTES = int(os.environ.get("WS_MAX_MESSAGE_BYTES", str(24 * 1024 * 1024)))

# ---- collaboration ----
# Seconds a lock survives without a heartbeat. A live lock is never stolen; this only
# exists so a crashed client eventually releases. Clients renew at TTL/3.
LOCK_TTL = float(os.environ.get("WS_LOCK_TTL", "30"))
MAX_OPS_PER_COMMIT = int(os.environ.get("WS_MAX_OPS_PER_COMMIT", "64"))
MAX_BLOCK_DEPTH = int(os.environ.get("WS_MAX_BLOCK_DEPTH", "64"))
# Token buckets, per connection, per second.
RATE_COMMITS = float(os.environ.get("WS_RATE_COMMITS", "30"))
RATE_LOCKS = float(os.environ.get("WS_RATE_LOCKS", "10"))
# Outbound queue per connection. On overflow we drop the client rather than buffer without
# bound: one slow laptop must not stall the room.
SEND_QUEUE_MAX = int(os.environ.get("WS_SEND_QUEUE_MAX", "256"))
# Fold the op log into a fresh snapshot this often (and whenever a room empties).
SNAPSHOT_EVERY = int(os.environ.get("WS_SNAPSHOT_EVERY", "200"))
# Apply ws/app/sql/*.sql at startup. Turn off once Django owns these tables.
AUTO_MIGRATE = os.environ.get("WS_AUTO_MIGRATE", "0") == "1"
# Cross-worker fan-out. Unset means a single-process in-memory bus (dev, tests).
REDIS_URL = os.environ.get("REDIS_URL", "")

DB_HOST = os.environ.get("POSTGRES_HOST", "db")
DB_PORT = int(os.environ.get("POSTGRES_PORT", "5432"))
DB_NAME = _required("POSTGRES_DB")
DB_USER = _required("POSTGRES_USER")
DB_PASSWORD = _required("POSTGRES_PASSWORD")
DB_POOL_MIN = int(os.environ.get("WS_DB_POOL_MIN", "1"))
DB_POOL_MAX = int(os.environ.get("WS_DB_POOL_MAX", "10"))
