from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True
    dependencies = [("canvas", "0001_initial")]
    operations = [migrations.CreateModel(name="Publication", fields=[
        ("game", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, primary_key=True, related_name="publication", serialize=False, to="canvas.game")),
        ("is_public", models.BooleanField(db_index=True, default=False)),
        ("published_at", models.DateTimeField(blank=True, db_index=True, null=True)),
        ("cover", models.BinaryField(blank=True, null=True)),
        ("cover_revision", models.PositiveIntegerField(blank=True, null=True)),
    ])]
