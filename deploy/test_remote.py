"""Release provenance gates must run before changing the server."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('remote', Path(__file__).with_name('remote.py'))
remote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(remote)


class RemoteTests(unittest.TestCase):
    def verify(self, outputs):
        return patch.object(remote.subprocess, 'run',
                            side_effect=[SimpleNamespace(stdout=value) for value in outputs])

    def test_wrong_checkout_stops_before_querying_remote(self):
        with self.verify(['b' * 40]) as run:
            with self.assertRaises(SystemExit):
                remote.verify_release('a' * 40)
            self.assertEqual(run.call_count, 1)

    def test_dirty_checkout_stops_before_querying_remote(self):
        with self.verify(['a' * 40, ' M server/settings.py']) as run:
            with self.assertRaises(SystemExit):
                remote.verify_release('a' * 40)
            self.assertEqual(run.call_count, 2)

    def test_unpublished_commit_is_rejected(self):
        with self.verify(['a' * 40, '', 'b' * 40 + '\trefs/heads/main']):
            with self.assertRaisesRegex(SystemExit, 'Push this release'):
                remote.verify_release('a' * 40)

    def test_published_clean_commit_is_accepted(self):
        with self.verify(['a' * 40, '', 'a' * 40 + '\trefs/heads/codex/hosting-release']):
            remote.verify_release('a' * 40)


if __name__ == '__main__':
    unittest.main()
