"""Opt-in local integration tests when Docker/Postgres is unavailable.

Never use this settings module for deployment. SQLite does not prove PostgreSQL
row-lock behaviour; run the normal suite against the Docker stack as well.
"""
import os
from .settings import *  # noqa: F403

DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": os.environ.get("BARK_TEST_DB", ":memory:")}}
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
