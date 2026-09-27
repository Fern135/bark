# Bark on Oracle Always Free

**Active deployment target: Oracle.** The owner reports that the account upgrade
has completed and selected Oracle again. Reuse the existing Chicago network,
backup bucket and notification topic. The OVH cart was never submitted.
The production hostname is `www.barkcade.club`, pointing to `164.152.22.118`.
The initial deployment used `bark.164-152-22-118.sslip.io`.

This deploys the existing app on one Ubuntu 24.04 ARM64 VM (2 OCPUs, 12 GB RAM,
100 GB boot disk). PostgreSQL 17 stores accounts, projects, embedded assets and
collaboration state. Redis is disposable. Caddy serves HTTPS on the configured name;
Nginx retains the app's routing and rate limits. Game execution stays in the browser.

Only `docker-compose.prod.yml` is used in production. Do **not** combine it with
the default or development Compose files. No public database, Redis, API or socket ports.
Production account recovery is deliberately disabled, including direct API requests.

## 1. Allocate only free resources

1. Create an Oracle Free Tier account (identity/card verification is done by the owner).
   Choose US East / Ashburn as the home region for a new account; use an existing
   tenancy's home region instead. Check existing resource usage before allocating.
2. Create a dedicated `bark` compartment, VCN, public subnet, internet gateway and
   default internet route. Create one **Always Free eligible** Ubuntu 24.04 image
   on **VM.Standard.A1.Flex**, exactly **2 OCPUs / 12 GB / 100 GB boot disk**.
   Use standard included storage performance, a public IPv4 and your SSH public key.
   Do not enable paid monitoring, load balancers, NAT gateways or extra volume backups.
   If free capacity is unavailable, stop and retry later or another availability
   domain in the same home region. Account upgrades require owner approval; never
   silently substitute a paid shape. This account's owner approved Pay As You Go,
   but the requested VM still targets included Always Free resources.
3. Remove broad default ingress. In the subnet security list/NSG allow TCP 80/443
   from the internet, TCP 22 only from your administrator IPv4 `/32`, plus necessary
   ICMP path-MTU messages. Keep SSH key login only. Leave normal egress enabled for
   certificate renewal, package downloads and host-side OCI backups.
4. Create a **private Standard Object Storage bucket**, e.g. `bark-backups`, with
   versioning disabled, in the same compartment/region. Do not store other data there.
   The backup script caps this bucket at 9 GiB. Keep any OTHER tenancy storage within
   the remaining free allowance; the script cannot enforce account-wide billing.
5. Create an OCI Notifications topic and an email subscription; confirm its email.
   This is for hosting alerts, not application recovery emails.
6. Create dynamic group `bark-vm` matching only this VM:

   ```text
   ALL {instance.id = 'YOUR_INSTANCE_OCID'}
   ```

   Add compartment-scoped policies (substitute your bucket/topic IDs):

   ```text
   Allow dynamic-group bark-vm to read buckets in compartment bark where target.bucket.name = 'bark-backups'
   Allow dynamic-group bark-vm to manage objects in compartment bark where target.bucket.name = 'bark-backups'
   Allow dynamic-group bark-vm to {ONS_TOPIC_PUBLISH} in compartment bark-alerts
   ```

   Put the hosting notification topic in a dedicated `bark-alerts` compartment.
   Notifications supports general IAM variables, not `target.topic.id`; isolate
   the topic by compartment and grant only message publication there. The VM uses
   instance principals, so no OCI API key is copied into the app.
7. Point a custom domain's A record to the VM's public IPv4 (for this deployment,
   `www.barkcade.club` → `164.152.22.118`). Alternatively, register an available
   name on DuckDNS and point it to the VM's IPv4. Update it
   when replacing the VM. Never commit the DuckDNS token. Confirm public DNS before
   starting Caddy. `bark-yourname.duckdns.org` below is an example, not a reserved name.
   Alternatively use `bark.DASH-SEPARATED-PUBLIC-IP.sslip.io`, which resolves to the
   embedded public IPv4 without registration. A replacement VM with a different IP
   requires a new hostname and exact host/origin settings, so existing links change.

Oracle currently documents 2 OCPUs/12 GB and 200 GB combined boot/block storage for
Always Free; availability and idle reclamation apply. Check the Console's eligibility,
existing usage and cost estimate before creating anything, including after an approved
Pay As You Go upgrade. That upgrade is usage billing, not a flat $5 plan. Budget
alerts are notifications, not spending caps.

The Chicago network and backup bucket are in the root compartment. Their bucket
policies use `in tenancy` with the exact bucket-name condition. The notification
topic is in `bark-alerts`, with publish-only permission scoped to that compartment.
The dynamic group matches only the production instance.

Sources: [Oracle free limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm),
[instance principals](https://docs.oracle.com/en-us/iaas/Content/Identity/Tasks/callingservicesfrominstances.htm),
[Notifications IAM](https://docs.oracle.com/en-us/iaas/Content/Identity/policyreference/notificationpolicyreference.htm),
[DuckDNS](https://www.duckdns.org/about.jsp),
[automatic DNS and TLS](https://sslip.io/),
[Caddy HTTPS](https://caddyserver.com/docs/automatic-https).

## 2. Initialize the VM

Merge/review the intended application work and push one release commit first.
Deployment refuses dirty checkouts and never commits or discards someone else's work.
Use the existing repository. If it is private, transfer an initial Git bundle over
SSH instead of adding GitHub credentials to the VM. The deployment wrapper transfers
subsequent releases as Git bundles and requires the local release to be clean and pushed.

```bash
sudo mkdir -p /opt/bark
sudo git clone https://github.com/Fern135/bark.git /opt/bark/app
sudo git -C /opt/bark/app checkout --detach FULL_RELEASE_SHA
cd /opt/bark/app
sudo bash deploy/bootstrap.sh YOUR_ADMIN_IPV4/32
sudo python3 deploy/bark.py init \
  --domain bark-yourname.duckdns.org --email YOUR_CERTIFICATE_CONTACT_EMAIL \
  --region us-ashburn-1 --namespace YOUR_OBJECT_STORAGE_NAMESPACE \
  --bucket bark-backups --topic YOUR_TOPIC_OCID
```

`init` generates independent random PostgreSQL/Django/JWT secrets, writes them with
mode 0600 to `/etc/bark/production.env`, and refuses to overwrite that file. Keep a
private off-machine copy. Do not put this file in the repository. All operators need
SSH plus sudo; do not expose Docker's socket/API to the internet.

`SITE_DOMAIN` in `/etc/bark/production.env` is the single source for the HTTPS
hostname, Django allowed hosts and CSRF/CORS origins, frontend URL, and WebSocket
allowed origins. To change domains, verify public DNS first, preserve a private
copy of the existing environment file, update only `SITE_DOMAIN`, and recreate
the production containers with the active release SHA. Caddy obtains the new
certificate automatically. Verify HTTPS, login, and WebSocket connections on the
new hostname. Cookies and local browser settings belong to each hostname, so
users must sign in again after moving domains.

For Byte coding hints, add `OPENAI_API_KEY` to `/etc/bark/production.env` using a
private editor; keep its existing 0600 permissions. Optional settings are
`BYTE_HINTS_ENABLED=1` and `OPENAI_MODEL=gpt-5.4-mini-2026-03-17`. Recreate the Django
`server` container after changing these settings. The key is injected only into
Django in production. Django joins a separate `coach_egress` network for outbound
HTTPS; no additional ports are published, and web/ws/database/Redis stay internal.
An absent key or `BYTE_HINTS_ENABLED=0` disables reviews without affecting editing
or readiness. The Redis budget admits one review per account per 45 seconds across
workers/tabs. Provider failures back off without an editor popup. Logs contain
latency, token counts and error categories, never submitted source or credentials.

`bootstrap.sh` installs Docker Engine/Compose from Docker's Ubuntu repository, the
OCI CLI, automatic Ubuntu security updates, and a host firewall. It is intended for
a **fresh** VM. On the recognized OCI image it removes the legacy inbound SSH
accept/reject rules after UFW is active, preserving Oracle metadata/storage rules
and saving the original configuration. Check OCI and host firewall rules together:
ports 80/443 must actually reach Caddy. Docker-published ports can bypass UFW, so the
cloud ingress rules and the Compose port list remain authoritative. Automatic
security reboots are disabled; schedule reboots explicitly.

## 3. Deploy from your computer

From a checkout containing these scripts, use Python 3.11+ and working SSH/sudo:

```powershell
py deploy/remote.py ubuntu@YOUR_VM_IP FULL_40_CHARACTER_RELEASE_SHA
```

The wrapper verifies the pushed SHA locally, transfers missing Git objects over SSH,
checks out that SHA on the VM, and builds the four app images natively
for ARM64, starts PostgreSQL/Redis, stops public traffic and all app writers, uploads
a compressed PostgreSQL backup, then copies that backup and production settings into
`~/.bark-backups/` on **your computer**. It verifies the downloaded SHA256 before
running migrations once, collecting admin static files, starting healthy containers,
and testing public HTTPS. Treat local copies as secrets; use an encrypted disk and
private user-only permissions. The wrapper applies a user/SYSTEM-only Windows ACL
before writing backup contents and production secrets.

Images are tagged `bark-web:SHA`, `bark-server:SHA`, `bark-ws:SHA`, `bark-proxy:SHA`.
Current/previous/pending releases are recorded in `/var/lib/bark/release.json`.
No automatic image pruning runs; retain the current and previous release and inspect
disk usage before removing older images. Base images are version-tagged, so a later
rebuild can include upstream patch updates; retain the built images for exact rollback.

If a deploy fails, it stays pending and never automatically restores the database.
Inspect `sudo python3 /opt/bark/app/deploy/bark.py status` and container logs. A failed
backup means **do not migrate**. A failed migration/startup means diagnose while traffic
remains stopped or explicitly stop it again. After correcting the failure, copy and
verify the pending backup and call `activate SHA --copied-backup-sha256 HASH` to resume.
If prepare failed before recording a backup, rerun `prepare SHA` after fixing the
failure; it permits retrying that same pending release. Do not bypass the checksum gate.

## 4. Backups, alerts and maintenance

After the first successful deployment:

```bash
cd /opt/bark/app
sudo python3 deploy/bark.py test-alert
sudo python3 deploy/bark.py backup
sudo install -m 0644 deploy/systemd/bark-* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bark-backup.timer bark-monitor.timer
sudo python3 deploy/bark.py monitor
```

Confirm the alert reached your subscribed inbox. Nightly backups use `pg_dump -Fc`
(compressed) and keep seven UTC daily copies plus two predeploy copies. Retention
deletes only matching backup names after a successful upload. Uploads that would
exceed 9 GiB fail without deleting the last good backups. OCI encrypts bucket objects
at rest; access stays private. The local state/backup directories are root-only.

The monitor checks container health, public API HTTPS, free disk, backup age and
bucket capacity every five minutes. Changed incidents and recovery publish to OCI;
normal unchanged results stay quiet. Logs rotate at 3 × 10 MB per container. Inspect
`journalctl -u bark-backup -u bark-monitor` for operational failures. A stopped VM
cannot alert about itself: configure OCI Monitoring's **absent compute heartbeat**
alarm to this same topic and test it by a controlled VM stop. Use only included
Monitoring/Notifications quotas; do not add paid SMS delivery.

## 5. Restore and rollback

First prove a downloaded backup restores into a new database:

```bash
sudo python3 /opt/bark/app/deploy/bark.py restore-check /path/to/downloaded/database.dump
```

This restores into a randomly named `bark_restore_*` database, checks Django/schema
access and saved-game counts, then drops **only that temporary database**. It does
not prove browser playback; that is a separate acceptance check below.

For VM loss: allocate the same free shape, bootstrap, clone/check out the recorded
release, securely restore `production.env`, point DuckDNS to the replacement IP, and
build that release. Start only db/redis. Restore the downloaded dump into the **fresh,
empty** `bark` database using `pg_restore -U bark -d bark --no-owner --no-acl --exit-on-error`.
Never restore over a live database. Run the normal prepare/copy/activate flow; it
backs up the restored state before applying any outstanding migrations. Re-enable
timers, test alerts, and run all browser acceptance checks. Keep the old disk/bucket
until recovery has been verified.

For application rollback: inspect the migrations between the active and previous
SHA. If the previous app supports the current schema, check out that SHA and run the
normal backup/deployment flow using the retained image (or rebuild explicitly).
If it does not, plan an outage and explicitly approve losing changes newer than the
predeploy backup before restoring that backup into a fresh database volume. The
tooling deliberately has no `restore-production` or destructive automatic rollback.

## 6. Acceptance and local checks

Local checks that do not need Docker:

```powershell
py -m unittest discover -s deploy -p 'test_*.py' -v
python server/manage.py test server authenticator canvas marketplace --settings=server.test_settings --noinput
python -m pytest ws/tests -q
cd web
$env:NEXT_PUBLIC_ACCOUNT_RECOVERY_ENABLED='0'
npm run build
npx playwright test --config playwright.hosting.config.ts
```

For native gateway checks, set `BARK_TEST_NGINX` to an installed Nginx executable
before running the deployment tests. These use isolated loopback listeners and an
echo upstream to check forwarding-header trust and per-client rate limits. They do
not replace testing Caddy, WebSocket sessions, or the production ARM image.

SQLite/LocalBus checks do not validate PostgreSQL row locking or Redis fan-out.
For those, make a **separate disposable checkout**, generate a private `.env` from
`.env.example`, set `APP_PORT=18080`, and change every localhost:8080 origin to
localhost:18080. Use a distinct project name; do not point it at production data:

```bash
docker compose -p bark-check -f docker-compose.yml -f deploy/compose.test.yml up -d --build --scale ws=2
docker compose -p bark-check -f docker-compose.yml -f deploy/compose.test.yml build tester
docker compose -p bark-check -f docker-compose.yml -f deploy/compose.test.yml run --rm tester
docker compose -p bark-check -f docker-compose.yml -f deploy/compose.test.yml run --rm -w /ws tester python -m pytest tests -q
# On a computer with Node dependencies and Chrome installed:
BARK_INTEGRATION_URL=http://localhost:18080 npm --prefix web run test:integration
# Only after confirming this is the disposable bark-check project:
docker compose -p bark-check -f docker-compose.yml -f deploy/compose.test.yml down --volumes
```

Production release acceptance:

- Verify only 80/443 are public and SSH is restricted. Try spoofed forwarded headers
  through Caddy and directly on the private gateway; they must not change the trusted
  client IP/TLS decision. Check real per-client auth limits with two independent IPs.
- Check HTTPS redirects, secure cookies, admin CSS, signup/login/logout, autosave,
  reopening games, publish/unpublish, and anonymous community playback.
- Check `/runtime/`, `/community-runtime/`, Pyodide, Havok and workers load without
  cross-origin or sandbox errors. Keep the existing iframe CSP unchanged.
- Check two collaborating browsers and reconnect after restarting ws. Verify recovery
  pages have no form, API requests return 503, and demo inbox returns 404.
- Reboot and reopen a saved game. Restore a downloaded backup into the disposable
  stack, then log in and reopen/play that game there. Avoid demo-email-dependent
  integration tests on production; the recovery-disabled tests are separate.

No live deployment, reboot or restore should be called verified until actually run.
