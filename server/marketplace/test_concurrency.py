from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Event
import uuid

from django.db import close_old_connections, transaction
from django.test import Client, TransactionTestCase, skipUnlessDBFeature
from django.utils import timezone

from authenticator.models import User
from canvas.document import save_document
from canvas.models import Game
from canvas.tests import sample
from .models import Publication


@skipUnlessDBFeature("has_select_for_update")
class PublicReadConcurrencyTests(TransactionTestCase):
    def test_reader_waits_for_a_complete_saved_revision(self):
        owner = User.objects.create(user_id=str(uuid.uuid4()), username="publisher", email="publisher@example.test")
        game = Game.objects.create(owner=owner, name="Before")
        save_document(game, sample(name="Before"))
        Publication.objects.create(game=game, is_public=True, published_at=timezone.now())
        started = Event()

        def read():
            close_old_connections()
            try:
                started.set()
                return Client().get(f"/api/marketplace/games/{game.pk}/").json()
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=1) as executor:
            with transaction.atomic():
                locked = Game.objects.select_for_update().get(pk=game.pk)
                locked.name = "After"
                locked.save(update_fields=["name"])
                pending = executor.submit(read)
                self.assertTrue(started.wait(5))
                with self.assertRaises(TimeoutError):
                    pending.result(timeout=0.2)
                save_document(locked, sample(name="After", properties={"complete": True}))
                locked.touch()
            public = pending.result(timeout=5)
        self.assertEqual(public["name"], "After")
        self.assertEqual(public["document"]["project"]["properties"], {"complete": True})
        self.assertEqual(public["revision"], Game.objects.get(pk=game.pk).revision)
