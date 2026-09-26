"""Game library storage for the dashboard.

A game document (the JSON the engine/scripting packages load, `GameDocument` version 1) is
split into one table per section, so the Scratch-style editor can change one small part
(move an entity, edit the script, tweak gravity) without rewriting the whole game:

    GameDocument                          stored in
    ------------------------------------  ---------------------------------------------
    version                               Game.document_version
    project.version / name / properties   Game.project_version / name / properties
    project.entities[]                    Entity         (one row per entity, in order)
    project.assets[] / materials[] /      Asset / Material / Prefab
      prefabs[]                                          (one row per item, in order)
    project.settings                      GameSettings   (one row per game)
    project.cameras                       GameCameras    (one row per game)
    project.input                         GameInput      (one row per game)
    script                                GameScript     (one row per game)

canvas/document.py rebuilds the exact JSON from these rows (`to_document`) and saves a whole
document into them (`save_document`). Keys the models don't know yet are kept in `extra`
fields and written back unchanged, so a newer engine's documents survive a round trip.

Usage (these are what the views in canvas/views.py do):

    from canvas.models import Game, Entity
    from canvas.document import to_document, save_document

    game = Game.objects.create(owner=user, name="My Game")
    save_document(game, document)                  # whole document -> section rows
    to_document(game)                              # section rows -> whole document

    # Change one section only:
    game.settings.data["gravity"] = {"x": 0, "y": -3, "z": 0}
    game.settings.save()
    game.script.source = 'print("hi")\\n'
    game.script.save()

    # One entity:
    ground = game.entities.get(entity_id="ground")
    ground.transform["position"]["y"] = 2
    ground.save()
    game.touch()                                   # bump revision + updated_at after any change

Every JSON field holds exactly the engine's value for that key (e.g. Entity.transform is
{"position": {...}, "rotation": {...}, "scale": {...}}); canvas/document.py validates shape.
"""
import uuid

from django.db import models
from django.db.models import F
from django.utils import timezone

from authenticator.models import User


class Game(models.Model):
    """One saved game. Owns every section below (deleted with it)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Owner-only access for now; collaborators will be added when live collaboration lands
    # (see canvas/access.py, the single place that decides who may open a game).
    owner = models.ForeignKey(User, to_field="user_id", on_delete=models.CASCADE, related_name="games")

    name = models.CharField(max_length=200)                      # project.name
    document_version = models.PositiveSmallIntegerField(default=1)  # document "version"
    project_version = models.PositiveSmallIntegerField(default=1)   # project.version
    properties = models.JSONField(default=dict, blank=True)      # project.properties
    project_extra = models.JSONField(default=dict, blank=True)   # unknown project keys

    # Bumped on every change to the game or any of its sections. Clients can compare it to
    # notice that someone (or another tab) changed the game since they loaded it.
    revision = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return self.name

    def touch(self):
        """Record that the game changed: revision + 1 and a new updated_at."""
        Game.objects.filter(pk=self.pk).update(revision=F("revision") + 1, updated_at=timezone.now())
        self.refresh_from_db(fields=["revision", "updated_at"])


class GameSection(models.Model):
    """A one-per-game section stored as the engine's JSON object for that key."""

    data = models.JSONField(default=dict)

    class Meta:
        abstract = True


class GameSettings(GameSection):
    """project.settings: background, lighting, shadows, resolution, gravity."""

    game = models.OneToOneField(Game, on_delete=models.CASCADE, primary_key=True, related_name="settings")

    class Meta:
        db_table = "canvas_game_settings"


class GameCameras(GameSection):
    """project.cameras: active camera, target, offset, field of view."""

    game = models.OneToOneField(Game, on_delete=models.CASCADE, primary_key=True, related_name="cameras")

    class Meta:
        db_table = "canvas_game_cameras"


class GameInput(GameSection):
    """project.input: action name -> list of key codes, e.g. {"jump": ["Space"]}."""

    game = models.OneToOneField(Game, on_delete=models.CASCADE, primary_key=True, related_name="input")

    class Meta:
        db_table = "canvas_game_input"


class GameScript(models.Model):
    """The game's script: Python source, or a Blockly workspace for block scripts."""

    LANGUAGES = [("python", "Python"), ("blocks", "Blocks")]

    game = models.OneToOneField(Game, on_delete=models.CASCADE, primary_key=True, related_name="script")
    language = models.CharField(max_length=16, choices=LANGUAGES, default="python")
    source = models.TextField(blank=True, default="")           # python: the code
    workspace = models.JSONField(null=True, blank=True)         # blocks: Blockly workspace JSON
    extra = models.JSONField(default=dict, blank=True)          # other keys (e.g. blocks backup)

    class Meta:
        db_table = "canvas_game_script"


class OrderedItem(models.Model):
    """A row that belongs to one of a game's lists, remembering its position in the list."""

    game = models.ForeignKey(Game, on_delete=models.CASCADE)
    item_id = models.CharField(max_length=100)   # the item's "id" in the document
    position = models.PositiveIntegerField()     # index in the document's list

    class Meta:
        abstract = True
        ordering = ["position"]


class Entity(OrderedItem):
    """One entry of project.entities: a thing in the world (ground, player, coin...)."""

    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="entities")
    name = models.CharField(max_length=200, blank=True, default="")
    tags = models.JSONField(default=list, blank=True)
    enabled = models.BooleanField(default=True)
    visible = models.BooleanField(default=True)
    parent_id = models.CharField(max_length=100, null=True, blank=True)  # another entity's item_id

    transform = models.JSONField(default=dict)                # position / rotation / scale
    visual = models.JSONField(null=True, blank=True)          # kind, size, color, asset...
    collider = models.JSONField(null=True, blank=True)        # shape, size, trigger, mask...
    body = models.JSONField(null=True, blank=True)            # physics: mode, mass, friction...
    properties = models.JSONField(default=dict, blank=True)   # custom values for scripts
    character = models.JSONField(null=True, blank=True)       # character controller settings
    interaction = models.JSONField(null=True, blank=True)     # interaction prompt / distance
    extra = models.JSONField(default=dict, blank=True)        # keys not listed above

    class Meta(OrderedItem.Meta):
        db_table = "canvas_entity"
        verbose_name_plural = "entities"
        constraints = [models.UniqueConstraint(fields=["game", "item_id"], name="canvas_entity_unique_id")]

    def __str__(self):
        return f"{self.game}: {self.item_id}"

    @property
    def entity_id(self):
        return self.item_id


class LibraryItem(OrderedItem):
    """An entry of one of the project's libraries, stored whole (its own "id" included)."""

    data = models.JSONField()

    class Meta(OrderedItem.Meta):
        abstract = True


class Asset(LibraryItem):
    """project.assets[]: models and textures (URLs or embedded data: URIs)."""

    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="assets")

    class Meta(LibraryItem.Meta):
        db_table = "canvas_asset"
        constraints = [models.UniqueConstraint(fields=["game", "item_id"], name="canvas_asset_unique_id")]


class Material(LibraryItem):
    """project.materials[]"""

    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="materials")

    class Meta(LibraryItem.Meta):
        db_table = "canvas_material"
        constraints = [models.UniqueConstraint(fields=["game", "item_id"], name="canvas_material_unique_id")]


class Prefab(LibraryItem):
    """project.prefabs[]: reusable entity templates."""

    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="prefabs")

    class Meta(LibraryItem.Meta):
        db_table = "canvas_prefab"
        constraints = [models.UniqueConstraint(fields=["game", "item_id"], name="canvas_prefab_unique_id")]
