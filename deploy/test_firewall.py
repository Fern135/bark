from pathlib import Path
import importlib.util
import unittest

spec = importlib.util.spec_from_file_location('firewall', Path(__file__).with_name('oracle_firewall.py'))
firewall = importlib.util.module_from_spec(spec)
spec.loader.exec_module(firewall)


class FirewallTests(unittest.TestCase):
    def test_only_legacy_inbound_rules_change(self):
        source = '\n'.join(['# iptables configuration for Oracle Cloud Infrastructure',
            '*filter', ':INPUT ACCEPT [0:0]', *firewall.LEGACY_RULES,
            '-A OUTPUT -d 169.254.0.0/16 -j InstanceServices',
            '-A InstanceServices -d 169.254.169.254/32 -p tcp --dport 80 -j ACCEPT',
            '-A FORWARD -j REJECT --reject-with icmp-host-prohibited', 'COMMIT']) + '\n'
        result = firewall.updated_rules(source)
        self.assertNotIn('dport 22', result)
        self.assertNotIn('-A INPUT -j REJECT', result)
        self.assertIn(':INPUT DROP [0:0]', result)
        for line in source.splitlines():
            if line.startswith(('-A OUTPUT', '-A InstanceServices', '-A FORWARD')):
                self.assertIn(line, result)
        self.assertEqual(firewall.updated_rules(result), result)

    def test_non_oracle_firewall_is_untouched(self):
        source = '*filter\n:INPUT ACCEPT [0:0]\n' + firewall.LEGACY_RULES[0] + '\nCOMMIT\n'
        self.assertEqual(firewall.updated_rules(source), source)


if __name__ == '__main__':
    unittest.main()
