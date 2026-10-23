#!/usr/bin/env python3
"""Inspect only this review project's containers; never mount the Docker socket."""
import json
import pathlib
import subprocess

compose = ["docker", "compose", "--env-file", "/dev/null", "-f", "compose.review.yml", "--profile", "checks", "--profile", "demo"]
ids = subprocess.check_output(compose + ["ps", "--all", "--quiet"], text=True).split()
assert ids, "No review containers exist"
containers = json.loads(subprocess.check_output(["docker", "inspect", *ids], text=True))
report = []
for container in containers:
    service = container["Config"]["Labels"]["com.docker.compose.service"]
    assert container["Config"]["Labels"]["com.docker.compose.project"] == "dossier-isolated-review"
    host = container["HostConfig"]
    assert not host["Privileged"] and not host.get("Devices")
    assert host["NetworkMode"] != "host" and host["PidMode"] != "host" and host["IpcMode"] != "host"
    assert all(mount["Type"] == "volume" for mount in container["Mounts"]), "Host bind mount found"
    ports = host.get("PortBindings") or {}
    if service == "gate":
        assert ports == {"3000/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3200"}]}
        assert container["NetworkSettings"]["Ports"] == ports, "Configured preview port was not actually published"
        status = subprocess.check_output(["docker", "exec", container["Id"], "cat", "/proc/1/status"], text=True)
        for key in ("CapEff", "CapBnd"):
            assert int(next(line.split()[1] for line in status.splitlines() if line.startswith(key + ":")), 16) == 0
    else:
        assert not ports
        if service != "init":
            assert not host.get("CapAdd") and "ALL" in host["CapDrop"]
            assert container["Config"]["User"] in ("1000:1000", "70:70")
    report.append({"service": service, "image": container["Image"], "mounts": container["Mounts"], "network": host["NetworkMode"], "ports": ports, "capDrop": host["CapDrop"], "privileged": host["Privileged"]})
output = pathlib.Path("work/isolated-review")
output.mkdir(parents=True, exist_ok=True)
(output / "container-isolation.json").write_text(json.dumps(report, indent=2) + "\n")
print("PASS: only named volumes, no privileged containers or host namespaces, zero workload capabilities, localhost-only preview port.")
