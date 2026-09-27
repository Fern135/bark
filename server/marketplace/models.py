from django.db import models


class Publication(models.Model):
    game = models.OneToOneField("canvas.Game", on_delete=models.CASCADE, primary_key=True, related_name="publication")
    is_public = models.BooleanField(default=False, db_index=True)
    published_at = models.DateTimeField(null=True, blank=True, db_index=True)
    cover = models.BinaryField(null=True, blank=True)
    cover_revision = models.PositiveIntegerField(null=True, blank=True)
