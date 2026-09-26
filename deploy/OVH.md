# Bark on OVH VPS-1

**Inactive option:** the owner switched back to Oracle after its account upgrade
completed. No OVH order was submitted. Use README.md for the active deployment;
the lower memory limits described below apply only to the earlier OVH configuration.

The owner selected the monthly VPS-1 plan: 2 vCPU, 4 GB RAM, 40 GB SSD NVMe,
Ubuntu 24.04, Virginia (`US-EAST-VA`). The official US catalog returned $5.35/month
before tax with no commitment and $0 installation on September 26, 2026.
Do not substitute annual prepayment, paid backup upgrades, or a larger plan.

The official stock API reported Virginia available. An anonymous cart was prepared
with quantity one, `vps-2027-model1`, duration `P1M`, pricing mode `default`, Virginia
and Ubuntu 24.04. This is not an order, payment, account verification or VM allocation.
Cart identifiers are held only in the ignored local hosting cache.

## Host and release preparation

- Use the dedicated Bark SSH public key and restrict SSH to the administrator's
  current IPv4 /32. Expose only TCP 80/443 publicly. Verify an additional SSH session
  before closing the initial connection or disabling password login.
- Run `sudo bash deploy/bootstrap.sh ADMIN_IPV4/32 none` on the new Ubuntu host.
  It detects AMD64 or ARM64 and installs the matching official Docker packages.
- Set `BARK_PLATFORM=linux/amd64` in the root-only production environment. The release
  tool refuses a mismatching Docker host or image architecture. ARM64 remains usable
  with its explicit setting; AMD64 images must be built and tested for this host.
- Production service limits total 3,136 MiB, leaving space for the OS on a 4 GiB VM.
  These are initial beta limits, not a load-test result. Check actual memory usage
  and OOM events during acceptance. Keep two Gunicorn workers.
- Image builds run sequentially. Before building on this host, provision a bounded
  2 GiB swap file if swap is absent, with mode 0600 and an `/etc/fstab` entry. Confirm
  adequate disk space first. Build memory is separate from Compose runtime limits.
- Retain the previous release images and database volumes. On the 40 GB disk, inspect
  build cache and disk use after builds; do not prune volumes or previous images.
- Keep the same DuckDNS/Caddy setup, security headers, static files, private networks,
  disabled recovery, migration gate and browser acceptance checks in README.md.

## Remaining launch gates

OVH account creation/login and checkout are not complete. No OVH VM or public Bark
hostname has been provisioned.

The existing backup implementation uses OCI instance principals. Those identities
do not work on an OVH VM. A private offsite backup destination and alert delivery
must be configured and verified before calling `prepare` or launching publicly.
Do not disable the backup gate or invent OCI values to make deployment proceed.
OVH's included daily VM backup retains only the latest day; it does not replace
seven daily PostgreSQL backups, pre-migration downloads, or a tested restore.

The remaining work is to complete checkout, configure offsite backups and alerts,
build from the reviewed release SHA, run disposable PostgreSQL/Redis tests, then
verify HTTPS, the application flows, two-browser collaboration/reconnect, reboot
persistence and restore/reopening a saved game. Local checks are not evidence that
these cloud checks passed.

Sources: [VPS plans](https://us.ovhcloud.com/vps/),
[official ordering guide](https://support.us.ovhcloud.com/hc/en-us/articles/39499067423379-How-to-order-a-VPS),
[US catalog](https://api.us.ovhcloud.com/1.0/order/catalog/public/vps?ovhSubsidiary=US).
