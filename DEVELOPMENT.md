# MediaPilot Agent Development Guide

Last updated: `2026-05-03`

This document is the engineering baseline for the `MediaPilot-agent` repository. The repository name is `MediaPilot-agent`, while several runtime labels, API titles, and internal identifiers still use `OmniMedia Agent`. Both names refer to the same product.

## 1. Scope

Use this document when you need to:

- understand the repository layout and runtime topology
- develop backend APIs in `app/`
- work on the creator workspace in `frontend/`
- work on the admin console in `omnimedia-admin-web/`
- validate persistence, auth, storage, or multimodal workflow changes
- prepare changes for review, commit, and push

`README.md` is the Chinese development and onboarding guide. `DEVELOPMENT.md` must remain English-only.

## 2. Product Architecture

The repository contains one shared backend and two web clients:

- `app/`: shared `FastAPI` backend for auth, sessions, streaming chat, history, uploads, knowledge base, templates, topics, dashboards, admin operations, and token ledgers
- `frontend/`: creator workspace for generation, drafting, knowledge retrieval, security settings, history, and user-facing workflows
- `omnimedia-admin-web/`: admin console for operator authentication, dashboard views, user management, account status control, and token operations
- `extension/`: reserved area for browser extension or publishing-assist tooling

Default local infrastructure:

- `SQLite` for persistence
- `uploads/` for local file storage
- optional `OSS` integration for object storage
- `LangGraph` for multimodal workflow orchestration

## 3. Repository Map

```text
MediaPilot-agent/
|- app/
|  |- api/v1/                # FastAPI route modules
|  |- db/                    # Engine, sessions, ORM models
|  |- models/                # Pydantic schemas
|  |- services/              # Auth, providers, graph, parsing, storage, scheduler
|  |- config.py              # Environment loading helpers
|  '- main.py                # FastAPI application entrypoint
|- alembic/                  # Database migrations
|- frontend/                 # Creator workspace
|  |- e2e/                   # Playwright tests
|  '- src/
|- omnimedia-admin-web/      # Admin console
|  '- src/
|- extension/                # Optional browser extension assets
|- tests/                    # Backend tests
|- uploads/                  # Local uploaded assets
|- .env.example              # Sample configuration
|- requirements.txt          # Python dependency list
|- README.md                 # Chinese guide
'- DEVELOPMENT.md            # English engineering baseline
```

## 4. Runtime Topology

### 4.1 Backend

- entrypoint: `app/main.py`
- default local address: `http://127.0.0.1:8000`
- OpenAPI docs: `http://127.0.0.1:8000/docs`
- health endpoint: `GET /health`

The backend loads `.env`, initializes the database, runs startup migrations, configures CORS, mounts `/uploads`, and starts background jobs when enabled.

### 4.2 Creator workspace

- directory: `frontend/`
- local dev address: `http://127.0.0.1:5173`
- default Vite proxy targets:
  - `/api -> http://127.0.0.1:8000`
  - `/health -> http://127.0.0.1:8000`
  - `/uploads -> http://127.0.0.1:8000`

### 4.3 Admin console

- directory: `omnimedia-admin-web/`
- local dev address: `http://127.0.0.1:5174`
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

Start from `.env.example`. Never commit private keys, secrets, or production endpoints.

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

### 7.1 Account freeze enforcement

The current system enforces account freezing across backend and frontend layers:

- login rejects frozen users with `403 ACCOUNT_FROZEN`
- authenticated requests reject frozen users during token validation
- admin-side freeze actions revoke refresh sessions and invalidate related access tokens
- the creator workspace globally intercepts `ACCOUNT_FROZEN`, clears auth state, aborts active streams, and redirects users back to login

### 7.2 Admin token operations

Admin token adjustment now supports explicit action-based commands instead of signed deltas:

- `add`
- `deduct`
- `set`

The request contract requires:

- `action`
- `amount`
- `remark`

The admin UI has been upgraded to a token operation console with action selection, quick-pack buttons, and result preview.

### 7.3 Multimodal token accounting

The billing flow now tracks real model usage across multimodal workflows:

- provider stream chunks may emit usage
- artifact structuring calls contribute their own usage
- vision preprocessing nodes record usage independently
- `GraphState` carries `token_usage` as a `{model_name: token_count}` map
- final billing inserts one `TokenTransaction` row per model instead of estimating usage from output text

### 7.4 SQLite transaction isolation

Because `SQLite` uses coarse-grained write locks, token ledger writes must stay short-lived:

- the streaming request session remains owned by FastAPI dependency injection
- final token ledger writes use a dedicated `SessionLocal()` session
- billing code performs `commit`, `rollback`, and `close` inside the ledger helper
- no long-lived write transaction should remain open during streaming

This rule is important for preventing thread-history or dashboard reads from blocking behind a lingering write lock.

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
- `app/models/` should own Pydantic schemas and cross-route request or response contracts

Avoid pushing database-heavy logic into route files when a service layer is more appropriate.

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
- `POST /api/v1/admin/users/{user_id}/status`
- `POST /api/v1/admin/users/{user_id}/password-reset`
- `POST /api/v1/admin/users/{user_id}/tokens`
- `GET /api/v1/admin/dashboard`

## 10. Validation Checklist

Before pushing changes, validate the areas you touched:

- backend syntax check: `python -m compileall app`
- creator workspace build or targeted validation if frontend files changed
- admin console build or targeted validation if admin files changed
- API contract compatibility for any schema changes
- transaction safety for any `SQLite` write-path update

Recommended manual checks for the latest feature set:

1. Freeze a user from the admin console and confirm forced logout behavior.
2. Adjust tokens with `add`, `deduct`, and `set`, then confirm ledger records and balance changes.
3. Run a multimodal generation flow and confirm multiple model-specific `TokenTransaction` rows are created.
4. Verify `GET /api/v1/media/threads` still returns promptly after a streaming generation completes.

## 11. Commit Convention

Use Conventional Commits:

- `feat:` for features
- `fix:` for bug fixes
- `refactor:` for behavior-preserving restructuring
- `docs:` for documentation-only changes
- `test:` for test coverage changes
- `chore:` for maintenance work

Example:

```text
feat: strengthen account freeze control and multimodal token billing
```
