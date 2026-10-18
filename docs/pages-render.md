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
