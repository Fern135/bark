FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # entrypoint.sh runs the Django tests in the background, in parallel, every time the
    # container starts. auto = one worker per CPU the container may use (see entrypoint.sh).
    RUN_TESTS_ON_START=1 \
    TEST_PARALLEL=auto

# tini as PID 1 reaps the background test process when it finishes.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

RUN groupadd --system app && useradd --system --gid app --create-home app

COPY --chown=app:app . .
RUN chmod +x /app/entrypoint.sh
# collectstatic does not access the database. Supply build-only placeholders; no live secrets.
RUN DJANGO_SECRET_KEY=build-only JWT_SECRET=build-only POSTGRES_DB=build \
    POSTGRES_USER=build POSTGRES_PASSWORD=build python manage.py collectstatic --noinput \
    && chown -R app:app /app/staticfiles

USER app
EXPOSE 8000

ENTRYPOINT ["tini", "--", "/app/entrypoint.sh"]
CMD ["gunicorn"]
