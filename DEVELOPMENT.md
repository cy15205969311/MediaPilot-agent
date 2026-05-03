# MediaPilot Agent Development Guide

Last updated: `2026-05-03`

This document is the engineering baseline for the `MediaPilot-agent` repository. The GitHub repository name is `MediaPilot-agent`, while many runtime names, API titles, and code identifiers still use `OmniMedia Agent`. Both names refer to the same system.

## 1. Purpose

Use this document when you need to:

- understand the repository layout and local runtime topology
- add or change backend API contracts
- update persistence, storage, or knowledge-base behavior
- work on the creator workspace in `frontend/`
- work on the admin console in `omnimedia-admin-web/`
- validate changes before opening a pull request or pushing to `main`

`README.md` is the Chinese onboarding and operator-facing document. `DEVELOPMENT.md` is the English engineering baseline and must remain English-only.

## 2. System Overview

MediaPilot Agent is an AI-assisted content operations platform with two separate web clients backed by one `FastAPI` service:

- `frontend/`: the main creator workspace used for content generation, knowledge retrieval, templates, topics, drafts, and dashboard workflows
- `omnimedia-admin-web/`: the admin console used for operator login, dashboard views, and user management operations
- `app/`: the shared backend that provides auth, chat streaming, history, uploads, knowledge base, templates, topics, dashboard data, model registry, and admin user operations

The backend defaults to:

- `SQLite` for persistence
- local `uploads/` for managed file storage
- optional `OSS` when full object-storage configuration is available
- `LangGraph` orchestration for multimodal content workflows

## 3. Repository Map

```text
MediaPilot-agent/
|- app/
|  |- api/v1/                # FastAPI route modules
|  |- db/                    # SQLAlchemy engine, sessions, ORM models
|  |- models/                # Pydantic request/response schemas
|  |- services/              # Auth, providers, graph, storage, parser, scheduler
|  |- config.py              # Environment loading helpers
|  '- main.py                # FastAPI app entrypoint
|- alembic/                  # Database migrations
|- frontend/                 # Main creator workspace
|  |- e2e/                   # Playwright tests
|  '- src/
|- omnimedia-admin-web/      # Admin console
|  '- src/
|- extension/                # Optional browser extension assets
|- tests/                    # Backend pytest suite
|- uploads/                  # Local managed uploads
|- .env.example              # Sample environment configuration
|- requirements.txt          # Python dependency lock list
|- README.md                 # Chinese project guide
'- DEVELOPMENT.md            # English engineering guide
```

## 4. Runtime Topology

### 4.1 Backend

- entrypoint: `app/main.py`
- default address: `http://127.0.0.1:8000`
- docs: `http://127.0.0.1:8000/docs`
- health: `GET /health`

The backend loads `.env` at startup, creates database tables, runs startup migrations, starts the scheduler, configures CORS, and mounts `/uploads` as a static file directory.

### 4.2 Main workspace

- directory: `frontend/`
- dev server: `http://127.0.0.1:5173`
- Vite proxy targets:
  - `/api -> http://127.0.0.1:8000`
  - `/health -> http://127.0.0.1:8000`
  - `/uploads -> http://127.0.0.1:8000`

### 4.3 Admin console

- directory: `omnimedia-admin-web/`
- dev server: `http://127.0.0.1:5174`
- optional client env vars:
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

### 5.3 Main workspace bootstrap

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

## 6. Environment Configuration

All runtime configuration starts from `.env.example`. Use `.env` for local development and do not commit secrets.

### 6.1 LLM and workflow variables

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
- `SEARCH_TIMEOUT_SECONDS`

### 6.2 Image generation and transcription variables

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
- `IMAGE_PROMPT_TIMEOUT_SECONDS`
- `OPENAI_IMAGE_BASE_URL`
- `OPENAI_IMAGE_API_KEY`
- `OPENAI_IMAGE_MODEL`
- `OPENAI_TRANSCRIPTION_BASE_URL`
- `OPENAI_TRANSCRIPTION_API_KEY`
- `OPENAI_TRANSCRIPTION_MODEL`
- `LLM_TIMEOUT_SECONDS`
- `OPENAI_TIMEOUT_SECONDS`
- `MEDIA_PARSER_DOWNLOAD_TIMEOUT_SECONDS`
- `MEDIA_PARSER_TRANSCRIPTION_TIMEOUT_SECONDS`
- `MEDIA_PARSER_DOCUMENT_MAX_CHARS`
- `MEDIA_PARSER_TRANSCRIPT_MAX_CHARS`

### 6.3 Storage variables

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

### 6.4 Auth and infrastructure variables

- `JWT_SECRET_KEY`
- `JWT_ALGORITHM`
- `JWT_ACCESS_EXPIRE_MINUTES`
- `JWT_REFRESH_EXPIRE_DAYS`
- `JWT_PASSWORD_RESET_EXPIRE_MINUTES`
- `CORS_ALLOWED_ORIGINS`
- `DATABASE_URL`

## 7. Backend Service Boundaries

### 7.1 Route modules

Current route groups under `app/api/v1/`:

- `auth.py`: registration, login, token refresh, logout, password reset, sessions, profile updates
- `users.py`: current user profile
- `chat.py`: streaming chat entrypoint
- `history.py`: threads, messages, artifacts
- `knowledge.py`: knowledge scopes, uploads, source preview, source deletion
- `templates.py`: template CRUD and skill search
- `topics.py`: topic CRUD
- `dashboard.py`: dashboard summary
- `models.py`: available model registry
- `oss.py`: file upload and retention metrics
- `admin_users.py`: admin user listing, status changes, password reset, token adjustments

### 7.2 Service responsibilities

The expected layering is:

- `app/api/`: request validation, auth dependencies, response assembly, and status codes only
- `app/models/`: Pydantic contracts and shared schema normalization
- `app/db/`: engine configuration, sessions, ORM models
- `app/services/`: business logic, providers, graph orchestration, parsing, storage, scheduler, persistence helpers

Avoid embedding database-heavy logic directly inside route modules when a service abstraction already exists or should exist.

## 8. API Surface

### 8.1 Public and auth endpoints

- `GET /`
- `GET /health`
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

### 8.2 Creator workspace endpoints

- `POST /api/v1/media/chat/stream`
- `GET /api/v1/media/threads`
- `GET /api/v1/media/threads/{thread_id}/messages`
- `PATCH /api/v1/media/threads/{thread_id}`
- `DELETE /api/v1/media/threads/{thread_id}`
- `GET /api/v1/media/artifacts`
- `DELETE /api/v1/media/artifacts/{message_id}`
- `DELETE /api/v1/media/artifacts`
- `POST /api/v1/media/upload`
- `GET /api/v1/media/retention`
- `GET /api/v1/media/dashboard/summary`
- `GET /api/v1/models/available`

### 8.3 Templates, topics, and knowledge base endpoints

- `GET /api/v1/media/templates`
- `POST /api/v1/media/templates`
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
- `GET /api/v1/media/knowledge/scopes/{scope_name}/sources`
- `GET /api/v1/media/knowledge/scopes/{scope_name}/sources/{source_name}/preview`
- `DELETE /api/v1/media/knowledge/scopes/{scope_name}/sources/{source_name}`

### 8.4 Admin endpoints

- `GET /api/v1/admin/users`
- `POST /api/v1/admin/users/{user_id}/status`
- `POST /api/v1/admin/users/{user_id}/reset-password`
- `POST /api/v1/admin/users/{user_id}/tokens`

Access to admin endpoints is role-protected. The current admin role gate includes `super_admin`, `admin`, and `operator`.

## 9. Persistence Model

Primary ORM entities in `app/db/models.py`:

- `User`
- `TokenTransaction`
- `Thread`
- `Message`
- `Material`
- `ArtifactRecord`
- `Template`
- `TopicRecord`
- `UploadRecord`
- `RefreshSession`
- `AccessTokenBlacklist`

Persistence rules:

- all user-owned data must remain isolated by ownership
- backend schema changes must be accompanied by an `Alembic` migration unless there is a documented exception
- time fields should remain UTC-based
- frontend types must be updated whenever stable response contracts change

## 10. Streaming Contract

`POST /api/v1/media/chat/stream` is an `SSE` endpoint.

Stable event types currently expected by the main frontend:

- `start`
- `message`
- `tool_call`
- `artifact`
- `error`
- `done`

Frontend obligations:

- handle partial message accumulation correctly
- surface stream failures explicitly
- remove empty placeholder bubbles if no assistant-visible content was produced
- update the right-side artifact panel when `artifact` arrives
- preserve stop-generation behavior through `AbortController`

## 11. Storage and Upload Lifecycle

Upload entrypoint: `POST /api/v1/media/upload`

Storage modes:

- `local`: always store managed files under `uploads/`
- `oss`: require full `OSS` configuration and fail fast when incomplete
- `auto`: prefer `OSS` when configuration is complete, otherwise fall back to local storage

File lifecycle expectations:

- unbound uploads may start in a temporary prefix
- uploads should be promoted once attached to a durable thread or artifact flow
- signed URLs must be generated on demand instead of being persisted as permanent data
- history replay should rebuild usable asset URLs for managed content
- lifecycle rollout jobs and cleanup jobs are scheduled from backend startup

## 12. Knowledge Base Pipeline

The knowledge-base feature is scope-based and user-scoped.

Supported source types include:

- `.txt`
- `.md`
- `.markdown`
- `.pdf`
- `.docx`
- `.csv`
- `.xlsx`

Expected behavior:

- uploads are grouped by `scope`
- source preview is available through API
- deleting a source should delete its derived knowledge records
- renaming a scope should keep user-facing bindings coherent
- retrieval results may include citation metadata that the main frontend renders in the citation audit panel

## 13. Frontend Responsibilities

### 13.1 Main workspace

Key views under `frontend/src/app/components/views/`:

- `DashboardView.tsx`
- `DraftsView.tsx`
- `KnowledgeView.tsx`
- `TemplatesView.tsx`
- `TopicsView.tsx`

Key shared components:

- `ChatFeed.tsx`
- `RightPanel.tsx`
- `Composer.tsx`
- `ModelSelector.tsx`
- `ArtifactSection.tsx`
- `CitationAuditPanel.tsx`
- `ThreadSettingsModal.tsx`
- `UserProfileModal.tsx`

Rules:

- `frontend/src/app/api.ts` is the main network boundary
- artifact rendering and export behavior should stay consistent with backend schema changes
- user-visible workspace copy is expected to remain Chinese-first

### 13.2 Admin console

Key pages under `omnimedia-admin-web/src/pages/`:

- `Login.tsx`
- `AdminDashboardPage.tsx`
- `AdminUsersPage.tsx`
- `AdminPlaceholderPage.tsx`

Shared admin components:

- `AdminLayout.tsx`
- `AuthGuard.tsx`
- `ToastViewport.tsx`

Rules:

- admin UI changes must keep API alignment with `/api/v1/admin/*`
- if admin layout structure changes, verify sidebar locking, scroll containment, and overflow behavior
- when user-management contracts change, update both the admin UI and the backend schema layer

## 14. Testing Matrix

### 14.1 Backend

Command:

```powershell
python -m pytest -q
```

Current backend test suite files under `tests/` include:

- `test_chat.py`
- `test_config.py`
- `test_graph_search.py`
- `test_graph_tools.py`
- `test_graph_vision.py`
- `test_image_generation.py`
- `test_knowledge_base.py`
- `test_media_parser.py`
- `test_oss.py`
- `test_oss_client.py`
- `test_qwen_provider.py`
- `test_scheduler.py`

### 14.2 Main workspace

Commands:

```powershell
cd frontend
npm run build
npm run test:e2e
npx playwright test --ui
```

Current Playwright files:

- `e2e/auth.spec.ts`
- `e2e/chat.spec.ts`

### 14.3 Admin console

Commands:

```powershell
cd omnimedia-admin-web
npm run build
npm run lint
```

The admin console does not yet have a dedicated end-to-end test suite in this repository. Treat build and lint as the minimum gate until browser coverage is added.

## 15. Documentation Expectations

Update `README.md` and `DEVELOPMENT.md` whenever a change affects:

- developer onboarding
- local setup
- environment variables
- repository structure
- API groups
- storage behavior
- knowledge-base behavior
- admin console behavior
- test commands or quality gates

Keep `README.md` Chinese-first. Keep `DEVELOPMENT.md` English-only.

## 16. Commit Convention

Use Conventional Commit style for all work.

Recommended formats:

- `feat(scope): add a user-visible capability`
- `fix(scope): correct a regression or defect`
- `refactor(scope): improve structure without changing behavior`
- `docs(scope): update documentation only`
- `test(scope): add or adjust automated tests`

Examples:

- `feat(admin): add user token adjustment workflow`
- `fix(chat): preserve artifact rendering after stream retry`
- `docs(readme): refresh setup and architecture guidance`

When a documentation update is part of shipping a feature, a `feat(...)` commit with a clear subject and a detailed body is acceptable.

## 17. Change Checklist

Before pushing:

1. verify which files are yours and do not revert unrelated work in a dirty tree
2. update schemas and frontend types if API contracts changed
3. add migrations if persistence changed
4. run the smallest meaningful validation set for the files you touched
5. update both root documents if developer-facing behavior changed
6. write a precise Conventional Commit message

If you cannot run validation, say so explicitly in the final handoff or commit notes.
