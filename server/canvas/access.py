"""Canvas access is limited to the sole owner and explicitly invited editors.
Unrelated accounts receive 404 so UUIDs do not disclose workspace data.
"""
from .models import Game
from django.db.models import Q


def games_for(user_id):
    """The games this user may see."""
    return Game.objects.filter(Q(owner_id=user_id) | Q(members__user_id=user_id)).distinct()


def get_game(user_id, game_id, *, for_update=False):
    """The game, or None if it doesn't exist or this user may not open it.

    for_update=True locks the game row until the surrounding transaction ends, so two
    requests editing the same game apply one after the other.
    """
    games = Game.objects.filter(pk__in=games_for(user_id).values("pk"))
    if for_update:
        games = games.select_for_update()
    return games.filter(pk=game_id).first()
