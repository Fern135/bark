"""Shared test setup for every Django app.

    from lib.testing import IsolatedTestCase

IsolatedTestCase gives each test a clean, private cache:
- Rate-limit counters live in redis. Tests use redis DB 15, never the app's DB 1.
- Tests run in parallel (manage.py test --parallel). Each worker gets its own key prefix
  (test-<worker>) and deletes only its own keys before every test, so workers can't wipe
  each other's counters.
- Outside Docker (no DJANGO_CACHE_URL) it falls back to an in-memory cache; tests that need
  real redis should use @skipUnless(USES_REDIS, ...).
It also swaps in a fast password hasher (real hashing is deliberately slow).
"""
from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.test import TestCase, override_settings

APP_CACHE = settings.CACHES["default"]
USES_REDIS = APP_CACHE["BACKEND"].endswith("RedisCache")
# Same redis server as the app, separate database, so tests never clobber real counters.
TEST_REDIS_URL = APP_CACHE["LOCATION"].rsplit("/", 1)[0] + "/15" if USES_REDIS else None
FAST_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]


def worker_prefix():
    # Parallel workers each get a cloned test database: test_bark_1, test_bark_2, ...
    # A single (non-parallel) run uses test_bark.
    suffix = connection.settings_dict["NAME"].rsplit("_", 1)[-1]
    return f"test-{suffix if suffix.isdigit() else 0}"


def test_caches(prefix):
    if USES_REDIS:
        return {"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": TEST_REDIS_URL, "KEY_PREFIX": prefix}}
    return {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


def clear_test_cache(prefix):
    if USES_REDIS:
        import redis

        client = redis.Redis.from_url(TEST_REDIS_URL)
        keys = list(client.scan_iter(f"{prefix}:*"))  # only this worker's keys
        if keys:
            client.delete(*keys)
    else:
        cache.clear()  # in-memory cache is already per process


@override_settings(PASSWORD_HASHERS=FAST_HASHERS)
class IsolatedTestCase(TestCase):
    def setUp(self):
        super().setUp()
        prefix = worker_prefix()
        self.enterContext(override_settings(CACHES=test_caches(prefix)))
        clear_test_cache(prefix)
