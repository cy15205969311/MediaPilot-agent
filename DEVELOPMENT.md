# MediaPilot Agent Development Guide

Last updated: `2026-05-03`

`MediaPilot-agent` is the repository name. Some runtime labels, API titles, and legacy code paths may still reference `OmniMedia Agent`. Both names describe the same product: a shared AI content platform with a creator workspace and an admin console.

`README.md` is the Chinese engineering guide. `DEVELOPMENT.md` must remain English-only.

## 1. Purpose

Use this document when you need to:

- understand the current repository topology
- develop backend APIs in `app/`
- work on the creator workspace in `frontend/`
- work on the admin console in `omnimedia-admin-web/`
- validate auth, streaming, uploads, knowledge, billing, and admin-governance behavior
- prepare changes for review, commit, and push

## 2. Product Architecture

The repository contains one shared backend and two web clients:

- `app/`: shared `FastAPI` backend for auth, sessions, streaming chat, thread history, uploads, knowledge base, topics, templates, dashboards, admin operations, and token ledgers
- `frontend/`: creator workspace for generation, drafting, multimodal input, artifact viewing, history, profile management, and security settings
- `omnimedia-admin-web/`: admin console for operator authentication, dashboard views, user governance, account-status control, and token operations
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

### 7.2 Admin token operations

Admin token adjustment uses explicit action-based commands instead of signed deltas:

- `add`
- `deduct`
- `set`

The request contract requires:

- `action`
- `amount`
- `remark`

The admin UI exposes an action switcher, quick-pack inputs, preview metrics, and required audit remarks.

### 7.3 Multimodal token accounting

The billing flow tracks real model usage across multimodal workflows:

- provider stream chunks may emit usage
- artifact-structuring calls contribute their own usage
- vision preprocessing nodes record usage independently
- `GraphState` carries `token_usage` as a `{model_name: token_count}` map
- final billing inserts one `TokenTransaction` row per model instead of estimating usage from output text

### 7.4 Provider usage propagation fix

The current provider baseline includes explicit usage propagation safeguards:

- stream-based provider calls attempt `stream_options={"include_usage": True}`
- `OpenAIProvider`, `CompatibleLLMProvider`, and `QwenLLMProvider` emit accumulated `token_usage` in the final `done` event
- warning logs surface when upstream rejects `include_usage` or when a request still ends without tracked usage
- `agent.py` logs the final `token_usage` payload before ledger persistence

### 7.5 SQLite transaction isolation

Because `SQLite` uses coarse-grained write locks, write paths must remain short-lived:

- no streaming response should hold an open write transaction for the full generation lifecycle
- final token-ledger writes use a dedicated `SessionLocal()` session
- billing code performs `commit`, `rollback`, and `close` inside the ledger helper
- read-heavy endpoints such as thread history, dashboards, and admin lists must not block behind a lingering write lock

### 7.6 Commercial token lifecycle

The product currently follows a first-pass prepaid token model:

- user registration grants `10_000_000` initial tokens
- registration writes both the `User` row and a matching `TokenTransaction(transaction_type="grant")` row in one transaction
- the creator workspace profile UI exposes a token asset panel for standard users
- the top-up entry remains a placeholder until payment integration is introduced

### 7.7 Pre-flight balance enforcement

The media chat entrypoint performs a balance check before any expensive workflow begins:

- standard users with `token_balance <= 0` receive `402 INSUFFICIENT_TOKENS`
- the request is rejected before LangGraph execution and before any model-provider call
- the frontend turns this into a commercial insufficient-balance prompt instead of a silent failure

### 7.8 Privileged account bypass

Management accounts follow a different billing policy:

- `super_admin` and `admin` bypass the pre-flight balance block
- the final token-ledger deduction step also skips those roles
- privileged accounts can keep generating even when their stored balance is `0`
- privileged runs do not create normal consumption ledger rows
- the creator workspace renders these accounts as an unlimited-credit state

### 7.9 Runtime generation budget guard

This update adds a stronger generation-time quota guard for standard users:

- `MediaChatRequest` now includes an internal `max_generation_tokens` field
- `app/services/agent.py` computes a runtime generation budget from the current user balance before calling the effective provider
- the budget is injected only for non-privileged users
- `app/services/providers.py` forwards the budget into compatible provider calls as `max_tokens`

The goal is to reduce over-generation before the final ledger step, not only after the fact.

### 7.10 Zero-floor billing protection

This update also hardens final token deduction:

- final ledger deduction now follows a zero-floor balance rule
- user balances can no longer become negative in the database
- the ledger records the actual billable deduction, not a theoretical overdraft amount
- for multimodel runs, the actual deducted total is allocated back across model rows so the ledger stays auditable per model

Even if an upstream provider does not perfectly respect `max_tokens`, the persistence layer now guarantees that balances do not fall below zero.

### 7.11 Admin latest-session activity telemetry

The admin user list now exposes real session-based recent-activity data:

- `GET /api/v1/admin/users` includes `latest_session` for each returned user
- `latest_session` currently contains:
  - `device_info`
  - `ip_address`
  - `last_seen_at`
  - `created_at`
- the backend selects the newest `RefreshSession` row per user for the current page
- the admin console renders real device information and relative activity time instead of a placeholder
- the same session summary is also shown in the user detail drawer

### 7.12 Admin user-center hardening

The admin user center follows a stricter governance baseline:

- the admin user list API returns `avatar_url` so the console can render real profile images
- the admin search box uses debounced synchronization and restores the full list when the keyword is cleared
- a shared `UserAvatar` component prefers the backend image URL and falls back to an initial badge when the image is missing or fails to load
- `super_admin` targets are protected on both backend and frontend:
  - backend rejects status changes, password resets, and token adjustments
  - frontend keeps those rows view-only and surfaces a protection notice in the detail drawer
- `super_admin` and `admin` accounts are displayed as unlimited-balance accounts in the console
- row-level floating action menus were removed in favor of the right-side detail drawer to avoid clipping caused by table `overflow`

### 7.13 Creator upload capture UX

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

### 7.14 Creator artifact asset matrix and contextual handoff

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

### 7.15 Billing diagnostics

Current diagnostics now include:

- provider warnings when usage is missing
- final `token_usage` logging in `agent.py` before ledger persistence
- skipped-ledger logging that includes the raw `token_usage` payload
- ledger success logging that now includes both `requested_total` and `billed_total`

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

### 8.2 Layering rules

- `app/api/` should focus on request validation, auth dependencies, response models, and HTTP status handling
- `app/services/` should own business logic, orchestration, parsing, providers, and persistence helpers
- `app/db/` should own engine setup, sessions, ORM models, and migration-safe schema helpers
- `app/models/` should own Pydantic schemas and shared API contracts

Avoid moving database-heavy orchestration into route files when a service abstraction is more appropriate.

## 9. API Surface Summary

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

### 9.2 Media workflow endpoints

- `POST /api/v1/media/chat/stream`
- `GET /api/v1/media/threads`
- `GET /api/v1/media/threads/{thread_id}/messages`
- `PATCH /api/v1/media/threads/{thread_id}`
- `DELETE /api/v1/media/threads/{thread_id}`
- `GET /api/v1/media/artifacts`
- `POST /api/v1/media/upload`
- `GET /api/v1/media/dashboard/summary`
- `GET /api/v1/models/available`

### 9.3 Knowledge, templates, and topics

- `GET /api/v1/media/templates`
- `POST /api/v1/media/templates`
- `DELETE /api/v1/media/templates/{template_id}`
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
- `POST /api/v1/admin/users/{user_id}/status`
- `POST /api/v1/admin/users/{user_id}/reset-password`
- `POST /api/v1/admin/users/{user_id}/tokens`
- `GET /api/v1/admin/dashboard`

## 10. Validation Checklist

Validate the areas you changed before pushing.

### 10.1 General checks

- backend syntax check: `python -m compileall app`
- creator workspace build or targeted validation when `frontend/` changes
- admin console build or targeted validation when `omnimedia-admin-web/` changes
- API contract compatibility for any schema changes
- transaction safety for any `SQLite` write-path change

### 10.2 Current high-priority checks

1. Freeze a standard user from the admin console and confirm forced logout behavior.
2. Adjust tokens with `add`, `deduct`, and `set`, then confirm balance changes and ledger rows.
3. Run an audio, image, or video generation flow and confirm model-specific `TokenTransaction` rows are created.
4. Verify `GET /api/v1/media/threads` still returns promptly after streaming generation completes.
5. If usage is still missing, inspect logs for:
   - `include_usage rejected`
   - `agent.stream final token_usage ...`
   - `agent.stream token_ledger skipped ...`
6. Set a standard user balance to `0` and confirm `POST /api/v1/media/chat/stream` returns `402 INSUFFICIENT_TOKENS`.
7. Set a small standard-user balance, trigger a larger generation, and confirm:
   - the request uses the runtime generation budget
   - the final database balance never becomes negative
   - the ledger writes only the actual billed deduction
8. Verify an `admin` or `super_admin` account can still generate with balance `0` and does not produce normal consumption rows.
9. Open the admin user center and confirm:
   - real `avatar_url` values render actual images
   - the search box auto-restores the full list when cleared
   - `super_admin` rows expose no destructive controls
   - latest-session activity now renders real device and time data instead of a placeholder
10. Open the user detail drawer and confirm the recent-activity summary matches the table row.
11. Validate the upgraded creator upload entry:
   - paste a screenshot into the composer with `Ctrl+V`
   - drag a supported file onto the composer
   - try an unsupported extension
   - try an oversized file
12. Validate the creator artifact matrix:
   - generate a content draft, then verify the right panel shows the draft under its local artifact tab
   - generate another artifact type in the same thread and confirm the panel now exposes multiple tabs
   - switch the global task selector and confirm previously generated artifacts remain available

## 11. Commit Convention

Use Conventional Commits:

- `feat:` for features
- `fix:` for bug fixes
- `refactor:` for behavior-preserving restructuring
- `docs:` for documentation-only changes
- `test:` for test changes
- `chore:` for maintenance work

Example:

```text
feat: harden token billing safeguards and surface admin session activity
```

When code and documentation move together in one feature delivery, prefer the commit type that describes the primary engineering outcome. For the current change set, `feat:` is the correct choice.
