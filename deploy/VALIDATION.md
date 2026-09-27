# Validation record — September 26, 2026

## Live Oracle deployment

Serving **https://bark.164-152-22-118.sslip.io** from Chicago A1 Flex,
2 OCPUs, 12 GB RAM and a 100 GB boot volume. The deployed application release is
`bc73085517aa42fa28e54715b1a8534ff5aff7a7`, pushed to `codex/hosting-release`.
Subsequent concurrent local application edits are not included in this release.

Verified on the actual ARM64 VM:

- All four application images built successfully and report `arm64`.
- 204 Django tests and 59 WebSocket tests passed against disposable PostgreSQL 17
  and Redis. Their separate Compose volumes were removed afterward.
- Seven production services run; web, API, WebSocket, gateway, PostgreSQL and Redis
  health checks pass. Only Caddy publishes application ports, TCP 80 and 443.
- Let's Encrypt issued the hostname certificate. Public HTTPS, API readiness and
  collected Django admin CSS return 200. SSH ingress is restricted to the configured
  administrator IPv4 /32. The UFW rules survived reboot.
- Browser signup, secure/HttpOnly auth cookies, secure CSRF cookies, autosave,
  offline retry, two-tab conflict handling, game reopening, playback and logout pass.
- Two browser contexts passed socket locking, durable edits, deduplication, replay
  and membership revocation. Shared Python/assets import and offline reconnect pass.
  A separate live editor reconnected after an actual WebSocket container restart,
  then saved a new name that was verified through the API.
- Anonymous sandboxed Python playback ran through the public hostname. Its worker
  could not access account APIs, parent DOM or parent storage. Recovery links/forms
  are hidden, signup displays the notice, all three recovery POSTs return 503,
  the demo inbox returns 404, and the demo-email table remains empty.
- The saved acceptance game was published through the editor UI, opened and played
  as an anonymous visitor in the sandbox, then unpublished through the UI.
  The broader publishing scenario also passed discovery, gameplay, pause/resume,
  fullscreen, mobile/tablet layout, live public updates and unpublishing.
- Forged X-Forwarded-For addresses did not bypass the public login rate limit.
- Stopping Redis caused WebSocket readiness to return 503 and the API readiness
  probe to fail. The monitor published outage and recovery notifications via OCI.
- The VM was rebooted. Services, timers and HTTPS returned, and the saved acceptance
  game reopened and started playing afterward.
- A populated compressed backup was uploaded to the private bucket, downloaded
  again and checksum verified. It restored into a new database and then into a
  disposable stack; Chrome logged in, reopened the saved game and started playback
  through an SSH tunnel. That stack and its volumes were removed afterward.

Nightly backups keep seven daily copies plus two predeployment copies, capped at
9 GiB in the dedicated private bucket. The nightly and five-minute monitoring
timers are enabled. A pre-migration backup plus production secrets are saved with
user/SYSTEM-only ACLs under `~/.bark-backups/2026-09-27T011656Z/` on the administrator's
computer; a populated backup and test-account fixture are in its private `acceptance/`
directory. Secrets are not in Git. Container logs rotate and unattended Ubuntu
security updates are enabled. Approximately 89 GiB remained free before final QA.

The notification topic is isolated in `bark-alerts`; the instance can only publish
there. Oracle accepted test/outage/recovery messages and the email subscription is
ACTIVE. Inbox receipt was not inspected. Compute heartbeat samples were observed
and the ten-minute missing-heartbeat alarm enabled; a prolonged stopped-VM alarm
test has not been performed. No paid replacement shape or OVH order was used.

### Remaining application acceptance issue

The extended two-editor Blockly drag scenario is **not passing**: after two
simultaneous root-block drags, only one root position change was observed in the
saved document (expected two). Invites, object edits and shared naming had passed
before that assertion. This does not invalidate the separate passing socket,
Python-edit and restart/reconnect checks, but collaborative Blockly editing is not
fully accepted. Investigate the input simulation and application behavior before
claiming that scenario works. Concurrent local collaboration changes were preserved
and have not been deployed.

The public HTTPS test copies added Origin headers to their direct API setup calls;
the original helpers assumed HTTP and otherwise correctly received CSRF 403s.
Initial publishing while the first save was still pending showed the existing
save-before-publish message. Publishing after the saved state passed. A separate
browser run encountered connection timeouts; the final publishing run and dedicated
reboot/restore browser checks succeeded. No TLS validation was disabled.

The earlier sections below are historical, not the current deployment status.

## Return to Oracle

The owner reports that the Oracle account upgrade completed and selected Oracle
again. The VM has not yet been launched. Restore the original ARM64 target and
12 GiB host memory budget, retaining the portable architecture checks and sequential
builds. Eighteen deployment/configuration checks pass with the Oracle settings.
Browser automation is currently unavailable; an official OCI CLI session is being
prepared as an alternative. Account and capacity still require live verification.
No OVH order was submitted. The OVH section below records the earlier attempt.

## OVH transition

The owner subsequently selected OVH VPS-1 at $5.35/month before tax, monthly billing.
Virginia availability and the price were verified through the official US APIs.
An anonymous cart has one Ubuntu 24.04 VPS configured; no order has been submitted.
Account setup is awaiting the owner. See [OVH.md](OVH.md) for remaining launch gates.
The older Oracle-only blocker and authorization statements below describe that
earlier attempt, not the current hosting selection.

The release tool now supports explicit AMD64 and ARM64 targets, checks host and image
architecture, and builds application images sequentially. Runtime memory limits
total 3,136 MiB for the new 4 GiB target. Eighteen deployment/configuration tests pass,
including rejection of a wrong host/image architecture and the aggregate memory
budget. This does not validate runtime memory use or successful container builds.
OCI-backed backups remain a launch blocker on OVH until an appropriate offsite
backup identity or replacement is configured and tested.

## Earlier validation

Completed locally on Windows:

- Django: 204 tests, successful, four PostgreSQL/Redis-specific checks skipped.
  Used `server.test_settings` (SQLite/in-memory cache), not production PostgreSQL.
- WebSocket Python tests: 54 passed, five PostgreSQL-dependent tests skipped.
  Includes failed-database, failed-bus and healthy readiness responses.
- Deployment operation tests: ten passed. Covers migration gating, failed backups,
  private bucket requirements, capacity refusal, seven-day retention, and restoring
  only into a newly created temporary database.
- Production frontend build, including engine/scripting assets and TypeScript: passed.
  Existing dynamic worker-import warning remains; the app supplies a worker factory.
- Chrome against the built production frontend: two hosting tests passed, covering
  frontend readiness, hidden recovery links, signup notice and all recovery pages.
- ESLint on touched frontend files: passed.
- Four resolved Compose checks passed: public ports, private service networks, production
  flags, ARM platform and bounded logs. The disposable-test Compose file also resolves.
- Host bootstrap shell syntax, Python compilation and Git whitespace checks: passed.
- Three live Nginx gateway tests passed using the official Windows 1.30.5 binary,
  loopback addresses standing in for Caddy/direct peers, and an echo upstream.
  Verified trusted client/TLS/Host forwarding, WebSocket upgrade headers, rejection
  of spoofed forwarding headers from a direct peer, and separate per-client auth
  limits. Fixed Nginx header inheritance in the production WebSocket route.
  This is not a Caddy, ARM container, or public-hostname test.

Cloud setup attempted in the existing account's home region, Chicago:

- Created the dedicated `bark-vcn` network and regional `bark-public` subnet.
- Restricted the default SSH ingress rule to the administrator's current IPv4 /32.
- Created `bark-internet`, added the default `0.0.0.0/0` route through it, and added
  only TCP 80 and TCP 443 public web ingress. Verified all three TCP ingress rules.
- Generated a dedicated local SSH key; only its public key was entered into Oracle.
- Prepared Ubuntu 24.04 Minimal ARM64, A1 Flex, 2 OCPUs, 12 GB RAM, 100 GB disk,
  with only the Compute Instance Monitoring agent enabled.
- Confirmed no existing boot/block volumes were listed in the root compartment.
  The console disk estimate showed $4.25/month; the requested disk is within Oracle's
  documented 200 GB home-region Always Free allowance.
- Submitted the VM creation request separately in AD-1, AD-2 and AD-3. Each failed
  with `Out of capacity for shape VM.Standard.A1.Flex`. No VM was launched.
- Oracle and DuckDNS sign-in completed. No DuckDNS hostname has been registered yet.
- After explicit owner approval of Pay As You Go and the Cloud Services Agreement,
  submitted the account upgrade. Oracle confirmed successful submission and reports
  that the upgrade is in progress, with email confirmation to follow. This is not
  yet evidence that the account conversion has completed. An AD-3 VM retry while
  processing still returned an out-of-capacity error. No VM has launched.

Not performed:

- ARM64 image builds or running PostgreSQL/Redis/container tests. Docker's Linux engine
  is unavailable; WSL reports `REGDB_E_CLASSNOTREG` and Docker Desktop startup timed out.
- Successful VM provisioning, DuckDNS registration, certificate issuance, public HTTPS,
  external IP/rate-limit checks, live collaboration, cloud backup upload/download,
  VM reboot and a real database restore/browser reopening. Free ARM capacity in
  Chicago and the pending account upgrade are the current deployment blockers.
  The owner authorized Pay As You Go; the prepared VM still targets included free
  resources. No larger or separately priced replacement VM has been authorized.

Release preparation includes the completed account/autosave/collaboration and public
publishing work together with the production configuration. The other application
tasks were idle when this release was reconciled. Credential-pattern scanning found
no private keys or recognized provider tokens in tracked/candidate source; local
environment files, databases, caches and the SSH private key remain outside Git.
Use the resulting full commit SHA as the candidate release. It is not approved for
launch until the unperformed checks above pass.

These are launch gates, not implied passes. Follow README.md on the allocated free VM.
