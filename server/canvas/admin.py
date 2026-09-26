from django.contrib import admin

from .models import Asset, Entity, Game, GameCameras, GameInput, GameScript, GameSettings, Material, Prefab


class EntityInline(admin.TabularInline):
    model = Entity
    fields = ("position", "item_id", "name", "parent_id", "enabled", "visible")
    extra = 0
    show_change_link = True


class SectionInline(admin.StackedInline):
    extra = 0
    can_delete = False


class SettingsInline(SectionInline):
    model = GameSettings


class CamerasInline(SectionInline):
    model = GameCameras


class InputInline(SectionInline):
    model = GameInput


class ScriptInline(SectionInline):
    model = GameScript


@admin.register(Game)
class GameAdmin(admin.ModelAdmin):
    list_display = ("name", "owner", "revision", "updated_at")
    search_fields = ("name", "owner__username")
    readonly_fields = ("id", "revision", "created_at", "updated_at")
    inlines = (SettingsInline, CamerasInline, InputInline, ScriptInline, EntityInline)


@admin.register(Entity)
class EntityAdmin(admin.ModelAdmin):
    list_display = ("item_id", "name", "game", "position")
    search_fields = ("item_id", "name", "game__name")


for model in (Asset, Material, Prefab):
    admin.site.register(model, list_display=("item_id", "game", "position"))
