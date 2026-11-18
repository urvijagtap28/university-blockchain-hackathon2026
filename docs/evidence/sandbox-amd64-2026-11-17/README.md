# Sandbox probes on amd64, 2026-11-17

Run by Person B (WSL2 Ubuntu x86_64, Docker 29.9.3, linux/amd64) from orchestrator-setup at 6e2fa19, against the verify.py of that commit (sha256 8022c685...). Files here are copies of their output.

- `sandbox_probes_amd64.txt`: flag audit and probes (a) to (j). B's tally: 23 PASS, 2 WARN, 0 FAIL, 0 NOT-POSSIBLE.
- `sandbox_cap_amd64.txt`: wall-clock cap and cleanup test. 8 PASS, 0 FAIL.
- `sandbox_ps_after.txt`: `docker ps -a` afterwards: only two old hello-world containers, no probe-* or verify-* containers.

The 2 WARNs: `/dev/shm` stays a writable 64 MiB in-memory tmpfs (not covered by --read-only; not in spec; we left the flags unchanged); the ARVO image's own build-time env var names are visible (no secrets, nothing from the host).

What this does and does not show:
- It shows the configured limits held on amd64: no network, read-only root, non-root with zero capabilities, pids and memory limits enforced, read-only input mount, no leftover containers.
- The two kill tests (A, C) are INDUCED hangs (`sleep 300` in the hardened container), not collected bugs. A was killed at 3.15 s, C (against the real 60 s verifier cap) at 55.23 s. Test B (real verify.py with a 5.2 s cap) took the "no time left" path before any container started, so it is not a kill test.
- The server's own 60 s cap with the real verifier, concurrency with the real verifier, and an actual escape attempt were NOT tested. The sandbox is not claimed escape-proof.
