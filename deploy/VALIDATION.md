# Validation record — September 26, 2026

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
