import os
from pathlib import Path

from dotenv import load_dotenv

# Locally, load the repo-root .env (bark/.env). In Docker the file isn't there and
# docker compose already injects the variables, which always take precedence.
load_dotenv(Path(__file__).resolve().parents[2] / '.env', override=False)


def _required(name):
    value = os.environ.get(name)
    if not value or value == 'change-me':
        raise RuntimeError(f'Set {name} in .env')
    return value


def _bool(name, default='0'):
    return os.environ.get(name, default).strip().lower() in ('1', 'true', 'yes', 'on')


def _list(name, default=''):
    return [item.strip() for item in os.environ.get(name, default).split(',') if item.strip()]


class Config:
    BYTE_HINTS_ENABLED = _bool('BYTE_HINTS_ENABLED', '1')
    OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY', '')
    OPENAI_MODEL = os.environ.get('OPENAI_MODEL', 'gpt-5.4-mini-2026-03-17')

    # ---- Django ----
    SECRET_KEY = _required('DJANGO_SECRET_KEY')
    DEBUG = _bool('DJANGO_DEBUG')
    TRUST_PROXY = _bool('DJANGO_TRUST_PROXY')
    SECURE_COOKIES = _bool('DJANGO_SECURE_COOKIES')
    ALLOWED_HOSTS = _list('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1')
    CSRF_TRUSTED_ORIGINS = _list('DJANGO_CSRF_TRUSTED_ORIGINS', 'http://localhost:8080')
    # Browser origins allowed to call /api/ cross-origin (the web frontend). Same-origin calls
    # through the gateway don't need this; it's for serving the frontend from another origin.
    CORS_ALLOWED_ORIGINS = _list('DJANGO_CORS_ALLOWED_ORIGINS', 'http://localhost:8080')
    # Hostnames other containers use to reach Django directly on the internal network:
    # web's server-side rendering and ws call http://server:8000.
    INTERNAL_HOSTS = ['server']

    # ---- Postgres (shared with ws/) ----
    # docker compose sets POSTGRES_HOST=db; localhost is for running outside Docker.
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': _required('POSTGRES_DB'),
            'USER': _required('POSTGRES_USER'),
            'PASSWORD': _required('POSTGRES_PASSWORD'),
            'HOST': os.environ.get('POSTGRES_HOST', 'localhost'),
            'PORT': os.environ.get('POSTGRES_PORT', '5432'),
            'CONN_MAX_AGE': 60,
            'CONN_HEALTH_CHECKS': True,
            'OPTIONS': {'connect_timeout': 3},
        }
    }

    # ---- JWT (must match ws/) ----
    JWT_SECRET = _required('JWT_SECRET')
    JWT_ALGORITHM = os.environ.get('JWT_ALGORITHM', 'HS256')
    JWT_ISSUER = os.environ.get('JWT_ISSUER', 'bark-server')
    JWT_AUDIENCE = os.environ.get('JWT_AUDIENCE', 'bark-web')
    JWT_ACCESS_COOKIE = os.environ.get('JWT_ACCESS_COOKIE', 'access_token')
    # How long a login lasts (JWT + cookie). Default: 1 week.
    JWT_ACCESS_TTL_MINUTES = int(os.environ.get('JWT_ACCESS_TTL_MINUTES', str(7 * 24 * 60)))
    JWT_REFRESH_TTL_DAYS = int(os.environ.get('JWT_REFRESH_TTL_DAYS', '7'))
    # Secure cookies are only sent over HTTPS (browsers also allow them on http://localhost).
    JWT_COOKIE_SECURE = _bool('JWT_COOKIE_SECURE', '1')

    # ---- Login brute-force protection ----
    # After LOGIN_MAX_FAILURES wrong passwords for one account, that account is locked for
    # LOGIN_LOCKOUT_MINUTES (counted from the first failure).
    LOGIN_MAX_FAILURES = int(os.environ.get('LOGIN_MAX_FAILURES', '5'))
    LOGIN_LOCKOUT_MINUTES = int(os.environ.get('LOGIN_LOCKOUT_MINUTES', '15'))

    # ---- Cache ----
    # docker compose points this at the redis service so all gunicorn workers share login
    # counters. Empty (e.g. running outside Docker) means a per-process in-memory cache.
    CACHE_URL = os.environ.get('DJANGO_CACHE_URL', '')

    # ---- Canvas (game library) ----
    # Requests per user per minute across all /api/canvas/ endpoints. Scratch-style editors
    # autosave small changes often, so this is generous.
    CANVAS_REQUESTS_PER_MINUTE = int(os.environ.get('CANVAS_REQUESTS_PER_MINUTE', '300'))

    # ---- Password / username recovery ----
    # Base URL of the Next.js site, used to build the reset link in emails.
    FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:8080').rstrip('/')
    PASSWORD_RESET_MINUTES = int(os.environ.get('PASSWORD_RESET_MINUTES', '60'))
    ACCOUNT_RECOVERY_ENABLED = _bool('ACCOUNT_RECOVERY_ENABLED', '1')

    # ---- Email ----
    # Demo mode: emails are saved to the database and shown by GET /api/auth/demo-inbox/
    # instead of being sent. Anyone who knows an address can read its inbox, so turn this
    # off (0) for anything real.
    DEMO_EMAIL = _bool('DEMO_EMAIL', '1')
    # Console backend prints emails to the server logs. For real email, set the SMTP backend
    # and EMAIL_HOST etc. (the server container also needs a network with internet access).
    EMAIL_BACKEND = os.environ.get('EMAIL_BACKEND', 'django.core.mail.backends.console.EmailBackend')
    EMAIL_HOST = os.environ.get('EMAIL_HOST', 'localhost')
    EMAIL_PORT = int(os.environ.get('EMAIL_PORT', '587'))
    EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER', '')
    EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_HOST_PASSWORD', '')
    EMAIL_USE_TLS = _bool('EMAIL_USE_TLS', '1')
    DEFAULT_FROM_EMAIL = os.environ.get('DEFAULT_FROM_EMAIL', 'Bark <no-reply@localhost>')


config = Config()
