from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("canvas", "0002_game_collaboration_game_invite_code_workspacelock_and_more")]
    operations = [migrations.AddField(model_name="game", name="object_scripts", field=models.JSONField(default=dict, blank=True))]
