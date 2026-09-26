"""Local safety checks: no Docker daemon, SSH host or cloud credentials required."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('bark', Path(__file__).with_name('bark.py'))
bark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bark)


class OperationsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name)
        self.state_patch = patch.object(bark, 'STATE', self.state)
        self.state_patch.start()
        self.addCleanup(self.state_patch.stop)
        self.env = {'SITE_DOMAIN': 'bark-test.duckdns.org', 'OCI_NAMESPACE': 'ns', 'OCI_BUCKET': 'backups',
                    'OCI_TOPIC_ID': 'topic', 'OCI_REGION': 'us-ashburn-1'}
        self.env_patch = patch.object(bark, 'read_env', return_value=self.env)
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)
        self.prod = bark.Production('a' * 40)

    def test_release_rejects_shell_fragments(self):
        for value in ('main', 'a' * 40 + ';pwd', '../release', '-option'):
            with self.assertRaises(ValueError):
                bark.release_sha(value)

    def test_hostname_rejects_urls_ports_and_interpolation(self):
        for value in ('https://test.duckdns.org', 'test.duckdns.org:80', '$(whoami).duckdns.org', '*.duckdns.org'):
            with self.assertRaises(ValueError):
                bark.validate_domain(value)

    def test_failed_backup_prevents_migration_and_preserves_pending_state(self):
        bark.save_state({'built': self.prod.sha, 'active': 'b' * 40})
        with patch.object(self.prod, 'check_bucket'), patch.object(self.prod, 'compose') as compose, \
             patch.object(self.prod, 'backup', side_effect=RuntimeError('upload failed')):
            with self.assertRaises(RuntimeError):
                self.prod.prepare()
        self.assertEqual(bark.read_state()['pending']['sha'], self.prod.sha)
        self.assertFalse(any('migrate' in call.args for call in compose.call_args_list))

    def test_activation_requires_matching_offsite_copy_checksum(self):
        bark.save_state({'pending': {'sha': self.prod.sha, 'digest': '1' * 64}})
        with patch.object(self.prod, 'compose') as compose:
            with self.assertRaises(RuntimeError):
                self.prod.activate('2' * 64)
            compose.assert_not_called()

    def test_failed_migration_does_not_start_new_services(self):
        bark.save_state({'pending': {'sha': self.prod.sha, 'digest': '1' * 64}})
        with patch.object(self.prod, 'compose', side_effect=RuntimeError('migration failed')) as compose:
            with self.assertRaises(RuntimeError):
                self.prod.activate('1' * 64)
        self.assertEqual(compose.call_count, 1)
        self.assertIn('pending', bark.read_state())

    def test_restore_only_creates_and_drops_a_unique_test_database(self):
        backup = self.state / 'example.dump'
        backup.write_bytes(b'fixture')
        with patch.object(self.prod, 'compose') as compose:
            self.prod.restore_check(backup)
        calls = [call.args for call in compose.call_args_list]
        create = next(args for args in calls if 'createdb' in args)
        drop = next(args for args in calls if 'dropdb' in args)
        self.assertTrue(create[-1].startswith('bark_restore_'))
        self.assertEqual(create[-1], drop[-1])
        self.assertNotEqual(create[-1], 'bark')

    def test_backup_refuses_public_or_versioned_bucket(self):
        for public, version in (('ObjectRead', 'Disabled'), ('NoPublicAccess', 'Enabled'), ('NoPublicAccess', 'Suspended')):
            with patch.object(self.prod, 'oci', return_value={'data': {'public-access-type': public, 'versioning': version}}):
                with self.assertRaises(RuntimeError):
                    self.prod.check_bucket()

    def test_backup_never_deletes_old_copies_if_upload_fails(self):
        def compose(*args, **kwargs):
            if 'pg_dump' in args:
                kwargs['stdout'].write(b'compressed-dump')
        with patch.object(self.prod, 'compose', side_effect=compose), \
             patch.object(self.prod, 'check_bucket'), \
             patch.object(self.prod, 'objects', return_value=[]), \
             patch.object(self.prod, 'oci', side_effect=RuntimeError('upload failed')) as oci:
            with self.assertRaises(RuntimeError):
                self.prod.backup()
        self.assertFalse(any('delete' in call.args for call in oci.call_args_list))
        self.assertFalse((self.state / 'backup-success').exists())

    def test_backup_budget_rejects_upload_without_removing_backups(self):
        def compose(*args, **kwargs):
            if 'pg_dump' in args:
                kwargs['stdout'].write(b'compressed-dump')
        with patch.object(self.prod, 'compose', side_effect=compose), \
             patch.object(self.prod, 'check_bucket'), \
             patch.object(self.prod, 'objects', return_value=[{'name': 'old.dump', 'size': bark.MAX_STORAGE}]), \
             patch.object(self.prod, 'oci') as oci:
            with self.assertRaisesRegex(RuntimeError, 'storage budget'):
                self.prod.backup()
        oci.assert_not_called()

    def test_retention_keeps_seven_daily_copies_and_ignores_unrelated_objects(self):
        def compose(*args, **kwargs):
            if 'pg_dump' in args:
                kwargs['stdout'].write(b'compressed-dump')
        objects = [{'name': f'daily/2020-01-{day:02}.dump', 'size': 10} for day in range(1, 8)]
        objects.append({'name': 'do-not-delete', 'size': 10})
        with patch.object(self.prod, 'compose', side_effect=compose), \
             patch.object(self.prod, 'check_bucket'), \
             patch.object(self.prod, 'objects', return_value=objects), \
             patch.object(self.prod, 'oci') as oci:
            self.prod.backup()
        deleted = [call.args for call in oci.call_args_list if 'delete' in call.args]
        self.assertEqual(len(deleted), 1)
        self.assertIn('daily/2020-01-01.dump', deleted[0])
        self.assertTrue((self.state / 'backup-success').exists())


if __name__ == '__main__':
    unittest.main()
