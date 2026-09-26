#!/bin/sh
set -e

# The Django project is written by hand; until manage.py exists, idle instead of crash-looping.
if [ ! -f manage.py ]; then
  echo "server: no manage.py found in /app. Create your Django project in ./server (see README)."
  exec sleep infinity
fi

if [ "${DJANGO_MIGRATE_ON_START:-1}" = "1" ]; then
  python manage.py migrate --noinput
fi

case "$1" in
  gunicorn)
    exec gunicorn "${DJANGO_WSGI_MODULE:-config.wsgi}:application" \
      --bind 0.0.0.0:8000 \
      --workers "${GUNICORN_WORKERS:-3}" \
      --access-logfile - \
      --forwarded-allow-ips "*"
    ;;
  runserver)
    exec python manage.py runserver 0.0.0.0:8000
    ;;
  *)
    exec "$@"
    ;;
esac
