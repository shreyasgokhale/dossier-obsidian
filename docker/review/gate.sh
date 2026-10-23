#!/bin/bash
set -euo pipefail
export XTABLES_LOCKFILE=/tmp/xtables.lock
# Everything uses this private namespace's loopback. Block Docker's DNS proxy
# too: accepting the entire 127/8 range would permit external DNS queries.
for firewall in iptables ip6tables; do
  "$firewall" -P INPUT DROP
  "$firewall" -P FORWARD DROP
  "$firewall" -P OUTPUT DROP
  "$firewall" -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  "$firewall" -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  if [ "$firewall" = iptables ]; then loopback=127.0.0.1/32; else loopback=::1/128; fi
  "$firewall" -A INPUT -i lo -s "$loopback" -d "$loopback" -j ACCEPT
  "$firewall" -A OUTPUT -o lo -s "$loopback" -d "$loopback" -j ACCEPT
  "$firewall" -A INPUT -p tcp --dport 3000 -j ACCEPT
  "$firewall" -A OUTPUT -j REJECT
  "$firewall" -A INPUT -j REJECT
  "$firewall" -S
done
touch /tmp/firewall-ready
# PID 1 no longer has root privileges or any effective/bounding capabilities.
exec setpriv --reuid=1000 --regid=1000 --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs sleep infinity
