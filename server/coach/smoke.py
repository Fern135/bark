"""Opt-in real provider check: python -m coach.smoke (from server/).

Uses configured server credentials and spends API tokens. Prints fixture names and
result categories only, never credentials or submitted source. No project writes.
"""
import json
import os
from pathlib import Path

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "server.settings")


def main():
    import django
    django.setup()
    from django.conf import settings
    from .views import call_openai, checked_suggestion

    if not settings.OPENAI_API_KEY:
        raise SystemExit("OPENAI_API_KEY is not configured; no requests sent.")
    failed = 0
    for fixture in json.loads(Path(__file__).with_name("fixtures.json").read_text()):
        snapshot = {"language": fixture.get("language", "python"), "python": fixture["python"],
                    "sourceMap": fixture.get("sourceMap", {}), "blocks": fixture.get("blocks", []),
                    "context": {}, "diagnostics": []}
        try:
            hint = checked_suggestion(call_openai({"snapshot": snapshot, "dismissed": []}), snapshot)
            actual = hint["category"] if hint else "silence"
            allowed = fixture["expect"].split("-or-")
            passed = actual in allowed
            print(f"{fixture['name']}: {actual} ({'PASS' if passed else 'REVIEW'})")
            failed += not passed
        except Exception as error:
            print(f"{fixture['name']}: {type(error).__name__}")
            failed += 1
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
