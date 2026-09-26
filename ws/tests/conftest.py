"""Test setup.

app.config reads the environment at import time and hard-fails on missing secrets, so the
environment has to be populated before anything under app/ is imported. Keep this file free
of app imports for that reason.
"""

import os

os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("JWT_ISSUER", "bark-server")
os.environ.setdefault("JWT_AUDIENCE", "bark-web")
os.environ.setdefault("POSTGRES_DB", "bark_test")
os.environ.setdefault("POSTGRES_USER", "bark")
os.environ.setdefault("POSTGRES_PASSWORD", "bark")
os.environ.setdefault("WS_ALLOWED_ORIGINS", "http://localhost:8080")
# Empty means the in-process bus, which is what the unit tests want.
os.environ.setdefault("REDIS_URL", "")

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
