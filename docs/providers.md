# OpenTofu reference provider

The AWS EC2 reference provisions one host suitable for the existing Generic SSH OCI/compose Platform + PostgreSQL path. Cloudflare Workers cannot run that host runtime, so this adapter does not repurpose exhibitos.org, its DNS or its website. Unsupported providers retain [Generic SSH](generic-ssh.md). No AWS/GCP/Azure umbrella support is claimed.

The local module uses the explicit official `registry.terraform.io/hashicorp/aws` provider address (avoiding an implicit registry selection) and pins [OpenTofu 1.12.0](https://github.com/opentofu/opentofu/releases/tag/v1.12.0) and [hashicorp/aws 6.42.0](https://github.com/hashicorp/terraform-provider-aws/blob/v6.42.0/website/docs/r/instance.html.markdown). AMI, subnet, existing security groups and SSH public-key registration are explicit operator inputs; there is no latest-image lookup, network/DNS creation or embedded secret/user-data. IMDSv2 and encrypted root disk are set. Bootstrap/install, authenticated current readiness, backup and rollback remain the separate Manager/Generic SSH lifecycle; a present VM never means the exhibition is ready.

## Secret-free local dry-run

A configuration JSON contains `target` with exactly `provider:"aws"`, twelve-digit `account_id`, `region`, isolated `project`, pinned `ami_id`, `instance_type` (`t3.small` or `t3.medium`), `subnet_id`, `security_group_ids`, existing `key_name` and `root_gib` (20–64). Optional `cost` has integer KRW estimates `compute`, `storage`, `network`, `ipv4`. No credential is accepted in JSON.

```
node bin/provider.mjs dry-run /absolute/private/config.json
```

Unknown components yield unknown total. Supplied estimates are explicitly unenforced, never a free-tier guarantee or a monthly charge cap. Initial authorized new spend remains **0 KRW**; all project spending also remains under the user's overall monthly limit. No resources are created by dry-run or the unit mocks.

## Prepared OpenTofu plan/status

Add canonical private `workspace`, `binary` (owner-only verified OpenTofu executable) and independently verified release `binarySha256`. `prepare` accepts an empty owner-only directory and writes the three exact pinned module files plus non-secret variables. It performs no download, API or apply. Keep all plan/state/lock files private; [OpenTofu JSON show](https://opentofu.org/docs/cli/commands/show/) may contain sensitive values and is projected before any output.

An operator must separately authorize and verify provider acquisition, create and retain the upstream checksum lock, and initialize this private workspace (`tofu init -input=false`; thereafter `tofu init -lockfile=readonly`). These steps have **not** been executed here. Supply temporary AWS session credentials through the environment/credential provider only: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`. Existing OS keychain or OIDC/STSes exchange can supply them without putting values in descriptors. This implementation does not claim its own OIDC issuer/exchange.

`plan` runs saved `tofu plan` and projects only allowed resource addresses/actions, costs and file hashes. `status` projects instance identity/presence without credentials or runtime-health claims. Commands have bounded output/deadline; raw provider diagnostics and state JSON are never forwarded. The exact module, variable, lock, state, executable/version and saved-plan hashes are rechecked before mutation. Plans are one-use in-memory authorities; exported receipt JSON cannot authorize apply. To consume a plan, use the same `OpenTofuProvider` instance.

## Apply and destroy boundary

The native interface implements `plan`, `apply`, `status`, `destroy`. Actual apply requires explicit change consent and a fresh injected **observed** authorized isolated-account cost guard bound to account, region, project and exact plan SHA, with verified maximum new monthly spend zero and unexpired observation. A supplied estimate or free-tier label cannot fulfill it. The shipped CLI cannot establish this observation and refuses `apply`/`destroy` with `PROVIDER_INITIAL_ZERO_COST_UNVERIFIED`; the default native cost guard also refuses. Mock observations in unit tests authorize only mock execution, not AWS. Missing isolated account/temporary credentials/enforceable zero-cost observation are the exact remaining external apply/cleanup condition, not a passed cloud deployment.

Destroy uses a fresh saved `-destroy` plan and the same gates. Every planned delete, including replacement during ordinary apply, also requires explicit verified-restoration acknowledgement. The EC2 root disk is deleted on termination: first stop external writers, retain and independently restore the full original Manager database/blob/configuration backup, inspect the exact isolated instance plan, and then authorize destroy. Preserve the state, plan and receipts until provider status observes absence. Destruction of runtime data or other resources is not automatically authorized; no cleanup was run here. Stop/termination alone cannot promise zero charges or complete backup deletion.

Mock conformance: `node --test tests/provider-adapter.test.mjs`. These tests exercise actual wrapper commands through a bounded synthetic runner, refusal before mutation, source/plan drift and redacted receipts. OpenTofu/provider native validation and approved isolated account apply/cleanup remain separately unexecuted until admitted. Future adapters must implement the same projected plan/status, credential, cost and restore boundaries; adding a provider is a distinct implementation, not inferred support.
