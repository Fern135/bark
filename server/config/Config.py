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
    # ---- Django ----
    SECRET_KEY = _required('DJANGO_SECRET_KEY')
    DEBUG = _bool('DJANGO_DEBUG')
    ALLOWED_HOSTS = _list('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1')
    CSRF_TRUSTED_ORIGINS = _list('DJANGO_CSRF_TRUSTED_ORIGINS', 'http://localhost:8080')

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
        }
    }

    # ---- JWT (must match ws/) ----
    JWT_SECRET = _required('JWT_SECRET')
    JWT_ALGORITHM = os.environ.get('JWT_ALGORITHM', 'HS256')
    JWT_ISSUER = os.environ.get('JWT_ISSUER', 'bark-server')
    JWT_AUDIENCE = os.environ.get('JWT_AUDIENCE', 'bark-web')
    JWT_ACCESS_COOKIE = os.environ.get('JWT_ACCESS_COOKIE', 'access_token')
    JWT_ACCESS_TTL_MINUTES = int(os.environ.get('JWT_ACCESS_TTL_MINUTES', '15'))
    JWT_REFRESH_TTL_DAYS = int(os.environ.get('JWT_REFRESH_TTL_DAYS', '7'))


config = Config()
