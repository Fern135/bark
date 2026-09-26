"""Game library routes, mounted at /api/canvas/ in server/urls.py.

Every route needs the login JWT (cookie) and shares one per-user rate limit; see views.py.
Full request/response reference: API.md at the repo root.

Browser usage (web/src/lib/api.ts already sends the cookie and CSRF header):

    const { data } = await api.get("/canvas/games/");                         // my games
    const { data: game } = await api.post("/canvas/games/", { name: "Maze" }); // new game
    await api.get(`/canvas/games/${game.id}/`);                               // whole document
    await api.put(`/canvas/games/${game.id}/`, documentJson);                 // save everything
    await api.put(`/canvas/games/${game.id}/script/`, { language: "python", source });
    await api.patch(`/canvas/games/${game.id}/entities/ground/`, { transform });
    await api.delete(`/canvas/games/${game.id}/`);
"""
from django.urls import path

from . import views

SECTIONS = ("settings", "cameras", "input", "properties", "script")
LIBRARIES = ("assets", "materials", "prefabs")

urlpatterns = [
    path("games/",                                  views.games,       name="games"),        # GET list, POST create
    path("games/<uuid:game_id>/",                   views.game_detail, name="game"),         # GET, PUT document, PATCH name, DELETE
    path("games/<uuid:game_id>/entities/",          views.entities,    name="entities"),     # GET list, POST add
    path("games/<uuid:game_id>/entities/<str:entity_id>/", views.entity, name="entity"),     # GET, PUT, PATCH, DELETE
]

# GET/PUT api/canvas/games/<id>/settings/  .../cameras/  .../input/  .../properties/  .../script/
urlpatterns += [
    path(f"games/<uuid:game_id>/{section}/", views.section, {"section": section}, name=f"game-{section}")
    for section in SECTIONS
]

# api/canvas/games/<id>/assets/  (GET list, POST add)   .../assets/<item_id>/  (GET, PUT, DELETE)
# same for materials/ and prefabs/
urlpatterns += [
    route
    for library in LIBRARIES
    for route in (
        path(f"games/<uuid:game_id>/{library}/", views.library, {"library": library}, name=f"game-{library}"),
        path(f"games/<uuid:game_id>/{library}/<str:item_id>/", views.library_item, {"library": library}, name=f"game-{library}-item"),
    )
]
