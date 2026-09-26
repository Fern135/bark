"""Validate the resolved production configuration without starting any containers."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(shutil.which('docker'), 'Docker CLI required; no daemon needed')
class ComposeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        env = os.environ.copy()
        env.update(SITE_DOMAIN='bark-test.duckdns.org', ACME_EMAIL='owner@example.test',
                   BARK_RELEASE='a' * 40, BARK_PLATFORM='linux/arm64',
                   POSTGRES_PASSWORD='test-only-password', DJANGO_SECRET_KEY='test-only-django',
                   JWT_SECRET='test-only-jwt')
        result = subprocess.run(['docker', 'compose', '--env-file', str(ROOT / '.env.example'),
                                 '-f', str(ROOT / 'docker-compose.prod.yml'), 'config', '--format', 'json'],
                                capture_output=True, text=True, env=env, check=True)
        cls.model = json.loads(result.stdout)
        cls.services = cls.model['services']

    def test_only_caddy_publishes_ports(self):
        for name, service in self.services.items():
            ports = service.get('ports', [])
            if name == 'caddy':
                self.assertEqual({str(port['published']) for port in ports}, {'80', '443'})
            else:
                self.assertEqual(ports, [], name)

    def test_application_and_data_services_have_no_external_network(self):
        self.assertTrue(self.model['networks']['internal']['internal'])
        for name in ('web', 'server', 'ws', 'db', 'redis'):
            self.assertEqual(set(self.services[name]['networks']), {'internal'})

    def test_recovery_migrations_tests_and_secure_cookies_are_explicit(self):
        for name in ('server', 'ws'):
            env = self.services[name]['environment']
            for key in ('ACCOUNT_RECOVERY_ENABLED', 'DEMO_EMAIL', 'DJANGO_MIGRATE_ON_START', 'RUN_TESTS_ON_START', 'DJANGO_DEBUG'):
                self.assertEqual(env[key], '0', key)
            for key in ('JWT_COOKIE_SECURE', 'DJANGO_SECURE_COOKIES', 'DJANGO_TRUST_PROXY'):
                self.assertEqual(env[key], '1', key)
            self.assertEqual(env['JWT_SECRET'], self.services['server']['environment']['JWT_SECRET'])
        self.assertEqual(self.services['server']['environment']['GUNICORN_WORKERS'], '2')
        self.assertEqual(self.services['web']['build']['args']['NEXT_PUBLIC_ACCOUNT_RECOVERY_ENABLED'], '0')

    def test_health_checks_platform_and_bounded_logs(self):
        for name, service in self.services.items():
            self.assertEqual(service['platform'], 'linux/arm64', name)
            self.assertEqual(service['logging']['options']['max-file'], '3', name)
            if name != 'caddy':
                self.assertIn('healthcheck', service, name)

    def test_runtime_limits_leave_room_for_host_on_twelve_gib_vm(self):
        total = sum(int(service['mem_limit']) for service in self.services.values())
        self.assertLessEqual(total, 10 * 1024**3)


if __name__ == '__main__':
    unittest.main()
