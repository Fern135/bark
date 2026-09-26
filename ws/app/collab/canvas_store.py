"""Use Django's transaction functions without blocking the ASGI event loop."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "server"))
sys.path.insert(0, "/server")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "server.settings")
import django
django.setup()

from asgiref.sync import sync_to_async
from django.db import close_old_connections
from canvas import collaboration


async def call(name, *args):
    def execute():
        close_old_connections()
        try:
            return getattr(collaboration, name)(*args)
        finally:
            close_old_connections()
    return await sync_to_async(execute, thread_sensitive=True)()
