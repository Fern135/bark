#!/usr/bin/env python3
"""Deploy a pushed release over SSH, copying the frozen DB backup to this computer first."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('host', help='SSH alias or ubuntu@public-ip')
    parser.add_argument('sha', help='Reviewed, pushed, full Git SHA')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._@-]*', args.host) or not re.fullmatch(r'[0-9a-f]{40}', args.sha):
        parser.error('Invalid SSH target or release SHA')
    os.umask(0o077)
    prefix = 'sudo python3 /opt/bark/app/deploy/bark.py'

    def ssh(command, **kwargs):
        result = subprocess.run(['ssh', '-o', 'BatchMode=yes', args.host, command], **kwargs)
        if result.returncode:
            raise SystemExit('Deployment stopped. Inspect remote state before retrying; no automatic database rollback occurred.')
        return result

    # A dirty host checkout is never reset or overwritten. The release must already be pushed.
    ssh(f'sudo git -C /opt/bark/app diff --quiet && '
        f'test -z "$(sudo git -C /opt/bark/app status --porcelain)" && '
        f'sudo git -C /opt/bark/app fetch origin {args.sha} && '
        f'sudo git -C /opt/bark/app checkout --detach {args.sha}')
    ssh(f'{prefix} build {args.sha}')
    ssh(f'{prefix} prepare {args.sha}')
    state = json.loads(ssh(f'{prefix} status', capture_output=True, text=True).stdout)
    pending = state['pending']
    path = pending['backup']
    if not re.fullmatch(r'/var/lib/bark/backups/predeploy/\d{4}-\d{2}-\d{2}T\d{6}Z\.dump', path):
        raise SystemExit('Unexpected backup path; refusing download')
    destination = Path.home() / '.bark-backups' / Path(path).stem
    destination.mkdir(parents=True, mode=0o700)
    backup = destination / 'database.dump'
    with backup.open('xb') as output:
        ssh(f'sudo cat {path}', stdout=output)
    with backup.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    if digest != pending['digest']:
        raise SystemExit('Downloaded backup checksum mismatch; deployment remains stopped')
    with (destination / 'production.env').open('xb') as output:
        ssh('sudo cat /etc/bark/production.env', stdout=output)
    (destination / 'release.json').write_text(json.dumps(state, indent=2))
    print(f'Backup and recovery settings saved privately to {destination}')
    ssh(f'{prefix} activate {args.sha} --copied-backup-sha256 {digest}')


if __name__ == '__main__':
    main()
