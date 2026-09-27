from django.urls import path
from . import views

urlpatterns = [
    path("games/", views.games),
    path("games/<uuid:game_id>/", views.detail),
    path("games/<uuid:game_id>/publication/", views.publication),
    path("games/<uuid:game_id>/cover/", views.cover),
]
