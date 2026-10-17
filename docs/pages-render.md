# Cloudflare Pages + optional Render

This replaces the first-release hosted provider path; it does not remove retained Generic SSH/OpenTofu code or claim those providers as first-release requirements. Node 24.21.0; built-in modules only. No resources have been created by these tests.

`src/pages-render.mjs` exports `executeHosted(request, {fetch, tokens, runtime})`, `inspectStaticBundle`, `listRenderResources`, `createFreePostgres`, and `createFreeService`. `fetch` defaults to the native fetch implementation and is injectable for deterministic HTTP tests. Tokens and optional Render `runtime.envVars` exist only in caller memory: no credential lookup, disk write, subprocess, logging, environment variable, redirect following or deletion is performed here. Errors contain fixed local codes; provider response bodies are never forwarded.

## Manager wire

`request.provider` is `cloudflare` or `render`.

| Action | Request | Safe result |
|---|---|---|
| `accounts` | provider | `state:ready, accounts:[{id,name}]` (Render owners are workspaces) |
| `deploy-static` | Cloudflare accountId, projectName, sourcePath, optional internal expectedManifestSha256 | projectName, deploymentId, state deploying/ready/failed/uncertain, optional pages.dev URL |
| `status` | Cloudflare accountId, projectName, deploymentId | same deployment projection |
| `services` | Render workspaceId | services/postgres picker arrays of id/name/free and optional actual expiry |
| `deploy-api` | Render workspaceId, projectName; native-injected runtime below | state deploying, postgresId, optional expiresAt/serviceId/onrender.com URL |
| `status` | Render workspaceId, optional serviceId/postgresId | state needs-configuration/deploying/deployed/failed, IDs, databaseState and actual expiry |

Static-only publishing needs no Render token, workspace, database or service parameters. `staticOnly:true` refuses Render operations. A Render deployment status of `deployed` means Render reports its latest deploy `live`; it does **not** assert the application's authentication, persistence, publication or recovery checks passed. The Manager must present these distinctions.

Cloudflare `uncertain` includes `deploymentId:pending-<40hex>` identifying the content commit. Pass it to `status`, which only queries existing deployments to reconcile. Do not resubmit creation automatically after an uncertain operation. Render uncertain creates perform one deterministic owner/name reconciliation and otherwise report `HOSTED_RESULT_UNCERTAIN`. Call `services` to observe resources before any user-directed continuation; do not blindly retry a POST. Existing resources with a paid plan or conflicting identity are refused, never modified, upgraded or deleted.

## Static artifact and actual Direct Upload

Only the exporter artifact `static-export-manifest.json` with format `exhibitos-static-publication-v1` is accepted. Its exact inventory binds every file by bytes and SHA256, and `indexSha256` binds `static-publication-index.json` and the HTML meta marker. Published publication ID/revision are checked. Extra files, symlinks, hardlinks, Workers/functions and special routing/header files are refused. The native exporter should pin its stdout `manifestSha256` internally as `expectedManifestSha256`; a file manifest alone establishes structure/integrity, not independent authorship or server authorization. Arbitrary folders without this artifact are refused. Original/private app storage must never be supplied as a source.

Pages limits applied here are 20,000 total artifact files (including the local receipt) and 25MiB per published file. Files are read one at a time; one asset is uploaded per request to keep memory bounded. The local export manifest itself is not published.

The real REST sequence is project lookup/create, project upload-token, assets/check-missing, missing assets/upload, assets/upsert-hashes, and multipart deployment creation with the manifest. Pages asset keys exactly follow Wrangler's BLAKE3(base64(file bytes) + extension without dot), first 32 hexadecimal characters. The unkeyed implementation is used only for provider content addressing and checked against 14 upstream vectors spanning block/chunk/tree boundaries. It is not a credential or signature scheme. JWTs stay in memory and are used solely with the fixed Cloudflare API origin. Asset uploads are not a deployment success; status polls the deployment's actual latest stage.

Required token access: Cloudflare account listing and Pages edit access to the selected account/project. No global API key, DNS mutation, Workers or Git integration is used. API permission/plan rejection is reported rather than worked around.

## Optional free Render runtime

The built-in source is the official `https://github.com/ExhibitOS/platform` main branch. Web services use native Node, explicit `plan:free`, one instance, no disk/autoscaling, `autoDeployTrigger:off`, `npm ci && npm run build`, `node scripts/render-runtime.mjs`, and `/health`. A missing plan would default to a paid plan in the Render API, so it is never omitted. Existing service reuse checks owner/name/free plan/source and the requested durable environment values; no arbitrary foreign service configuration is adopted or changed.

The native caller must persist and inject `CLIENT_ORIGIN` (Pages origin), `TENANT_ID`, `ADMIN_SUBJECT`, `ADMIN_PASSWORD`, and `FREEZE_SIGNING_KEY_BASE64` through memory-only `runtime.envVars:[{key,value}]`. These are not renderer fields. Render's own external origin is available to the runtime. The adapter refuses creation before this configuration is present. Root runtime integration must verify that configuration, signing identity, published blobs and authentication actually survive restarts; service creation alone is not evidence of those properties.

The adapter creates or locates a deterministic `<projectName>-db` free PostgreSQL 18 instance in Frankfurt, with high availability and disk autoscaling disabled and no external IP allowlist entries. It does not silently fall back to paid plans. While the database is creating, it returns its ID and actual API expiry and waits for a later explicit continuation. When available, it obtains `internalConnectionString` in memory and injects `DATABASE_URL` solely into the service creation request. Connection information never enters the returned receipt. PostgreSQL18 is an API-supported version matching the project's existing database line; this source implementation does not certify a real migration or recovery on Render.

Free Render Postgres expires 30 days after creation. Only the API's actual `expiresAt` is projected; a missing field is not replaced with an invented date. Free service spin-down and ephemeral filesystem limitations remain. This is an explicitly limited free environment, not a permanent preservation guarantee. No paid disk, object store or new cloud account is provisioned. Durable state/blob/signing/restore validation and actual API deployment remain unexecuted until the native credential flow and user-selected publication are available.

## Validation and sources

`node --test tests/pages-render.test.mjs` covers actual HTTP method/path/body shapes with injected fetch; artifact tamper/substitution, redirects/secret-free errors, content-addressing vectors, unknown-result reconciliation, free-only create and metadata filtering. Mock passes are not real Cloudflare or Render deployment evidence.

Official sources checked 2026-10-17:

- [Cloudflare Pages deployment API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/create/)
- [Wrangler Pages asset upload source](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/pages/upload.ts)
- [Wrangler asset hash source](https://github.com/cloudflare/workers-sdk/blob/main/packages/deploy-helpers/src/deploy/helpers/hash.ts)
- [BLAKE3 specification](https://github.com/BLAKE3-team/BLAKE3-specs/blob/master/blake3.pdf) and [official test vectors](https://github.com/BLAKE3-team/BLAKE3/blob/master/test_vectors/test_vectors.json)
- [Render OpenAPI source](https://api-docs.render.com/openapi/render-public-api-1.json), [workspace API](https://api-docs.render.com/reference/list-owners), [service creation](https://api-docs.render.com/reference/create-service), [Postgres creation](https://api-docs.render.com/reference/create-postgres)
- [Render free environment limitations](https://render.com/docs/free)
