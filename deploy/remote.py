#!/usr/bin/env python3
"""Deploy a pushed release over SSH, copying the frozen DB backup to this computer first."""
import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def private_directory(path):
    """Call only for a newly created directory, before writing secrets into it."""
    if os.name == 'nt':
        identity = subprocess.run(['whoami', '/user', '/fo', 'csv', '/nh'],
                                  check=True, capture_output=True, text=True).stdout
        sid = next(csv.reader(identity.strip().splitlines()))[1]
        subprocess.run(['icacls', str(path), '/inheritance:r', '/grant:r',
                        f'*{sid}:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F'],
                       check=True, stdout=subprocess.DEVNULL)
    else:
        path.chmod(0o700)


def verify_release(sha):
    def git(*args):
        return subprocess.run(['git', '-C', str(ROOT), *args], check=True,
                              capture_output=True, text=True).stdout.strip()
    if git('rev-parse', 'HEAD') != sha or git('status', '--porcelain'):
        raise SystemExit('Deploy from a clean checkout of the requested release SHA.')
    if sha not in {line.split()[0] for line in git('ls-remote', 'origin').splitlines()}:
        raise SystemExit('Push this release before deploying it.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('host', help='SSH alias or ubuntu@public-ip')
    parser.add_argument('sha', help='Reviewed, pushed, full Git SHA')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._@-]*', args.host) or not re.fullmatch(r'[0-9a-f]{40}', args.sha):
        parser.error('Invalid SSH target or release SHA')
    os.umask(0o077)
    verify_release(args.sha)
    prefix = 'sudo python3 /opt/bark/app/deploy/bark.py'

    def ssh(command, **kwargs):
        result = subprocess.run(['ssh', '-o', 'BatchMode=yes', args.host, command], **kwargs)
        if result.returncode:
            raise SystemExit('Deployment stopped. Inspect remote state before retrying; no automatic database rollback occurred.')
        return result

    # Transfer private repositories without installing GitHub credentials on the VM.
    # A dirty host checkout is never reset or overwritten.
    ssh(f'sudo git -C /opt/bark/app diff --quiet && '
        f'test -z "$(sudo git -C /opt/bark/app status --porcelain)"')
    previous = ssh('sudo git -C /opt/bark/app rev-parse HEAD', capture_output=True, text=True).stdout.strip()
    if not re.fullmatch(r'[0-9a-f]{40}', previous):
        raise SystemExit('Unexpected remote Git revision; refusing deployment.')
    if previous != args.sha:
        with tempfile.TemporaryDirectory(prefix='bark-release-') as temporary:
            directory = Path(temporary)
            private_directory(directory)
            bundle = directory / 'release.bundle'
            revisions = ['HEAD']
            known = subprocess.run(['git', '-C', str(ROOT), 'cat-file', '-e', previous + '^{commit}'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if known.returncode == 0:
                revisions.append('^' + previous)
            subprocess.run(['git', '-C', str(ROOT), 'bundle', 'create', str(bundle), *revisions], check=True)
            remote_bundle = f'/var/lib/bark/release-{args.sha}.bundle'
            with bundle.open('rb') as source:
                ssh(f"sudo sh -c 'umask 077; cat > {remote_bundle}'", stdin=source)
            ssh(f'sudo git -C /opt/bark/app fetch {remote_bundle} HEAD && '
                f'sudo git -C /opt/bark/app checkout --detach {args.sha} && '
                f'sudo rm -- {remote_bundle}')
    ssh(f'{prefix} build {args.sha}')
    ssh(f'{prefix} prepare {args.sha}')
    state = json.loads(ssh(f'{prefix} status', capture_output=True, text=True).stdout)
    pending = state['pending']
    path = pending['backup']
    if not re.fullmatch(r'/var/lib/bark/backups/predeploy/\d{4}-\d{2}-\d{2}T\d{6}Z\.dump', path):
        raise SystemExit('Unexpected backup path; refusing download')
    destination = Path.home() / '.bark-backups' / Path(path).stem
    destination.mkdir(parents=True, mode=0o700)
    private_directory(destination)
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
