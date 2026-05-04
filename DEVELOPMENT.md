# MediaPilot Agent Development Guide

Last updated: `2026-05-03`

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
- `TAVILY_API_KEY`

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

- registration grants `10_000_000` initial tokens
- registration writes both the `User` row and a matching `TokenTransaction(transaction_type="grant")` row in one transaction
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
- `super_admin` targets are protected on both backend and frontend:
  - backend rejects status changes, password resets, and token adjustments
  - frontend keeps those rows view-only and surfaces a protection notice in the detail drawer
- `super_admin` and `admin` accounts are displayed as unlimited-balance accounts in the console
- row-level floating action menus were removed in favor of the right-side detail drawer to avoid clipping caused by table `overflow`

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

- `omnimedia-admin-web/src/pages/AdminTemplatesPage.tsx` supports create, edit, single delete, multi-select, and batch delete
- shared-template mutations are backed by `app/api/v1/admin_templates.py`
- the admin page uses one shared drawer for both create and edit states
- deleting shared templates requires an explicit confirmation dialog
- bulk selection uses an animated action bar with a foreground `z-index` so it stays readable above the card grid

The creator-side local template center was also extended:

- `PATCH /api/v1/media/templates/{template_id}` updates user-owned templates
- `DELETE /api/v1/media/templates` performs validated batch deletion using SQLAlchemy `delete(...)`
- preset templates remain immutable on both the creator and admin surfaces

### 7.17 Admin user provisioning modal

The create-user entry in `omnimedia-admin-web/src/pages/AdminUsersPage.tsx` has been refocused into a compact centered modal:

- payload is intentionally limited to `username`, `password`, and `role`
- the password field supports inline random generation and clipboard copy
- role assignment uses card-based single selection instead of a dropdown
- the modal uses a bounded height with internal scrolling so it does not feel full-screen on shorter viewports
- the bottom banner explains that the backend will automatically grant the initial token asset or unlimited quota according to role and record the action in audit history

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
- `admin_tokens.py`
- `admin_templates.py`
- `admin_audit_logs.py`

### 8.2 Layering rules

- `app/api/` handles request validation, dependency injection, HTTP status codes, and response models
- `app/services/` handles workflows, providers, parsing, storage, and business logic
- `app/db/` handles the engine, sessions, ORM models, and migration compatibility
- `app/models/` handles Pydantic schemas and shared API contracts

Avoid pushing long-lived business orchestration and complex data-access code into the route layer.

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
- `GET /api/v1/admin/transactions`
- `GET /api/v1/admin/transactions/stats`
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
8. Open `/tokens` as `finance` or `super_admin` and confirm that KPI cards come from the live stats endpoint, keyword filtering is debounced, and pagination keeps row counts aligned with the backend total.
9. Open the create-user modal and confirm that:
   - it is centered instead of using a side drawer
   - the visible form only includes `username`, `password`, and `role`
   - the request payload sent to `POST /api/v1/admin/users` contains only those three fields
10. Open `/templates` in the admin workspace and confirm that:
   - editing a shared template calls `PATCH /api/v1/admin/templates/{template_id}`
   - single delete requires confirmation and removes the shared template
   - batch delete clears selected cards and refreshes the list

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
feat: enforce role-aware admin workspaces and aggregate live role membership
```

When a changeset contains both feature code and documentation updates, choose the type based on the primary engineering impact. For the current admin RBAC and routing work, `feat:` is the correct type.
