# MediaPilot Agent Development Guide

Last updated: `2026-05-05`

`MediaPilot-agent` is the repository name. Runtime labels, API descriptions, and some legacy code paths may still reference `OmniMedia Agent`. Both names refer to the same product: a shared AI content platform that combines a creator workspace and an admin console.

`README.md` is the Chinese engineering guide. `DEVELOPMENT.md` must remain English-only.

## 1. Purpose

Use this document when you need to:

- understand the current repository topology
- develop backend APIs in `app/`
- work on the creator workspace in `frontend/`
- work on the admin console in `omnimedia-admin-web/`
- validate auth, streaming, uploads, knowledge, billing, RBAC, and admin-governance behavior
- prepare changes for review, commit, and push

## 2. Product Architecture

The repository contains one shared backend and two web clients:

- `app/`: shared `FastAPI` backend for auth, sessions, streaming chat, thread history, uploads, knowledge base, topics, templates, dashboards, admin operations, and token ledgers
- `frontend/`: creator workspace for generation, drafting, multimodal input, asset viewing, history, profile management, and security settings
- `omnimedia-admin-web/`: admin console for privileged users and back-office operators, including user governance, RBAC, route-aware workspaces, dashboard views, live token-ledger analytics, and session activity telemetry
- `extension/`: reserved area for browser-extension or external publishing integrations

Default local infrastructure:

- `SQLite` for persistence
- `uploads/` for local file storage
- optional `OSS` integration for object storage
- `LangGraph` for multimodal workflow orchestration
- `OpenAI / DashScope / OpenAI-compatible` providers for model execution

## 3. Repository Map

```text
MediaPilot-agent/
|- app/
|  |- api/v1/                # FastAPI route modules
|  |- db/                    # Engine, sessions, ORM models
|  |- models/                # Pydantic schemas
|  |- services/              # Auth, providers, graph, parsing, storage, scheduling
|  |- config.py              # Environment loading and runtime helpers
|  '- main.py                # FastAPI entrypoint
|- alembic/                  # Database migrations
|- frontend/                 # Creator workspace
|  |- e2e/                   # Playwright tests
|  '- src/
|- omnimedia-admin-web/      # Admin console
|  '- src/
|- extension/                # Reserved extension area
|- tests/                    # Backend tests
|- uploads/                  # Local uploaded assets
|- .env.example              # Sample configuration
|- requirements.txt          # Python dependencies
|- README.md                 # Chinese guide
'- DEVELOPMENT.md            # English engineering baseline
```

## 4. Runtime Topology

### 4.1 Backend

- entrypoint: `app/main.py`
- local address: `http://127.0.0.1:8000`
- OpenAPI docs: `http://127.0.0.1:8000/docs`
- health endpoint: `GET /health`

The backend loads `.env`, initializes the database, mounts `/uploads`, applies runtime configuration, and starts optional background jobs.

### 4.2 Creator workspace

- directory: `frontend/`
- local address: `http://127.0.0.1:5173`
- default Vite proxy targets:
  - `/api -> http://127.0.0.1:8000`
  - `/health -> http://127.0.0.1:8000`
  - `/uploads -> http://127.0.0.1:8000`

### 4.3 Admin console

- directory: `omnimedia-admin-web/`
- local address: `http://127.0.0.1:5174`
- optional environment variables:
  - `VITE_API_BASE_URL`
  - `VITE_CLIENT_APP_URL`

## 5. Local Development Setup

### 5.1 Requirements

- `Python 3.11+`
- `Node.js 18+`
- `npm 9+`

### 5.2 Backend bootstrap

```powershell
copy .env.example .env
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```

### 5.3 Creator workspace bootstrap

```powershell
cd frontend
npm install
npm run dev
```

### 5.4 Admin console bootstrap

```powershell
cd omnimedia-admin-web
npm install
npm run dev
```

### 5.5 Playwright browser install

```powershell
cd frontend
npx playwright install chromium
```

## 6. Key Environment Variables

Start from `.env.example`. Never commit secrets, production credentials, or private endpoints.

### 6.1 LLM and workflow settings

- `OMNIMEDIA_LLM_PROVIDER`
- `LANGGRAPH_INNER_PROVIDER`
- `QWEN_API_KEY`
- `QWEN_BASE_URL`
- `QWEN_PRIMARY_MODEL`
- `QWEN_ARTIFACT_MODEL`
- `QWEN_FALLBACK_MODELS`
- `QWEN_TIMEOUT_SECONDS`
- `QWEN_RETRY_ATTEMPTS`
- `QWEN_RETRY_BASE_DELAY_SECONDS`
- `QWEN_ENABLE_TOOL_BINDING`
- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_MODEL`
- `LLM_ARTIFACT_MODEL`
- `LLM_VISION_MODEL`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `OPENAI_ARTIFACT_MODEL`
- `OPENAI_VISION_MODEL`
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`
- `DEEPSEEK_ARTIFACT_MODEL`
- `DEEPSEEK_TIMEOUT_SECONDS`
- `PROXY_GPT_API_KEY`
- `PROXY_GPT_BASE_URL`
- `PROXY_GPT_MODEL`
- `PROXY_GPT_ARTIFACT_MODEL`
- `PROXY_GPT_TIMEOUT_SECONDS`
- `TAVILY_API_KEY`

The current model-routing baseline now supports `deepseek` and `proxy_gpt` as explicit provider keys for both `OMNIMEDIA_LLM_PROVIDER` and `LANGGRAPH_INNER_PROVIDER`. This adds environment-driven access to DeepSeek and proxy-hosted GPT-5.4 models without changing the existing default MiMo path.

### 6.2 Image generation and transcription

- `IMAGE_GENERATION_BACKEND`
- `IMAGE_GENERATION_API_KEY`
- `IMAGE_GENERATION_BASE_URL`
- `IMAGE_GENERATION_MODEL`
- `IMAGE_GENERATION_COUNT`
- `IMAGE_GENERATION_TIMEOUT_SECONDS`
- `IMAGE_GENERATION_POLL_INTERVAL_SECONDS`
- `IMAGE_GENERATION_PERSIST_RESULTS`
- `IMAGE_PROMPT_API_KEY`
- `IMAGE_PROMPT_BASE_URL`
- `IMAGE_PROMPT_MODEL`
- `OPENAI_IMAGE_BASE_URL`
- `OPENAI_IMAGE_API_KEY`
- `OPENAI_IMAGE_MODEL`
- `OPENAI_TRANSCRIPTION_BASE_URL`
- `OPENAI_TRANSCRIPTION_API_KEY`
- `OPENAI_TRANSCRIPTION_MODEL`

The current OpenAI-compatible image path intentionally uses the classic `Images API`, meaning SDK-side `client.images.generate(...)` and gateway-side `/v1/images/generations`. Keep `response_format="b64_json"` unless you have explicitly verified that the upstream gateway already supports image generation through `Responses API` at `/v1/responses`.

### 6.3 Storage

- `OMNIMEDIA_STORAGE_BACKEND`
- `OSS_ACCESS_KEY_ID`
- `OSS_ACCESS_KEY_SECRET`
- `OSS_ENDPOINT`
- `OSS_BUCKET_NAME`
- `OSS_REGION`
- `OSS_PUBLIC_BASE_URL`
- `OSS_SIGNED_URL_EXPIRE_SECONDS`
- `OSS_SIGNED_URL_MIN_EXPIRE_SECONDS`
- `OSS_SIGNED_URL_MAX_EXPIRE_SECONDS`
- `OSS_TMP_UPLOAD_EXPIRE_DAYS`
- `OSS_THREAD_UPLOAD_TRANSITION_DAYS`
- `OSS_THREAD_UPLOAD_TRANSITION_STORAGE_CLASS`
- `OSS_AUTO_SETUP_LIFECYCLE`

### 6.4 Auth and infrastructure

- `JWT_SECRET_KEY`
- `JWT_ALGORITHM`
- `JWT_ACCESS_EXPIRE_MINUTES`
- `JWT_REFRESH_EXPIRE_DAYS`
- `JWT_PASSWORD_RESET_EXPIRE_MINUTES`
- `CORS_ALLOWED_ORIGINS`
- `DATABASE_URL`

## 7. Current Engineering Baseline

Everything in this section reflects behavior that is already implemented in the current codebase and should be treated as the active baseline.

### 7.1 Account freeze enforcement

The system enforces account freezing across backend and frontend layers:

- login rejects frozen users with `403 ACCOUNT_FROZEN`
- authenticated requests reject frozen users during token validation
- admin freeze actions revoke refresh sessions and invalidate related access tokens
- the creator workspace globally intercepts `ACCOUNT_FROZEN`, clears auth state, aborts active streams, and redirects users back to login

### 7.2 Commercial token lifecycle

The current monetization baseline follows a prepaid model:

- the initial-token grant is no longer hardcoded in auth or admin provisioning routes
- `SystemSetting(key="new_user_bonus")` is the live source of truth for initial grants
- both `POST /api/v1/auth/register` and `POST /api/v1/admin/users` read `new_user_bonus` at runtime for non-system roles
- when the setting is missing or invalid, the grant safely falls back to `0`
- every non-zero grant still writes both the `User` row update and a matching `TokenTransaction(transaction_type="grant")` row in one transaction
- standard users with `token_balance <= 0` receive `402 INSUFFICIENT_TOKENS` before model execution begins
- the creator workspace profile UI exposes a token asset panel for standard users
- the top-up entry remains a placeholder until payment integration is introduced

### 7.3 Privileged account bypass

Management accounts follow a different billing policy:

- `super_admin` and `admin` bypass the pre-flight balance block
- the final token-ledger deduction step also skips those roles
- privileged accounts can keep generating even when their stored balance is `0`
- privileged runs do not create normal consumption ledger rows
- the creator workspace renders these accounts as an unlimited-credit state

### 7.4 Multimodal token accounting

The billing flow tracks real model usage across multimodal workflows:

- provider stream chunks may emit usage
- artifact-structuring calls contribute their own usage
- vision preprocessing nodes record usage independently
- `LangGraph` state carries `token_usage` as a `{model_name: token_count}` map
- final billing inserts one `TokenTransaction` row per model instead of estimating usage from output text

### 7.5 Provider usage propagation

The provider layer includes explicit usage propagation safeguards:

- stream-based provider calls attempt `stream_options={"include_usage": True}`
- `OpenAIProvider`, `CompatibleLLMProvider`, and `QwenLLMProvider` emit accumulated `token_usage` in the final `done` event
- warning logs surface when upstream rejects `include_usage` or when a request still ends without tracked usage
- `agent.py` logs the final `token_usage` payload before ledger persistence

### 7.6 SQLite write isolation

Because `SQLite` uses coarse-grained write locks, write paths must stay short-lived:

- no streaming response should hold an open write transaction for the full generation lifecycle
- final token-ledger writes use a dedicated `SessionLocal()` session
- billing code performs `commit`, `rollback`, and `close` inside the ledger helper
- read-heavy endpoints such as thread history, dashboards, and admin lists must not block behind a lingering write lock

### 7.7 Runtime generation budget and zero-floor billing

Quota enforcement now uses both runtime budgeting and persistence protection:

- `MediaChatRequest` includes an internal `max_generation_tokens` field
- `app/services/agent.py` computes a runtime generation budget from the current user balance before calling the effective provider
- the budget is injected only for non-privileged users
- `app/services/providers.py` forwards the budget into compatible provider calls as `max_tokens`
- final token deduction follows a zero-floor balance rule
- the database no longer stores negative token balances
- the ledger records the actual billable deduction, not a theoretical overdraft
- for multimodel runs, the actual deducted total is allocated back across model rows for auditing consistency

### 7.8 Admin user center hardening

The admin user center follows a stricter governance baseline:

- the admin user list API returns `avatar_url` so the console can render real profile images
- the admin search box uses debounced synchronization and restores the full list when the keyword is cleared
- a shared `UserAvatar` component prefers the backend image URL and falls back to an initial badge when the image is missing or fails to load
- the table is intentionally capped at `5` rows per page to stay aligned with the current admin design baseline
- the list uses lighter role text badges, ID-first secondary metadata, and a compact `MoreVertical` action trigger instead of long inline button groups
- `super_admin` targets are protected on both backend and frontend:
  - backend rejects status changes, password resets, and token adjustments
  - frontend keeps those rows view-only and surfaces a protection notice in the detail drawer
- `super_admin` and `admin` accounts are displayed as unlimited-balance accounts in the console
- the row action dropdown now groups detail, role, password, token, freeze, and delete operations behind one uncluttered trigger while still keeping the right-side detail drawer available
- the password-reset workflow is now deterministic for admin operations: `POST /api/v1/admin/users/{user_id}/reset-password` resets mutable accounts to the fixed bootstrap password `12345678`
- `DELETE /api/v1/admin/users/{user_id}` is now available for mutable accounts and blocks both self-delete and `super_admin` delete attempts
- successful user deletion revokes refresh sessions, blacklists related latest access JTIs, and writes a `delete_user` audit event that is visible in the admin audit workspace

### 7.9 Admin recent-session activity telemetry

The admin user list exposes real session-based recent-activity data:

- `GET /api/v1/admin/users` includes `latest_session` for each returned user
- `latest_session` currently contains:
  - `device_info`
  - `ip_address`
  - `last_seen_at`
  - `created_at`
- the backend selects the newest `RefreshSession` row per user for the current page
- the admin console renders real device information and relative activity time instead of a placeholder
- the same session summary is also shown in the user detail drawer

### 7.10 Enterprise RBAC baseline

The admin console now has a real RBAC chain that covers role definition, role assignment, and role-aware routing:

- current persisted role values:
  - `super_admin`
  - `admin`
  - `finance`
  - `operator`
  - `premium`
  - `user`
- the admin role-management page is implemented as a real screen at `/roles`
- the page supports role cards, grouped permissions, a right-side configuration drawer, and immutable system-role behavior
- role assignment is available from the admin user center through `PATCH /api/v1/admin/users/{user_id}/role`
- only `super_admin` can change roles
- self-role changes are blocked
- peer `super_admin` role changes are blocked

### 7.11 Dynamic role-aware workspaces

The admin console now uses one shared route-permission map for navigation and guard behavior:

- `omnimedia-admin-web/src/adminMeta.ts` defines menu items, allowed roles, page metadata, and per-role default workspaces
- `AdminLayout` renders only the menu items that the current role is allowed to access
- `AuthGuard` intercepts direct URL access to disallowed admin pages
- when a user hits a forbidden route, the app redirects to that role's first safe workspace and shows a warning toast instead of leaving the page stuck in a loading state

Current default workspaces:

- `super_admin` -> `/dashboard`
- `admin` -> `/dashboard`
- `operator` -> `/users`
- `finance` -> `/tokens`
- `/tokens` is now a live ledger workspace for `super_admin` and `finance`.
- the route is backed by `GET /api/v1/admin/transactions` and `GET /api/v1/admin/transactions/stats`
- the page supports debounced user-keyword filtering, previous/next pagination, and real KPI cards

### 7.12 Admin role-summary aggregation

Role membership counts are no longer mocked on the RBAC page:

- backend route: `GET /api/v1/admin/roles/summary`
- implementation: `GROUP BY User.role`
- current authorization: `super_admin` only
- current response shape: `{ "super_admin": 2, "operator": 6, "finance": 3, "user": 145 }`
- the admin RBAC page loads that summary and replaces static card counts with real values
- if the summary request fails, the page falls back to `0` and surfaces a warning toast instead of showing fake numbers

### 7.13 Admin route and capability matrix

The current access policy is:

| Page or capability | super_admin | admin | operator | finance |
| --- | --- | --- | --- | --- |
| Dashboard `/dashboard` | yes | yes | no | no |
| User Center `/users` | yes | yes | yes | no |
| Roles `/roles` | yes | no | no | no |
| Token Ledger `/tokens` | yes | no | no | yes |
| Audit `/audit` | yes | yes | no | no |
| Templates `/templates` | yes | yes | yes | no |
| Storage `/storage` | yes | yes | no | no |
| Settings `/settings` | yes | no | no | no |
| `GET /api/v1/admin/users` | yes | yes | yes | yes |
| user status/password/token mutation | yes | yes | yes | no |
| user role mutation | yes | no | no | no |
| role membership summary | yes | no | no | no |

Notes:

- `finance` is currently a read-oriented back-office role for ledger and financial visibility
- `admin` remains a compatible high-privilege role for governance and billing exemptions, but it is not allowed to edit system RBAC definitions
- the live token-ledger workspace is intentionally restricted to `super_admin` and `finance`; `admin` retains governance powers but is no longer routed into financial-ledger screens
- the visible RBAC cards currently focus on built-in system-management roles such as super admin, operator, and finance; `admin` is still a valid persisted role and can still be assigned from the user center

### 7.14 Creator upload capture UX

The creator workspace upload entry uses one shared material-ingestion pipeline:

- file-picker uploads, clipboard paste, and drag-and-drop all end up in the same queue builder in `frontend/src/app/App.tsx`
- `frontend/src/app/components/Composer.tsx` is responsible only for capturing raw `File[]` from UI events and publishing them upstream
- frontend validation mirrors the backend contract in `app/api/v1/oss.py`

Supported file types:

- images: `.jpg`, `.jpeg`, `.png`, `.webp`
- videos: `.mp4`, `.mov`, `.avi`, `.wmv`
- audio: `.mp3`, `.wav`, `.flac`, `.m4a`, `.ogg`
- documents: `.txt`, `.pdf`, `.md`, `.docx`

Current capture limits:

- up to `12` files per capture event
- up to `9` image materials total in one composer queue
- size limits:
  - image and document: `15MB`
  - audio: `100MB`
  - video: `300MB`

Current known limitations:

- upload still uses one-shot `fetch + FormData`
- chunked upload is not implemented
- byte-level percentage progress is not available
- the UI mainly exposes queue states such as `uploading`, `ready`, and `error`

### 7.15 Creator artifact asset matrix and contextual handoff

The creator right-side result panel has been upgraded from a single-latest-artifact renderer into a thread-level artifact matrix:

- artifact entries are derived from the current thread `messages` plus the latest streamed artifact state
- results are indexed by task type and exposed as local panel tabs
- the panel keeps an independent selected-artifact state so generated results do not disappear when the top task selector changes

Current panel categories:

- `content_generation`
- `comment_reply`
- `topic_planning`
- `hot_post_analysis`

The top task selector remains an input-task selector, not a backend multi-task batch switch:

- switching the selector does not imply that other artifacts already exist
- the backend still executes one task per request
- any "one-click pipeline" experience must be implemented as explicit frontend-guided follow-up requests

### 7.16 Admin template governance lifecycle

The admin template workspace now supports the full shared-template lifecycle instead of create-only cards:

- `omnimedia-admin-web/src/pages/AdminTemplatesPage.tsx` supports create, edit, preview, single delete, multi-select, and batch delete, with the grid paged at `10` items per view
- shared-template mutations are backed by `app/api/v1/admin_templates.py`, and admin routes now allow preset-template edits and deletes
- the admin page now uses a centered shared modal for both create and edit states instead of the older side drawer
- the modal includes an `is_preset` switch so operators can promote or demote a template between shared-custom and official-preset states
- template cards use a longer detail-rich layout with platform and ownership tags, a `PROMPT SNAPSHOT` preview block, and a three-column stats grid
- deleting shared templates requires an explicit confirmation dialog; seeded preset deletes are tombstoned instead of hard-deleted so they stay hidden and do not silently reappear after the next preset sync
- `app/services/template_library.py` now backfills only missing preset templates and no longer force-overwrites admin-edited preset content
- bulk selection uses an animated action bar with a foreground `z-index` so it stays readable above the card grid
- the modal keeps industry classification as a UI-only helper field, removes the earlier knowledge-base input, and still filters the backend payload down to supported template fields only

The creator-side local template center was also extended:

- `PATCH /api/v1/media/templates/{template_id}` updates user-owned templates
- `DELETE /api/v1/media/templates` performs validated batch deletion using SQLAlchemy `delete(...)`
- preset templates remain immutable on the creator surface, while the admin console intentionally unlocks them behind admin-role authorization

### 7.17 Admin user provisioning modal

The create-user entry in `omnimedia-admin-web/src/pages/AdminUsersPage.tsx` has been refocused into a compact centered modal:

- payload is intentionally limited to `username`, `password`, and `role`
- the password field supports inline random generation and clipboard copy
- role assignment uses card-based single selection instead of a dropdown
- the modal uses a bounded height with internal scrolling so it does not feel full-screen on shorter viewports
- the bottom banner explains that the backend will automatically grant the initial token asset or unlimited quota according to role and record the action in audit history

### 7.18 Admin user deletion and audit linkage

The admin user center now includes a complete delete and recovery-oriented governance path:

- the row action dropdown exposes delete without reintroducing table clutter
- the delete flow uses a blocking confirmation modal that clearly warns about login loss, session cleanup, and asset cleanup
- deleting a user removes the row from the current page, recalculates pagination when the last row on a page disappears, and clears any active detail state for that target
- the audit workspace recognizes `delete_user` as a first-class admin event with dedicated label, icon, and summary rendering
- the audit workspace now uses a fixed `5`-row page size so governance actions are easier to scan and reconcile
- the reset-password action remains visible in the same dropdown and now consistently communicates the fixed reset password baseline to operators

### 7.19 System setting KV control plane

The admin settings workspace is now backed by a real database-owned KV configuration center:

- `app/db/models.py` defines `SystemSetting` with `key`, `value`, `category`, and `description`
- `app/services/system_settings.py` owns the settings catalog, default seeding, grouped admin responses, typed coercion, and update validation
- startup initialization ensures the table exists and seeds missing defaults before the admin console starts relying on them
- `GET /api/v1/admin/settings` returns grouped settings for the admin console
- `PUT /api/v1/admin/settings` persists updates and writes an `update_system_settings` audit event containing both `changed_keys` and structured `changes`
- security-sensitive settings are cached in-process through `app/core/security.py` so request-time checks do not hit the database on every admin request
- saving settings immediately refreshes the security-settings cache

### 7.20 Security baseline from settings

Security controls now read from the shared settings control plane instead of fixed constants:

- admin-session access-token expiry is derived from `session_timeout_enabled` and `session_timeout_minutes`
- `/api/v1/admin/*` is protected by an IP-whitelist middleware backed by `ip_whitelist_enabled` and `ip_whitelist_ips`
- loopback addresses remain locally safe, and an empty whitelist does not hard-lock the instance during development
- the admin settings page progressively expands the whitelist textarea and timeout input only when the corresponding switches are enabled

### 7.21 Audit detail drawer and diff rendering

The audit workspace now exposes a richer investigation surface:

- each audit row includes a right-side detail drawer entry point
- `update_system_settings` events render GitHub-style before/after diff blocks from `details.changes`
- all other event types render the structured audit payload as formatted JSON for operator review
- the drawer keeps the existing `5`-row pagination baseline while giving operators access to the full change payload without leaving the page

### 7.22 Admin notification center and pending-task aggregation

The admin shell now includes a real message stream and task-warning layer:

- `SystemNotification` is persisted in `app/db/models.py`
- `GET /api/v1/admin/notifications` returns recent notifications plus `unread_count`
- `PUT /api/v1/admin/notifications/read_all` marks unread entries as read in one operation
- high-impact admin actions such as system-setting updates and rollbacks append notifications automatically
- `GET /api/v1/admin/dashboard/pending-tasks` aggregates live governance warnings, currently including:
  - `abnormal_users`
  - `storage_warnings`
- `AdminLayout` renders the bell popover and the lower-left pending-task widget, with role-aware navigation to `/users?status=frozen` and `/storage`

### 7.23 Live storage-governance analytics

The storage-governance workspace now reads real upload data instead of mock values:

- `GET /api/v1/admin/storage/stats` returns:
  - `total_bytes`
  - `capacity_bytes`
  - grouped `image / video / audio / document / other` distribution
- `GET /api/v1/admin/storage/users` returns per-user rankings with:
  - total stored bytes
  - file count
  - latest upload timestamp
- frontend rendering uses human-readable byte formatting (`KB / MB / GB / TB`) instead of raw byte counts
- the current user-ranking endpoint defaults to `limit=10`

### 7.24 System-setting rollback path

The admin settings stack now includes a reversible recovery flow:

- `POST /api/v1/admin/settings/rollback/{audit_log_id}` restores system-setting values from a recorded audit snapshot
- rollback validates the snapshot type, extracts previous values, updates `SystemSetting`, writes a new `rollback_system_settings` audit row, and appends a new admin notification
- the rollback path is wrapped in one database transaction so config recovery and audit persistence succeed or fail together
- the audit detail drawer exposes a dedicated rollback action with a confirmation dialog

### 7.25 Admin search-entry simplification and creator template-grid stability

The latest UI baseline deliberately removes redundant search entry points:

- the admin header no longer exposes a global cross-module search box
- the audit workspace intentionally relies only on its advanced filter drawer and no longer renders a second free-text search input
- `omnimedia-admin-web/src/components/common/StandardSearchInput.tsx` is now the shared local-search primitive for:
  - admin users
  - token ledger
  - template library
- the shared search input handles local buffering, debounced URL sync, reverse URL hydration, and one-click clear behavior
- the template-library toolbar constrains the local search box to a fixed width so it no longer crushes the tab bar
- the creator template center keeps a 3x3 `page_size=9` gallery, uses `content-start` to avoid last-page card stretching, and keeps cards aligned with `h-full + flex-col`

### 7.26 OpenAI-compatible image gateway baseline

The OpenAI-compatible image pipeline currently follows a compatibility-first baseline:

- `app/services/image_generation.py` uses `AsyncOpenAI.images.generate(...)` for OpenAI-compatible image generation
- requests stay fixed at `response_format="b64_json"`, `n=1`, and `size="1024x1024"` to maximize compatibility with third-party gateways that do not yet support `/v1/responses`
- image responses must pass through `sanitize_image_response_for_log()` or an equivalent masking step before logging; raw `b64_json` payloads must never be written to console logs
- base64 image data is treated as a server-side transient transport only: decode it immediately, persist it to local `uploads/` or object storage, and return a clean delivery URL to the frontend
- the `/uploads` static mount in `app/main.py` is part of the local persistence path and must remain available during troubleshooting
- the existing DashScope fallback path remains active when the OpenAI-compatible branch fails, preserving availability over protocol novelty

### 7.27 Model registry and selector availability baseline

The model-registry contract is now a first-class runtime baseline for both backend routing and frontend selection:

- `GET /api/v1/models/available` returns provider-scoped model ids in the form `<provider_key>:<model_name>`, for example `compatible:mimo-v2.5-pro` and `proxy_gpt:gpt-5.4`
- provider `status` and `status_label` are authoritative for selector availability; the creator workspace should not infer availability only from the currently active provider or default model
- the compatible MiMo provider is considered configured whenever `LLM_API_KEY` and a non-DashScope `LLM_BASE_URL` are present
- MiMo availability is intentionally independent from `LANGGRAPH_INNER_PROVIDER`; a `proxy_gpt` default does not make the compatible provider unavailable
- the built-in OpenAI proxy text matrix currently includes `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex`, `gpt-5.3-codex-spark`, and `gpt-5.2`
- `gpt-5.5` remains intentionally excluded from the proxy registry
- when a user clicks a provider that is still unconfigured, the frontend should surface a warning or setup prompt instead of silently accepting and later rolling the selection back

### 7.28 Task-type hinting and disconnect-aware streaming

The media chat entrypoint now treats the frontend task mode as a hint instead of a gateway-level override:

- `app/services/intent_routing.py` no longer rewrites `MediaChatRequest.task_type` through keyword heuristics before persistence or workflow execution
- requested `content_generation` / `image_generation` values are persisted as-is and move through the workflow as-is
- the frontend mode is now advisory context for downstream prompts; direct user wording must always outrank the dropdown selection
- stream forwarding in `app/api/v1/chat.py` remains wrapped by `_forward_stream_with_disconnect_cancellation(...)`
- client disconnects and explicit stop actions cancel the producer task so the backend does not keep forwarding a dead SSE stream in the background
- cancellation handling belongs in the route-layer stream bridge as well as in downstream workflow nodes; do not collapse `CancelledError` or `GlobalKillSwitchTriggered` into a generic fallback path

### 7.29 Async-safe workflow execution baseline

The workflow stack now carries a stricter async-only execution rule for cancellation-sensitive work:

- `app/services/graph/provider.py` routes tool work through `execute_business_tool_async(...)` instead of wrapping synchronous business-tool execution in `asyncio.to_thread(...)`
- Tavily search, prompt-skill extraction, and related OpenAI-compatible helper calls now expose async variants in `app/services/tools.py`
- route-layer disconnect cancellation is expected to bubble through graph nodes, business tools, and provider calls without being swallowed
- long-running workflow nodes should prefer async HTTP and async SDK clients so `CancelledError` can stop the chain before fallback work or expensive image generation starts

### 7.30 Brain-First draft-and-image tool-calling baseline

The LangGraph runtime now uses a Brain-First baseline for text-and-image workflows:

- `GraphState` still carries `execution_plan` plus `active_execution_step`, but both `content_generation` and `image_generation` requests now start with `draft_content`
- the router no longer bypasses directly into `generate_image_node` based on the frontend dropdown alone
- the frontend-selected mode is injected into the draft prompt, post-review artifact-tool prompt, and image-route prompt as soft context
- explicit user wording such as “不要图片”, “只要文字”, or “No image” must suppress image-tool execution even if the frontend mode is `image_generation`
- after review, the workflow decides whether to call `generate_cover_images` through tool-calling or the image-route fallback instead of committing to image generation at router time
- `image_generation` requests can still end as `image_result` after an actual image step, but text-only outcomes in image mode must remain `content_draft`
- completed execution steps must still be popped correctly so the graph does not loop back into the same expensive node

### 7.31 Explicit stop and kill-switch cancellation baseline

The streaming stack now treats user stop actions as a thread-scoped hard-stop contract instead of a best-effort UI hint:

- `POST /api/v1/media/chat/stop` lets the frontend stop a live generation by `thread_id`, and `app/api/v1/chat.py` treats SSE disconnects as the same cancellation signal
- `app/core/cancel_manager.py` keeps per-thread cancellation records plus registered `asyncio.Task` handles, so explicit stops can call `task.cancel()` immediately instead of waiting for another stream chunk
- `_forward_stream_with_disconnect_cancellation(...)` handles `GlobalKillSwitchTriggered` as an expected termination path, allowing the SSE boundary to exit cleanly without falling into generic fallback or noisy server-error logging
- `app/services/graph/provider.py` now adds route-level trap doors before expensive next hops; cancelled threads must route to `END` instead of entering another draft, tool, or image step
- `execute_with_kill_switch(...)` actively polls thread cancellation while awaiting long-running I/O, and is now the required wrapper for cancellation-sensitive image prompt generation, image generation, and image download calls
- provider and image-service preflight checks must re-raise cancellation immediately; do not swallow `GlobalKillSwitchTriggered` or downgrade it into a normal retryable exception

### 7.32 Creator long-text progressive disclosure baseline

The creator workspace now uses one shared long-text folding primitive instead of rendering every large prompt or log block at full height:

- `frontend/src/app/components/CollapsibleText.tsx` is the reusable clamp-and-expand component
- chat `tool` / `note` / `error` cards and normal chat bubbles now fold oversized content instead of pushing the whole thread off screen
- `ContentGenerationArtifact` and `ImageGenerationArtifact` now apply the same folding behavior to long prompts, revised prompts, body drafts, and CTA blocks
- prompt readability improvements must preserve whitespace and copy behavior; do not replace structured prompt text with a lossy preview string

### 7.33 Creator streaming UI alignment baseline

The creator workspace now waits for backend truth before rendering task-specific streaming placeholders:

- `frontend/src/app/App.tsx` does not treat the local dropdown as the source of truth for the active streaming artifact type
- the first SSE event and subsequent artifact metadata now decide whether the right panel should behave like a text draft flow or an image-generation flow
- `frontend/src/app/components/RightPanel.tsx` shows a pending-resolution state while the backend has not yet confirmed the real artifact type
- `AbortController.abort()` must synchronously clear local generating/loading state and any optimistic skeleton state
- user-triggered `AbortError` paths are expected behavior and must not surface as red failure toasts

## 8. Backend Boundaries

### 8.1 Route groups

Current route modules under `app/api/v1/` include:

- `auth.py`
- `users.py`
- `chat.py`
- `history.py`
- `knowledge.py`
- `templates.py`
- `topics.py`
- `dashboard.py`
- `models.py`
- `oss.py`
- `admin_users.py`
- `admin_dashboard.py`
- `admin_storage.py`
- `admin_settings.py`
- `admin_notifications.py`
- `admin_search.py`
- `admin_tokens.py`
- `admin_templates.py`
- `admin_audit_logs.py`

### 8.2 Layering rules

- `app/api/` handles request validation, dependency injection, HTTP status codes, and response models
- `app/services/` handles workflows, providers, parsing, storage, and business logic
- `app/db/` handles the engine, sessions, ORM models, and migration compatibility
- `app/models/` handles Pydantic schemas and shared API contracts

Avoid pushing long-lived business orchestration and complex data-access code into the route layer.

### 8.3 System setting and security layering

Mutable commercial, security, and notification baselines should follow the KV control-plane path:

- persist defaults and runtime overrides in `SystemSetting`
- read typed values through `app/services/system_settings.py` for normal business flows
- read cached security values through `app/core/security.py` for middleware and token-issuance decisions
- avoid introducing new hardcoded business defaults inside route handlers when the value is expected to be operator-managed

## 9. Key API Surface

### 9.1 Auth and user endpoints

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/password-reset-request`
- `POST /api/v1/auth/password-reset`
- `POST /api/v1/auth/reset-password`
- `GET /api/v1/auth/sessions`
- `DELETE /api/v1/auth/sessions/{session_id}`
- `PATCH /api/v1/auth/profile`
- `GET /api/v1/users/me`

### 9.2 Media and generation workflow

- `POST /api/v1/media/chat/stream`
- `POST /api/v1/media/chat/stop`
- `GET /api/v1/media/threads`
- `GET /api/v1/media/threads/{thread_id}/messages`
- `PATCH /api/v1/media/threads/{thread_id}`
- `DELETE /api/v1/media/threads/{thread_id}`
- `GET /api/v1/media/artifacts`
- `POST /api/v1/media/upload`
- `GET /api/v1/media/dashboard/summary`
- `GET /api/v1/models/available`

### 9.3 Knowledge, template, and topic endpoints

- `GET /api/v1/media/templates`
- `POST /api/v1/media/templates`
- `PATCH /api/v1/media/templates/{template_id}`
- `DELETE /api/v1/media/templates/{template_id}`
- `DELETE /api/v1/media/templates`
- `GET /api/v1/media/skills/search`
- `GET /api/v1/media/topics`
- `POST /api/v1/media/topics`
- `PATCH /api/v1/media/topics/{topic_id}`
- `DELETE /api/v1/media/topics/{topic_id}`
- `GET /api/v1/media/knowledge/scopes`
- `POST /api/v1/media/knowledge/upload`
- `PATCH /api/v1/media/knowledge/scopes/{scope_name}`
- `DELETE /api/v1/media/knowledge/scopes/{scope}`

### 9.4 Admin endpoints

- `GET /api/v1/admin/users`
- `POST /api/v1/admin/users`
- `DELETE /api/v1/admin/users/{user_id}`
- `POST /api/v1/admin/users/{user_id}/status`
- `POST /api/v1/admin/users/{user_id}/reset-password`
- `POST /api/v1/admin/users/{user_id}/tokens`
- `PATCH /api/v1/admin/users/{user_id}/role`
- `GET /api/v1/admin/templates`
- `POST /api/v1/admin/templates`
- `PATCH /api/v1/admin/templates/{template_id}`
- `DELETE /api/v1/admin/templates/{template_id}`
- `DELETE /api/v1/admin/templates`
- `GET /api/v1/admin/roles/summary`
- `GET /api/v1/admin/dashboard`
- `GET /api/v1/admin/storage/stats`
- `GET /api/v1/admin/storage/users`
- `GET /api/v1/admin/transactions`
- `GET /api/v1/admin/transactions/stats`
- `GET /api/v1/admin/notifications`
- `PUT /api/v1/admin/notifications/read_all`
- `GET /api/v1/admin/dashboard/pending-tasks`
- `GET /api/v1/admin/global-search`
- `GET /api/v1/admin/settings`
- `PUT /api/v1/admin/settings`
- `POST /api/v1/admin/settings/rollback/{audit_log_id}`
- `GET /api/v1/admin/audit-logs`
- `GET /api/v1/admin/audit-logs/export`

## 10. Validation Checklist

Validate the parts you actually changed before you push.

### 10.1 General validation

- backend syntax check: `python -m compileall app`
- if `frontend/` changed: run the relevant build or targeted verification
- if `omnimedia-admin-web/` changed: run `npm run build`
- if schemas changed: verify frontend/backend contract compatibility
- if database write paths changed: verify `SQLite` lock release and read-endpoint responsiveness
- if ORM models or Alembic revisions changed: run `alembic upgrade head` before release
- if the OpenAI-compatible image pipeline changed: run at least `python -m pytest tests/test_image_generation.py`
- if the model registry, provider availability, or selector normalization changed: run `python -m pytest tests/test_chat.py -q -k "mimo_registry or proxy_gpt_matrix or keeps_mimo_default"`
- if the stop pipeline, graph trap doors, or kill-switch wrappers changed: run `python -m pytest tests/test_chat.py tests/test_graph_tools.py tests/test_image_generation.py -q`
- historical migration patches must stay idempotent; do not assume a legacy table or column already exists when hardening an old revision
- recommended migration smoke test:

```powershell
$env:DATABASE_URL = "sqlite:///./tmp_migration_smoke.db"
alembic upgrade head
Remove-Item .\tmp_migration_smoke.db
```

- recommended security-settings regression command after touching auth, admin settings, or middleware:

```powershell
python -m pytest tests/test_chat.py -k "auth_register_and_login or admin_settings_update_bonus_affects_register_and_admin_provisioning or admin_settings_security_controls_apply_dynamic_expiry_and_ip_whitelist"
```

### 10.2 RBAC and admin-governance validation

1. Sign in as `super_admin` and confirm that all admin menu items are visible.
2. Sign in as `operator` and confirm that the default landing route is `/users` and that dashboard or settings entries are not rendered.
3. Sign in as `finance` and confirm that the default landing route is `/tokens` and that user-governance entries are not rendered.
4. Manually open a forbidden route, such as `/dashboard` as `operator`, and confirm that the app redirects to the safe workspace with a toast instead of leaving the page stuck.
5. Change a standard user's role from the admin user center and confirm that:
   - `PATCH /api/v1/admin/users/{user_id}/role` succeeds
   - the user-list badge updates immediately
   - `super_admin` cannot change its own role
   - `super_admin` cannot change another `super_admin`
6. Open the RBAC page and confirm that member counts come from the real summary endpoint instead of mock constants.
7. Confirm that `super_admin` rows remain protected from freeze, password reset, and token adjustment actions.
8. Open the user-row dropdown and confirm that:
   - the table shows `5` rows per page
   - the dropdown contains detail, password, role, token, freeze, and delete actions
   - there is no exposed placeholder edit action in the visible menu
9. Trigger password reset for a mutable account and confirm that:
   - `POST /api/v1/admin/users/{user_id}/reset-password` succeeds
   - the returned password is exactly `12345678`
   - existing sessions are revoked as part of the reset response
10. Delete a mutable non-`super_admin` account and confirm that:
   - `DELETE /api/v1/admin/users/{user_id}` succeeds
   - the row disappears from the current page and pagination stays stable
   - the audit page renders a `delete_user` event with a readable summary
11. Open `/tokens` as `finance` or `super_admin` and confirm that KPI cards come from the live stats endpoint, keyword filtering is debounced, and pagination keeps row counts aligned with the backend total.
12. Open the create-user modal and confirm that:
   - it is centered instead of using a side drawer
   - the visible form only includes `username`, `password`, and `role`
   - the request payload sent to `POST /api/v1/admin/users` contains only those three fields
13. Open `/templates` in the admin workspace and confirm that:
   - editing a shared template calls `PATCH /api/v1/admin/templates/{template_id}`
   - preset and custom templates both expose edit, delete, and batch-selection affordances
   - create and edit both use the centered template modal rather than a side drawer
   - the modal exposes the `is_preset` switch and no longer renders the earlier knowledge-base input
   - UI-only helper fields such as industry classification do not leak into the backend payload
   - single delete requires confirmation and removes the shared template
   - batch delete clears selected cards and refreshes the list
   - deleting a seeded preset template keeps it hidden after a refresh instead of auto-reseeding it into the grid
14. Open the audit-log workspace and confirm that:
   - the default page size is fixed at `5`
   - pagination, filters, and the detail panel stay consistent as you move through results
   - `update_system_settings` rows open a right-side drawer with readable before/after diff blocks
   - non-settings rows still show their structured audit JSON in the same drawer
15. Update any system setting and confirm that:
   - the bell notification center receives a new message
   - the audit list records an `update_system_settings` event
   - the detail drawer shows the structured diff payload
16. Trigger rollback from a system-setting audit snapshot and confirm that:
   - the setting value is restored
   - a `rollback_system_settings` audit row is created
   - the notification center shows a rollback message
17. Open the storage-governance workspace and confirm that:
   - total usage, distribution, and user rankings come from live aggregation endpoints
   - file sizes are rendered as `KB / MB / GB / TB` instead of raw bytes
18. Open the admin users, token ledger, and template library pages and confirm that:
   - local search inputs clear and resync with URL state correctly
   - the template-library search control stays fixed-width and does not collapse the tab bar

### 10.3 Billing and multimodal validation

1. Freeze a standard user and confirm that the active session is revoked.
2. Perform `add / deduct / set` token operations and confirm balance and ledger consistency.
3. Run a multimodal task and confirm that token usage is split across real per-model `TokenTransaction` rows.
4. Set a standard user balance to `0`, call `POST /api/v1/media/chat/stream`, and confirm `402 INSUFFICIENT_TOKENS`.
5. Run a long task with a low-balance standard user and confirm that final balance does not fall below `0`.

## 11. Commit Convention

This repository uses Conventional Commits:

- `feat:` new user-facing capability or feature expansion
- `fix:` bug fix
- `refactor:` internal structural change without intended external behavior change
- `docs:` documentation-only change
- `test:` test addition or test adjustment
- `chore:` maintenance work

Example:

```text
feat: 打通系统设置回滚链路与后台治理工作台
```

When a changeset contains both feature code and documentation updates, choose the type based on the primary engineering impact. For the current admin RBAC and routing work, `feat:` is the correct type.
