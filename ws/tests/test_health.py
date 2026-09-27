import os
from unittest.mock import AsyncMock, patch

os.environ.setdefault('DJANGO_SECRET_KEY', 'hosting-test-secret')

from fastapi.testclient import TestClient
from app.main import app


def test_health_reports_failed_bus():
    with patch('django.db.backends.base.base.BaseDatabaseWrapper.cursor'), patch('app.main.bus.bus') as get_bus:
        get_bus.return_value.healthy = AsyncMock(return_value=False)
        with TestClient(app) as client:
            response = client.get('/health')
    assert response.status_code == 503
    assert response.json() == {'status': 'unavailable'}


def test_health_reports_failed_database():
    with patch('django.db.backends.base.base.BaseDatabaseWrapper.cursor', side_effect=RuntimeError('private detail')):
        with TestClient(app) as client:
            response = client.get('/health')
    assert response.status_code == 503
    assert 'private detail' not in response.text


def test_health_healthy():
    with patch('django.db.backends.base.base.BaseDatabaseWrapper.cursor'), patch('app.main.bus.bus') as get_bus:
        get_bus.return_value.healthy = AsyncMock(return_value=True)
        with TestClient(app) as client:
            assert client.get('/health').status_code == 200
