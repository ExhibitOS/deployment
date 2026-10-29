# Cloudflare Pages + optional Render

This replaces the first-release hosted provider path; it does not remove retained Generic SSH/OpenTofu code or claim those providers as first-release requirements. Node 24.21.0; built-in modules only. No resources have been created by these tests.

`src/pages-render.mjs` exports `executeHosted(request, {fetch, tokens, runtime})`, `inspectStaticBundle`, `listRenderResources`, `createFreePostgres`, and `createFreeService`. `fetch` defaults to the native fetch implementation and is injectable for deterministic HTTP tests. Tokens and optional Render `runtime.envVars` exist only in caller memory: no credential lookup, disk write, subprocess, logging, environment variable, redirect following or deletion is performed here. HTTP 401 maps to `HOSTED_TOKEN_INVALID` and 403 to `HOSTED_PERMISSION_REQUIRED`; Render personal API keys have the provider's available workspace access rather than invented per-action scopes. Errors contain fixed local codes; provider response bodies are never forwarded.

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

For a new static deployment, a caller may pin `staticCacheProfile: "static-data-sha256-24h-v1"` together with `staticCachePolicySha256`, the SHA-256 of the exact generated control bytes. The adapter rechecks the verified publication index and artifact before any provider request, and emits up to 100 sorted, exact `/data/<lowercase-sha256>.bin` or `.json` rules whose filename matches the indexed and verified content digest. The separate `_headers` control file sets `public, max-age=86400, immutable`; it is never accepted from the artifact or published as an asset. Other files and overflow use the provider defaults. Both values participate in deployment identity and must be persisted for reconciliation; older records without either field retain their original identity. Public bytes cached by clients can remain available for the cache lifetime even after rights or publication change, so this cannot recall previously delivered copies. Actual provider response behavior must be checked separately.

Cloudflare `uncertain` includes `deploymentId:pending-<40hex>` identifying the content commit. Pass it to `status`, which only queries existing deployments to reconcile. Do not resubmit creation automatically after an uncertain operation. Render uncertain creates perform one deterministic owner/name reconciliation and otherwise report `HOSTED_RESULT_UNCERTAIN`. Call `services` to observe resources before any user-directed continuation; do not blindly retry a POST. Existing resources with a paid plan or conflicting identity are refused, never modified, upgraded or deleted.

## Static artifact and actual Direct Upload

Only the exporter artifact `static-export-manifest.json` with format `exhibitos-static-publication-v1` is accepted. Its exact inventory binds every file by bytes and SHA256, and `indexSha256` binds `static-publication-index.json` and the HTML meta marker. Published publication ID/revision are checked. Extra files, symlinks, hardlinks, Workers/functions and special routing/header files are refused. The native exporter should pin its stdout `manifestSha256` internally as `expectedManifestSha256`; a file manifest alone establishes structure/integrity, not independent authorship or server authorization. Arbitrary folders without this artifact are refused. Original/private app storage must never be supplied as a source.

Pages limits applied here are 20,000 total artifact files (including the local receipt) and 25MiB per published file. Files are read one at a time; one asset is uploaded per request to keep memory bounded. The local export manifest itself is not published.

The real REST sequence is project lookup/create, project upload-token, assets/check-missing, missing assets/upload, assets/upsert-hashes, and multipart deployment creation with the manifest. Pages asset keys exactly follow Wrangler's BLAKE3(base64(file bytes) + extension without dot), first 32 hexadecimal characters. The unkeyed implementation is used only for provider content addressing and checked against 14 upstream vectors spanning block/chunk/tree boundaries. It is not a credential or signature scheme. JWTs stay in memory and are used solely with the fixed Cloudflare API origin. Asset uploads are not a deployment success; status polls the deployment's actual latest stage.

Required token access: Cloudflare `Account → Cloudflare Pages → Edit` for the selected account and `User → Memberships → Read` for membership-based account discovery. Account listing is tried first; an empty result or account-list scope refusal falls back to accepted memberships whose API access is not explicitly disabled. A discovered membership does not establish Pages write permission; actual Pages operations still enforce the token scope. No global API key, DNS mutation, Workers or Git integration is used. API permission/plan rejection is reported rather than worked around.

## Optional free Render runtime

The built-in source is the official `https://github.com/ExhibitOS/platform` main branch. Web services use native Node, explicit `plan:free`, one instance, no disk/autoscaling, `autoDeployTrigger:off`, `npm ci && npm run build`, `node scripts/render-runtime.mjs`, and `/api/v1/readiness`. A missing plan would default to a paid plan in the Render API, so it is never omitted. Existing service reuse checks owner/name/free plan/source and the requested durable environment values; no arbitrary foreign service configuration is adopted or changed.

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

Explicit serviceId/postgresId selections are fetched by ID and must belong to the selected workspace and free plan. A conflicting selection fails without substitution or overwrite. Existing Postgres selections must match PostgreSQL18/Frankfurt; existing services must match the official native Node source/readiness endpoint and durable environment.

Selecting an existing service also requires selecting its existing database; otherwise `RENDER_EXISTING_DATABASE_REQUIRED` is returned before any network mutation. The adapter never creates a replacement database in order to overwrite an existing service's durable connection configuration.

## Restart reconciliation

`action:reconcile` is strictly read-only. For Cloudflare supply accountId/projectName/expectedManifestSha256 from the native pending intent; deployments are matched by the manifest-derived commit hash and project. Missing matches stay uncertain with a pending identifier. For Render supply workspaceId/projectName and any last-known serviceId/postgresId; otherwise deterministic names are discovered within the workspace, then the existing status projection is reused. No POST, create, overwrite or implicit retry is performed. No match remains uncertain; an observed database without a service needs a separate explicit continuation. Native pending intent must be saved before the original write and reconciled before any later create.

## Explicit optional same-origin runtime

Only `staticOnly:false` with a native-injected `apiOrigin` observed from the selected Render receipt enables the fixed `src/pages-render-worker.mjs` proxy. The artifact's arbitrary Worker/functions/routing-file rejection remains unchanged. A known module Worker and API-only routes are generated in memory and uploaded separately as the official nested multipart `_worker.bundle` and `_routes.json` deployment fields. Only the validated public `https://<service>.onrender.com` origin is embedded; tokens, passwords and keys are never embedded. The upload derives an `index.html` copy with exactly `<meta name="exhibitos-dynamic" content="same-origin">` after `<head>`; the selected artifact and original public metadata/assets stay unchanged. The deployment identity includes the Worker, routes, backend and fixed meta as well as the original artifact manifest, so a static deployment cannot masquerade as its dynamic continuation. Restart reconcile must retain `staticOnly` and `apiOrigin` with the original manifest hash.

The Worker forwards only `/api/*` to its fixed backend, preserving original Origin/cookie/CSRF and body, removing forwarded host spoofing, refusing redirects, and making API responses non-cacheable. The runtime WebSocket 101 response is passed through directly; that capability is tested with a facade, not a real Cloudflare WebSocket. Other paths fall back to `env.ASSETS.fetch`, and the API-only routing file keeps static requests from invoking Functions. API failures return a fixed 503 and do not replace static assets. The first-release optional Viewer UI is read-only connection status; retained WebSocket proxy capability does not add deferred avatar/meeting UI.

Only production/main deployment projections provide the canonical `https://<project>.pages.dev` origin when the provider URL/aliases link to that project. Deployment ID is retained for the exact revision. Preview branches are refused, and a project with a different reported subdomain is not silently adopted. This keeps the configured CLIENT_ORIGIN aligned; actual same-origin Safari cookie/session/CSRF and live WebSocket tests remain unexecuted without real provider access. SameSite=None alone would not establish Safari cross-site cookie support. Pages Functions share the Workers Free 100,000 daily quota; static non-Function requests retain their separate unlimited allowance. No paid fallback or Worker secrets are configured.

Official protocol references: [Pages advanced mode and ASSETS](https://developers.cloudflare.com/pages/functions/advanced-mode/), [Pages multipart Worker fields](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/create/), [Wrangler bundle serialization](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/api/pages/create-worker-bundle-contents.ts), [API-only routes](https://developers.cloudflare.com/pages/functions/routing/), [Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/), and [WebKit third-party cookie blocking](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/).

Account discovery reference: [List Memberships](https://developers.cloudflare.com/api/resources/memberships/methods/list/).

Rejected Pages requests return only `HOSTED_CF_<fixed stage>_HTTP_<status>[_CODE_<numeric provider code>]`. Stages are project read/create, upload token, asset check/upload/upsert and deployment list/create/status. Only 2xx missing/rejected envelopes or bounded 4xx rejection is classified; transport/5xx write uncertainty retains the existing reconciliation policy. Remote messages, URLs, paths, headers, account IDs and tokens never cross this diagnostic boundary. Use GET-only reconcile before considering another explicit write after a failure.

Cloudflare reconcile reads the project first, then reads its deployment list. Missing/rejected project and rejected deployment-list requests therefore have separate fixed diagnostic stages, without any create or upload retry.

Deployment history uses `per_page=20&page=N`, matching the official example page size, and reads numeric `result_info.total_pages` when supplied. Without page metadata it continues full pages until a short page; a 100-page scan limit fails closed rather than assuming no deployment exists. The earlier single `per_page=100` request was rejected in a real account with numeric code8000024. The official reference does not state a maximum or define that numeric code, so no universal limit is claimed. Reference: [List Pages deployments](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/list/).

The optional `onStage` diagnostic callback receives only a closed set of local request/build stages. Stage selection does not use response messages, URLs or account identifiers; form construction is marked before creating FormData. It changes no request data or retry policy.

## Private recovery adapter (2026-10-18)

`withRenderRecoveryConnection` is an internal native-executor bridge, outside
`executeHosted`'s public six-action wire. It observes only GET endpoints: selected
free PostgreSQL18 and owner, matching service DATABASE_URL, actual service
suspension, expiry, exact operator-confirmed `/32` or `/128` IP entry and explicit
confirmation that other writers stopped. It passes the external connection only
to an in-process callback with mandatory certificate/hostname verification. It
returns a strictly projected encrypted-backup receipt and rechecks suspension.
It neither suspends/resumes resources nor changes network rules. Callback errors
and malformed results use fixed redacted codes.

Six synthetic Node unit cases qualify that routing/guard boundary only. Real
Render access, TLS, DB identity/snapshot privileges, stopped-writer enforcement,
pg_dump, encrypted local backup, independent restore and Manager UI remain
unqualified. An empty IP list blocks external access; the bridge never replaces
it with allow-all or discovers public IP through a third service. If necessary,
a user must authorize/add a narrow range in the official Render screen. This is
not a completed remote recovery product flow or a replacement for T10-05's
update/interruption/restore/rollback checks. Existing local Manager installation
archives and hosted DB archives have different configuration roles; never forge
local installation records to make one appear to be the other.

### Load-only original configuration fence

The private recovery bridge now also requires native-loaded
`expectedConfiguration={envVars,origin}`. Its5 required values are the existing
CLIENT_ORIGIN, TENANT_ID, ADMIN_SUBJECT, ADMIN_PASSWORD and
FREEZE_SIGNING_KEY_BASE64. Existing STATIC publication/revision/index pins are
all present or all absent; missing values are never supplied from the currently
selected export. Validation reuses existing auth/Pages ID and URL limits and
requires an Ed25519 PKCS8 key. It derives the public key/keyId without returning
private key bytes.

Before invoking the executor, the observed service's private env-vars must match
the original values and authority exactly, with its AUTH_ORIGIN, configured
RENDER_EXTERNAL_URL or verified service URL matching the original origin. Duplicate
reserved fields, missing/partial pins, wrong tenant/admin/client/key or origin
fail closed. Env-vars and suspension are rechecked afterward. These are GET-only
observations; the original signing key/admin password remain inside the
native-to-runner/provider comparison boundary and are not supplied to the backup
helper, archive, renderer or projected receipt. Missing/malformed protected source
configuration yields HOSTED_RECOVERY_CONFIGURATION_REQUIRED; a remote mismatch
yields HOSTED_RECOVERY_CONFIGURATION_CHANGED. These are fixed codes, not provider
response text.

Eight synthetic tests cover the extended fence. No real Keychain/Render values
were read. A mutable runtime-Keychain entry is not an immutable backup-time
configuration snapshot: job-bound protected configuration preservation, database
freeze-authority confirmation, active deploy ID/commit, trusted runtime artifacts,
Pages restoration and activation/update/rollback remain unimplemented/unverified.
The Platform's separate real local TLS/SQL/crypto qualification does not establish
actual provider or native load-only behavior.

### Free PostgreSQL acquisition and retry admission

Before a new PostgreSQL POST, the existing deploy adapter lists the selected
workspace's retained databases. It reuses the exact operation project name if
that candidate appears after the initial lookup. Another active or uncertain free database
causes `HOSTED_RESOURCE_CONFLICT` before POST: preserve it and review the selected
workspace/database; the adapter never deletes it, switches workspaces, or upgrades
plans. Explicit ID and same-name retry reuse both verify owner, free plan,
Frankfurt region, PostgreSQL18, supported creating/available state and any reported
expiry. An uncertain POST is reconciled by the same exact-name lookup, without a
second POST. The list/read check is not an atomic reservation; concurrent external
creation can still cause a provider refusal, and no retry invents completion.

This admission is shared by the existing deploy route. It does not prove a
restoration target is empty, bind a remote restoration operation, import SQL,
activate a restored service, or complete remote backup/update/rollback. Those
steps remain separate from the existing isolated local restore-check job. [Render’s free-instance limit](https://render.com/docs/free#single-instance-limit)
permits only one active free PostgreSQL instance per workspace; expiry and retained
resources must be reviewed without deleting the source or enabling paid plans.

A different retained database with a valid provider `expiresAt` at or before the
current time does not permanently consume the local admission slot. Its status
must still be a recognized provider state; missing/malformed expiry or unknown
status never proves inactivity. The adapter may then request one new free
instance while leaving the expired source untouched. Render can still reject the
request; this is not a guarantee of account eligibility or quota availability.
An explicitly selected or same-operation-name expired ID returns
`HOSTED_RECOVERY_DATABASE_EXPIRED`, never automatic replacement or deletion.
Status names and a `creating` success response follow the official
[Postgres creation schema](https://api-docs.render.com/reference/create-postgres)
and [retrieval schema](https://api-docs.render.com/reference/retrieve-postgres).

Provider expiry values must be RFC3339 date-times with an explicit timezone and a valid calendar date. Legacy date strings, timezone omissions and calendar rollover are rejected rather than interpreted as proof of expiration or displayed as a confirmed provider expiry. This adds no resource creation, deletion or paid fallback.

The native recovery caller may pass an optional in-process `onPostgresCreated({id, ownerId, name})` hook to bind its private operation journal to an admitted, successful creation POST response. The hook is awaited, receives no credentials, and does not change the public six-action request/result wire. Selected or same-name discoveries and lost-response GET reconciliation never emit this creation event. Hook persistence failure reports fixed uncertainty without repeating creation. Discovering a database is not proof that the current operation created it or permission to change its IP rules.


### Existing Render recovery connection

`executeHosted` accepts Render `connect-existing` with explicit `workspaceId`, `serviceId`, `postgresId`, and the original `projectName`. The native caller must load that project's existing runtime configuration into `options.runtime.envVars`; this action never creates configuration or infers the original project from a service name. Four authenticated GETs observe the selected Postgres, service, Postgres connection-info, and service environment. Free ownership, PostgreSQL18 availability/expiry, platform Node service identity/readiness path, original configuration and exact database URL pairing must match.

The returned `ready` receipt identifies an observed connection, not a live deploy, backup or recovery point. It contains only public identifiers, origin and optional expiry. Both running and suspended services can be connected; no service suspension, IP change, SQL connection, resource creation or key generation occurs. The caller separately stores connection metadata and preserves unrelated publication history. Backup execution must still revalidate current source and all existing writer/network/key admission conditions.

### Isolated Pages cleanup procedure

The first-release adapter and Manager do not issue remote DELETE requests;
`disconnect` only removes the local provider connection. Cleanup is an explicit
operator action through the official provider API. A successful deployment,
reconciliation, or preserved resource is not evidence that cleanup ran.

1. Use an explicitly authorized isolated account and a uniquely named, empty
   temporary Pages project designated for the cleanup check. Confirm the current
   account's cost/quota conditions before creation; do not change billing or add
   Functions, storage, a Git integration, or a custom domain. Existing reference
   exhibitions, original data, keys, and backups are outside this procedure.
2. Record the exact account, project name, returned project ID and creation time
   from the successful creation response. Check absence before creation. If that
   write is uncertain, observe the exact target and retain it; do not repeat the
   POST or infer that a same-name project belongs to this operation.
3. Before deletion, re-read that exact project. Match the recorded identity and
   confirm that it still has no deployments, custom domains, connected source,
   secrets or resource bindings. A mismatch, new content, or incomplete read
   stops cleanup. An unconfirmed creation or discovery alone is not ownership.
4. Obtain authorization for irreversible deletion of this exact temporary
   target. With the existing account token held only in the authorized client's
   memory, issue `DELETE /accounts/{account_id}/pages/projects/{project_name}`
   at `https://api.cloudflare.com/client/v4`. This permanently deletes the
   project and any deployments; do not apply it to a retained exhibition.
5. Record the redacted deletion result and an authorized follow-up observation
   confirming the exact project's absence. A timeout, permission failure or
   ambiguous response is unresolved; do not blindly retry deletion or broaden
   the target. Retain the creation/deletion evidence and the independent free
   apply/resource-preservation evidence at their actual scopes.

This documents the destroy procedure, not a completed cleanup run or permission
to use an unapproved account. Render service/Postgres deletion is outside this
procedure. Tokens and raw provider bodies must not enter logs or evidence.
See Cloudflare's [project creation](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/create/),
[project observation](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/get/),
[permanent project deletion](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/delete/),
and [current Pages limits](https://developers.cloudflare.com/pages/platform/limits/).
