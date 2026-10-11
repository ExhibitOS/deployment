# Generic SSH lifecycle adapter

This source adapter implements a restricted public OED deployment plan and Manager lifecycle entry point. It does not claim a qualified Linux remote deployment or completed T10-02. The T10-01 Linux bundle and prepared remote runtime remain prerequisites; it does not upload artifacts, install an engine, provision a host, or create credentials.

## Prepared inputs

Use Node 24.21.0 on a Unix client with `/usr/bin/ssh`. The remote supported subset is an unprivileged account on Ubuntu 22.04 or 24.04, Node 24.21.0, a local Unix Docker endpoint, and already-present digest-pinned images. Place the approved executable Manager and private prepared bundle/runtime under the account's protected home. The bundle must match the existing two-service self-host packaging contract exactly, including loopback port 13200, database and object/configuration volumes, image identities, labels and protocol. The wrapper does not substitute an unrelated bundle for an OED plan.

The OED selects an SSH private-key secret and database password secret through environment references or macOS Keychain references. Supply secret values through those providers, never the OED or command arguments. The database password must already match the prepared private `runtime.env` password and database URL. The wrapper resolves this credential transiently and compares its digest remotely; no credential value enters receipts. The SSH identity is written only into an owned temporary 0700 directory as an exclusive 0600 file, then removed after transport completion.

Create a private 0600 JSON connection file with exactly `consent`, `connection`, and `oed`. The connection has exactly `remoteRoot`, `managerPath`, `managerSha256`, `knownHostsPath`, `knownHostsSha256`, and `httpsOrigin`. Paths are absolute. Independently verify the server's host-key fingerprint before creating the dedicated canonical known-hosts file; do not accept an unverified scan. The client pins this file's approved SHA and checks identity before and after SSH. OpenSSH reads an exclusive 0600 copy of the verified bytes inside the owned temporary directory, so replacement of the original path during transport cannot select a different host-key file. Its path cannot contain whitespace, quotes, backslash or `%` expansion tokens. Manager SHA approval must come from the trusted release channel.

## Commands

Run `node bin/generic-ssh.mjs <command> /absolute/private/connection.json`.

- `plan` checks OS, protected paths, exact bundle and runtime binding, local engine and observed firewall policy. It makes no deployment changes. Its public receipt omits secrets and raw paths.
- `install`, `start`, `stop`, and `restart` obtain a fresh plan, bind unchanged remote input bytes and delegate to the existing Manager. Mutating commands require `consent: true`; volumes are preserved and installation uses only existing images. Repeating install for the identical already-installed bundle returns an idempotent result.
- `status` reports bounded Manager state and readiness; `logs` returns only up to 50 safe timestamp/code records, without raw messages or process output.
- `retry` delegates the last qualified failed/interrupted install/start/stop/restart job to the Manager's existing retry command. SSH interruption is uncertain and does not automatically replay an action.
- `verify` checks that manual DNS resolves to the SSH target and observes certificate-valid HTTPS readiness using the existing application protocol. DNS delay, TLS failure and unavailable health remain failures. Configure DNS and the HTTPS reverse proxy separately; this adapter does not rewrite DNS or TLS configuration.
- `rollback` refuses with `SSH_ROLLBACK_RESTORE_REQUIRED`. Full restoration/activation is not implemented here. An image-only reversal is not a qualified rollback.

An observed UFW default-deny policy is reported separately as `firewallPolicyObserved`; `firewallVerified` remains false. A successful endpoint observation does not establish firewall, deployment, rollback or recovery completion.

## Current verification scope

Nine source regression cases cover plan authority, consent, input refusal, binding and safe Manager commands, simulated host-key/transport faults, simulated DNS/TLS/readiness outcomes, and rollback refusal. They compile the actual generated remote script and execute its unsupported-OS refusal on the actual Mac before it reads remote inputs or invokes Docker. The transport and endpoint success cases use test doubles. No actual SSH connection or private key was used.

The existing T10-02 acceptance is unchanged: isolated Linux/VPS deployment twice, real host-key mismatch/interruption, DNS delay, TLS/firewall/health validation and rollback still need real qualification. These unit results are not evidence that those checks passed.
