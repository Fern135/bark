"""Who may open a game. Every canvas view goes through here, so this is the one place to
change when collaborators are added (once live collaboration works).

Today: only the owner. A game someone else owns answers 404, not 403, so ids can't be
probed to find out which games exist.
"""
from .models import Game


def games_for(user_id):
    """The games this user may see."""
    return Game.objects.filter(owner_id=user_id)


def get_game(user_id, game_id, *, for_update=False):
    """The game, or None if it doesn't exist or this user may not open it.

    for_update=True locks the game row until the surrounding transaction ends, so two
    requests editing the same game apply one after the other.
    """
    games = games_for(user_id)
    if for_update:
        games = games.select_for_update()
    return games.filter(pk=game_id).first()
