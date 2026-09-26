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

# Run the test suite in the background, in parallel, while the server starts. It never blocks
# or stops the server; results go to the logs prefixed with [tests]:
#   docker compose logs server | grep '\[tests\]'
# CPUs this container may actually use: nproc (respects cpusets), capped by a Docker CPU
# limit (cgroup v2 cpu.max, e.g. `cpus: 2`), never less than 1. 1 means the tests run serially.
available_cpus() {
  n=$(nproc 2>/dev/null || echo 1)
  if [ -r /sys/fs/cgroup/cpu.max ]; then
    read -r quota period < /sys/fs/cgroup/cpu.max
    if [ "$quota" != "max" ] && [ "${period:-0}" -gt 0 ]; then
      limit=$(( (quota + period - 1) / period ))
      [ "$limit" -lt "$n" ] && n=$limit
    fi
  fi
  [ "$n" -lt 1 ] && n=1
  echo "$n"
}

run_tests_in_background() {
  if [ "${RUN_TESTS_ON_START:-0}" = "1" ]; then
    workers="${TEST_PARALLEL:-auto}"
    [ "$workers" = "auto" ] && workers=$(available_cpus)
    echo "[tests] running in the background with $workers parallel worker(s)"
    # Double fork: the outer subshell exits at once, so the test run is orphaned and tini
    # (PID 1, see Dockerfile) reaps it when it finishes instead of leaving a zombie.
    ( (python manage.py test --noinput --parallel "$workers" 2>&1 | sed -u 's/^/[tests] /') & )
  fi
}

case "$1" in
  gunicorn)
    run_tests_in_background
    exec gunicorn "${DJANGO_WSGI_MODULE:-config.wsgi}:application" \
      --bind 0.0.0.0:8000 \
      --workers "${GUNICORN_WORKERS:-3}" \
      --access-logfile - \
      --forwarded-allow-ips "*"
    ;;
  runserver)
    run_tests_in_background
    exec python manage.py runserver 0.0.0.0:8000
    ;;
  *)
    exec "$@"
    ;;
esac
