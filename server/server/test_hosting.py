from unittest.mock import patch

from django.test import Client, SimpleTestCase, override_settings

from lib.testing import IsolatedTestCase


@override_settings(ACCOUNT_RECOVERY_ENABLED=False, DEMO_EMAIL=False)
class DisabledRecoveryTests(IsolatedTestCase):
    def test_recovery_never_generates_tokens_or_emails(self):
        with patch('authenticator.views.create_password_reset_token') as issue, \
             patch('authenticator.views.read_password_reset_token') as read, \
             patch('authenticator.views._send_email') as send:
            for endpoint in ('forgot-password', 'forgot-username', 'reset-password'):
                for data in ({'email': 'someone@example.test'}, {}, {'token': 'old-token', 'password': 'new'}):
                    response = self.client.post(f'/api/auth/{endpoint}/', data, content_type='application/json')
                    self.assertEqual(response.status_code, 503)
                    self.assertEqual(response.json()['error'], 'Account recovery is not available yet.')
            issue.assert_not_called()
            read.assert_not_called()
            send.assert_not_called()

    def test_demo_inbox_is_unavailable(self):
        self.assertEqual(self.client.get('/api/auth/demo-inbox/?email=anyone@example.test').status_code, 404)


class ReadinessTests(IsolatedTestCase):
    def test_healthy(self):
        self.assertEqual(self.client.get('/health/ready/').status_code, 200)

    def test_database_failure(self):
        with patch('server.health.connection.cursor', side_effect=RuntimeError('private connection detail')):
            response = self.client.get('/health/ready/')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private', response.content.decode())

    def test_cache_failure(self):
        with patch('server.health.cache.get', side_effect=RuntimeError('cache offline')):
            self.assertEqual(self.client.get('/health/ready/').status_code, 503)


@override_settings(SECURE_PROXY_SSL_HEADER=('HTTP_X_FORWARDED_PROTO', 'https'),
                   CSRF_COOKIE_SECURE=True, SESSION_COOKIE_SECURE=True,
                   CSRF_TRUSTED_ORIGINS=['https://bark-test.duckdns.org'],
                   ALLOWED_HOSTS=['bark-test.duckdns.org'])
class HTTPSSettingsTests(SimpleTestCase):
    def test_forwarded_https_sets_secure_csrf_cookie(self):
        response = Client().get('/api/auth/csrf/', HTTP_HOST='bark-test.duckdns.org', HTTP_X_FORWARDED_PROTO='https')
        self.assertTrue(response.wsgi_request.is_secure())
        self.assertTrue(response.cookies['csrftoken']['secure'])

    def test_admin_redirect_preserves_https(self):
        response = Client().get('/admin/', HTTP_HOST='bark-test.duckdns.org', HTTP_X_FORWARDED_PROTO='https')
        self.assertEqual(response.status_code, 302)
        self.assertNotIn('http:', response['Location'])
