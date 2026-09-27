#!/usr/bin/env bash
# Run on a fresh Ubuntu VM: sudo bash deploy/bootstrap.sh ADMIN_IPV4/32 [oci|none]
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
test "$(id -u)" = 0 || { echo 'Run with sudo'; exit 1; }
architecture=$(dpkg --print-architecture)
case "$architecture" in arm64|amd64) ;; *) echo 'Requires ARM64 or AMD64 Ubuntu'; exit 1;; esac
cloud_tools=${2:-oci}
case "$cloud_tools" in oci|none) ;; *) echo 'Cloud tools must be oci or none'; exit 1;; esac
admin_cidr=${1:?Pass the administrator public IPv4 address followed by /32}
python3 - "$admin_cidr" <<'PY'
import ipaddress, sys
net = ipaddress.ip_network(sys.argv[1], strict=True)
assert net.version == 4 and net.prefixlen == 32, 'SSH requires one administrator IPv4 /32'
PY
. /etc/os-release
test "$ID" = ubuntu
apt-get update
apt-get install -y ca-certificates curl gnupg git python3-venv unattended-upgrades ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $VERSION_CODENAME
Components: stable
Architectures: $architecture
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
if [ "$cloud_tools" = oci ]; then
  python3 -m venv /opt/bark-oci
  /opt/bark-oci/bin/pip install 'oci-cli==3.94.0'
  ln -sf /opt/bark-oci/bin/oci /usr/local/bin/oci
fi
install -d -m 0700 /etc/bark /var/lib/bark /var/lib/bark/backups
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
cat > /etc/apt/apt.conf.d/52bark-upgrades <<'EOF'
Unattended-Upgrade::Automatic-Reboot "false";
EOF
# Provider firewall rules must enforce the SAME ingress rules. Docker-published ports
# bypass parts of UFW; only Caddy publishes ports in the production Compose file.
ufw default deny incoming
ufw default allow outgoing
ufw allow from "$admin_cidr" to any port 22 proto tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
systemctl enable --now docker
echo 'Host dependencies installed. Follow deploy/README.md for backups, DNS and initialization.'
