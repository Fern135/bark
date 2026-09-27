#!/usr/bin/env python3
"""Let UFW own inbound rules while preserving OCI's metadata/storage rules."""
from pathlib import Path
import os
import re
import subprocess

LEGACY_RULES = (
    '-A INPUT -p tcp -m state --state NEW -m tcp --dport 22 -j ACCEPT',
    '-A INPUT -j REJECT --reject-with icmp-host-prohibited',
)


def updated_rules(source):
    if '# iptables configuration for Oracle Cloud Infrastructure' not in source:
        return source
    result = '\n'.join(line for line in source.splitlines() if line not in LEGACY_RULES) + '\n'
    return re.sub(r'^:INPUT ACCEPT (\[[0-9:]+\])$', r':INPUT DROP \1', result, flags=re.MULTILINE)


def main():
    if os.geteuid() != 0:
        raise SystemExit('Run with sudo')
    status = subprocess.run(['ufw', 'status'], check=True, capture_output=True, text=True).stdout
    if not status.startswith('Status: active'):
        raise SystemExit('Enable the reviewed UFW rules before changing image defaults')
    path = Path('/etc/iptables/rules.v4')
    if not path.exists():
        return
    source = path.read_text()
    if '# iptables configuration for Oracle Cloud Infrastructure' not in source:
        return
    replacement = updated_rules(source)
    if replacement != source:
        backup = path.with_name('rules.v4.before-bark')
        if not backup.exists():
            with backup.open('x') as output:
                os.chmod(backup, 0o600)
                output.write(source)
        temporary = path.with_name('rules.v4.bark-tmp')
        temporary.write_text(replacement)
        temporary.chmod(0o600)
        temporary.replace(path)
    for rule in LEGACY_RULES:
        arguments = rule.split()[1:]
        exists = subprocess.run(['iptables', '-C', *arguments], stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL).returncode == 0
        if exists:
            subprocess.run(['iptables', '-D', *arguments], check=True)
    print('OCI inbound image defaults reconciled with UFW; InstanceServices rules preserved.')


if __name__ == '__main__':
    main()
