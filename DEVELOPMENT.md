# OmniMedia Agent Development Guide

## 1. Document Info

- Document: `DEVELOPMENT.md`
- Current version: `v1.13.8`
- Updated on: `2026-04-28`
- Scope: current repository implementation, including backend gateway, dual-token authentication, password-reset recovery flows, tenant isolation, tracked user-scoped uploads, storage-backend abstraction with local and OSS support, signed delivery URL resolution, managed OSS lifecycle helpers, upload cleanup, scheduled material GC, thread-linked material retention, temporary-object promotion, thread persistence, provider abstraction, LangGraph vision-aware orchestration, search routing, multi-step ReAct-style business-tool execution with provider-level `bind_tools` support, UTC timestamp normalization, user profile management, session visibility, frontend workspace, global dual-theme support, Playwright E2E browser baseline, documentation baseline, and verification baseline

Document set:

- `README.md`: Chinese project overview, quick start, and operational onboarding entrypoint
- `DEVELOPMENT.md`: engineering baseline, contract source of truth, implementation status, and change-control rules

This document is the authoritative engineering baseline for the repository. Contract changes, route changes, persistence changes, frontend/backend interface changes, and important UX interaction changes SHOULD be reflected here in the same change set.

Terminology:

- `MUST`: mandatory requirement for compatibility, correctness, or security
- `SHOULD`: recommended engineering practice
- `MAY`: optional enhancement outside the current hard baseline

## 2. Product Positioning

OmniMedia Agent is a task-oriented content operations workspace for Xiaohongshu and Douyin scenarios. The current product is not treated as a generic chat page. It is a workspace for:

- topic planning
- content generation
- hot-post analysis
- comment reply suggestions
- material upload
- structured artifact review
- authenticated thread-based collaboration

Primary users include content operators, brand marketing teams, personal-IP operators, and agency teams.

## 3. Current Scope

### 3.1 In Scope

The current baseline includes:

1. `FastAPI` backend with `Pydantic v2` contracts.
2. `React + Vite + TypeScript + Tailwind CSS` frontend workspace.
3. JWT-based authentication with access token, refresh token, registration, login, password-reset request/completion, and server-side refresh-session revocation.
4. Per-user thread ownership and tenant isolation.
5. Per-thread dynamic `system_prompt` persistence.
6. Provider-based SSE streaming chat flow.
7. Upload API with whitelist, size limit, and local or OSS-backed storage support.
8. SQLite persistence via SQLAlchemy.
9. Alembic migrations for schema evolution.
10. Thread history replay, rename, archive, and deletion APIs.
11. User profile editing for `nickname`, `bio`, and `avatar_url`.
12. Thread settings editing for persisted `title` and `system_prompt`.
13. UTC-normalized backend timestamps plus frontend local rendering.
14. Frontend login view, password-reset request/reset views, token storage, authenticated request interception, and local user cache sync.
15. Frontend new-thread setup flow with title and persona configuration.
16. Authenticated upload storage under per-user object keys with local `/uploads` fallback.
17. Upload metadata tracking with `UploadRecord`.
18. Avatar orphan-file cleanup after profile updates.
19. Frontend avatar upload and profile-preview sync.
20. LangGraph branching orchestration with real vision-model OCR, structured search routing, mock-or-live web search support, safe degradation, and review/retry control.
21. Thread-linked material upload tracking, backfill, and cleanup on thread deletion.
22. Active session visibility, targeted device revocation, and password-reset-triggered global session invalidation.
23. Hourly scheduled abandoned-material cleanup via APScheduler across the active storage backend.
24. Frontend material attachments are preserved from upload completion through optimistic chat bubbles and `/chat/stream` payloads.
25. Automated backend tests for auth-protected SSE, history isolation, thread prompt updates, profile updates, avatar persistence, upload tracking, cleanup, upload retention, refresh rotation, logout revocation, password-reset recovery, session management, scheduler behavior, and LangGraph branching/search behavior.
26. Frontend chat bubbles can now sync the authenticated user's avatar state and render user-facing avatars in a circular presentation with safe fallback behavior.
27. FastAPI now supports environment-variable-driven CORS origin configuration for local frontend-backend integration.
28. Vite development server now binds to `0.0.0.0` so devices on the same LAN can access the frontend workspace directly.
29. Frontend workspace now supports persisted Light / Dark themes through CSS variables, semantic chat-bubble tokens, and root HTML theme classes.
30. Shared storage client abstraction now supports either local disk or Aliyun OSS uploads, signed delivery URL resolution, temporary-prefix staging, lifecycle helper provisioning, copy-based promotion, and deletion.
31. Playwright end-to-end browser coverage for auth, password reset, logout, new-thread setup, and streamed chat smoke flows.
32. Extensible LangGraph Business Tools architecture with tool-call routing, local Python tool execution, and `<business_tool_context>` injection before drafting.

### 3.2 Out of Scope

The following capabilities are intentionally not production-complete yet:

1. third-party SSO or enterprise identity providers
2. access-token revocation lists, device fingerprints, or organization-wide session-management dashboards
3. production observability, rate limiting, or audit logging
4. deeper external business integrations beyond the current mock Business Tools baseline
5. automated OSS lifecycle rollout hooks, CDN invalidation, multi-bucket governance, or an operator-facing retention control plane
6. real email/SMS delivery for password-reset links and broader account-recovery operations
7. advanced avatar processing such as cropping, compression, and CDN hosting

## 4. Architecture Overview

### 4.1 High-Level Structure

The project uses a frontend-backend separated structure:

- Backend: `FastAPI + Pydantic + SQLAlchemy + Alembic`
- Frontend: `React + Vite + TypeScript + Tailwind CSS`
- Streaming: `SSE`
- Auth: `JWT + passlib`
- Upload storage: local `/uploads` fallback or Aliyun OSS through a shared storage client
- Persistence: `SQLite` by default

### 4.2 Layering Rules

The current layering rules are:

1. `app/api/` handles HTTP routing and response assembly only.
2. `app/models/` is the source of truth for backend contracts.
3. `app/services/` owns business logic, provider orchestration, auth utilities, and persistence helpers.
4. `app/db/` owns SQLAlchemy engine setup and ORM models.
5. `frontend/src/app/api.ts` is the only frontend network boundary.
6. `frontend/src/app/components/` owns UI composition and view logic.
7. `frontend/src/app/components/artifacts/` owns task-specific artifact rendering.

### 4.3 Current Request Flow

Authenticated request flow:

`Frontend UI -> frontend/src/app/api.ts -> Bearer token -> FastAPI route -> ownership check -> persistence write -> workflow -> provider -> SSE / JSON response -> frontend state update`

## 5. Source-Oriented Directory Structure

Generated directories such as `frontend/node_modules/` and `frontend/dist/` are omitted for clarity.

```text
omnimedia-agent/
|- app/
|  |- __init__.py
|  |- main.py
|  |- config.py
|  |- api/
|  |  |- __init__.py
|  |  '- v1/
|  |     |- __init__.py
|  |     |- auth.py
|  |     |- chat.py
|  |     |- history.py
|  |     '- oss.py
|  |- models/
|  |  |- __init__.py
|  |  '- schemas.py
|  |- db/
|  |  |- __init__.py
|  |  |- database.py
|  |  '- models.py
|  '- services/
|     |- __init__.py
|     |- agent.py
|     |- auth.py
|     |- oss_client.py
|     |- persistence.py
|     |- providers.py
|     |- scheduler.py
|     '- graph/
|        |- __init__.py
|        '- provider.py
|- alembic/
|  |- env.py
|  '- versions/
|     |- 20260424_01_initial.py
|     |- 20260424_02_thread_management_and_artifacts.py
|     |- 20260424_03_auth_and_persona.py
|     |- 20260425_01_user_profile_fields.py
|     |- 20260425_02_user_avatar_url.py
|     |- 20260425_03_upload_record_tracking.py
|     |- 20260425_04_refresh_session_revocation.py
|     |- 20260425_05_upload_record_thread_binding.py
|     '- 20260425_06_refresh_session_metadata.py
|- frontend/
|  |- index.html
|  |- package-lock.json
|  |- package.json
|  |- pnpm-lock.yaml
|  |- vite.config.ts
|  '- src/
|     |- main.tsx
|     |- styles/
|     |  '- theme.css
|     '- app/
|        |- App.tsx
|        |- ThemeContext.tsx
|        |- api.ts
|        |- data.ts
|        |- types.ts
|        |- utils.ts
|        '- components/
|           |- AppHeader.tsx
|           |- ArtifactSection.tsx
|           |- ChatFeed.tsx
|           |- Composer.tsx
|           |- CopyButton.tsx
|           |- LeftSidebar.tsx
|           |- RightPanel.tsx
|           |- ThreadSettingsModal.tsx
|           |- UserProfileModal.tsx
|           '- artifacts/
|              |- CommentReplyArtifact.tsx
|              |- ContentGenerationArtifact.tsx
|              |- HotPostAnalysisArtifact.tsx
|              '- TopicPlanningArtifact.tsx
|- tests/
|  |- test_chat.py
|  |- test_config.py
|  |- test_graph_search.py
|  |- test_graph_vision.py
|  |- test_oss.py
|  |- test_oss_client.py
|  '- test_scheduler.py
|- uploads/
|- .env.example
|- .gitignore
|- omnimedia_agent.db
|- alembic.ini
|- requirements.txt
'- README.md
'- DEVELOPMENT.md
```

## 6. Technology Stack

### 6.1 Backend

- `fastapi==0.109.2`
- `uvicorn==0.27.1`
- `pydantic==2.13.3`
- `python-multipart==0.0.9`
- `httpx==0.27.2`
- `alembic==1.16.5`
- `openai==2.32.0`
- `pytest==8.3.5`
- `SQLAlchemy==2.0.49`
- `python-dotenv==1.0.1`
- `langgraph==1.1.9`
- `langchain-core==1.3.1`
- `PyJWT==2.10.1`
- `passlib[bcrypt]==1.7.4`
- `bcrypt==4.0.1`
- `APScheduler==3.10.4`
- `oss2==2.19.1`

### 6.2 Frontend

- `react==18.3.1`
- `react-dom==18.3.1`
- `vite==6.3.5`
- `typescript==5.8.3`
- `tailwindcss==4.1.12`
- `@tailwindcss/vite==4.1.12`
- `lucide-react==0.487.0`
- `@playwright/test==1.59.1`

## 7. Environment and Startup

### 7.1 Backend

- Python `3.11+` recommended
- Root `.env` is auto-loaded when present

Current supported runtime variables:

- `DATABASE_URL`
- `JWT_SECRET_KEY`
- `JWT_ALGORITHM`
- `JWT_EXPIRE_MINUTES`
- `JWT_ACCESS_EXPIRE_MINUTES`
- `JWT_REFRESH_EXPIRE_DAYS`
- `JWT_PASSWORD_RESET_EXPIRE_MINUTES`
- `OMNIMEDIA_LLM_PROVIDER=mock|openai|compatible|langgraph|auto`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `OPENAI_ARTIFACT_MODEL`
- `OPENAI_VISION_MODEL`
- `OPENAI_TIMEOUT_SECONDS`
- `LANGGRAPH_INNER_PROVIDER=mock|openai|compatible`
- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_MODEL`
- `LLM_ARTIFACT_MODEL`
- `LLM_VISION_MODEL`
- `LLM_TIMEOUT_SECONDS`
- `TAVILY_API_KEY`
- `SEARCH_TIMEOUT_SECONDS`
- `CORS_ALLOWED_ORIGINS`
- `OMNIMEDIA_STORAGE_BACKEND=auto|local|oss`
- `OSS_ACCESS_KEY_ID`
- `OSS_ACCESS_KEY_SECRET`
- `OSS_ENDPOINT`
- `OSS_BUCKET_NAME`
- `OSS_REGION`
- `OSS_PUBLIC_BASE_URL`
- `OSS_SIGNED_URL_EXPIRE_SECONDS`
- `OSS_TMP_UPLOAD_EXPIRE_DAYS`
- `OSS_THREAD_UPLOAD_TRANSITION_DAYS`
- `OSS_THREAD_UPLOAD_TRANSITION_STORAGE_CLASS`

The committed `.env.example` now includes:

- provider selection defaults for `LangGraphProvider`
- text-model and artifact-model placeholders
- vision-model placeholders for multimodal OCR
- optional Tavily search placeholders for real-time web retrieval
- optional OSS storage placeholders with `auto`, `local`, and `oss` backend selection
- signed delivery URL and lifecycle tuning placeholders for OSS production rollouts
- password-reset token lifetime placeholder for local development
- local SQLite and JWT defaults for development

Current compatible-provider example:

```env
OMNIMEDIA_LLM_PROVIDER=compatible
LLM_API_KEY=your_dashscope_api_key
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen3.5-flash
LLM_ARTIFACT_MODEL=qwen3.5-flash
OPENAI_TIMEOUT_SECONDS=60
OMNIMEDIA_STORAGE_BACKEND=auto
OSS_SIGNED_URL_EXPIRE_SECONDS=3600
OSS_TMP_UPLOAD_EXPIRE_DAYS=3
OSS_THREAD_UPLOAD_TRANSITION_DAYS=30
OSS_THREAD_UPLOAD_TRANSITION_STORAGE_CLASS=IA
JWT_SECRET_KEY=change-this-secret-in-production
JWT_ALGORITHM=HS256
JWT_ACCESS_EXPIRE_MINUTES=30
JWT_REFRESH_EXPIRE_DAYS=7
JWT_PASSWORD_RESET_EXPIRE_MINUTES=15
```

Install:

```bash
pip install -r requirements.txt
```

Run:

```bash
uvicorn app.main:app --reload
```

Local frontend-backend integration rule:

- `app/main.py` MUST register `CORSMiddleware` immediately after `FastAPI(...)` initialization and before any router registration
- local development origins default to `http://localhost:5173` and `http://127.0.0.1:5173`
- `CORS_ALLOWED_ORIGINS` MAY override and extend local development origins through a comma-separated environment variable
- `allow_credentials` remains enabled so authenticated frontend requests can carry tokens or cookies when needed

### 7.2 Frontend

- Node.js `18+` recommended
- Vite dev server currently binds to `0.0.0.0` for same-LAN access

Install:

```bash
cd frontend
npm install
```

Run:

```bash
npm run dev
```

### 7.3 Access Points

- Frontend workspace: `http://127.0.0.1:5173`
- Frontend workspace on LAN host: `http://<your-lan-ip>:5173`
- Backend root info: `http://127.0.0.1:8000/`
- Backend health: `http://127.0.0.1:8000/health`
- Backend docs: `http://127.0.0.1:8000/docs`

### 7.4 Alembic Workflow

After changing SQLAlchemy models, use:

```bash
alembic revision --autogenerate -m "describe your change"
alembic upgrade head
```

## 8. Backend API Overview

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | backend service description |
| `GET` | `/health` | health check |
| `POST` | `/api/v1/auth/register` | register and receive JWT |
| `POST` | `/api/v1/auth/login` | login and receive JWT |
| `POST` | `/api/v1/auth/refresh` | refresh access token with refresh token |
| `POST` | `/api/v1/auth/logout` | revoke current refresh session |
| `POST` | `/api/v1/auth/password-reset-request` | request a short-lived password-reset token |
| `POST` | `/api/v1/auth/password-reset` | reset password with token and revoke all active sessions |
| `POST` | `/api/v1/auth/reset-password` | change current password while keeping only the current device session |
| `GET` | `/api/v1/auth/sessions` | list active login devices for current user |
| `DELETE` | `/api/v1/auth/sessions/{session_id}` | revoke a specific login device |
| `PATCH` | `/api/v1/auth/profile` | update current user profile |
| `POST` | `/api/v1/media/chat/stream` | authenticated SSE media task stream |
| `GET` | `/api/v1/media/threads` | authenticated paginated thread list |
| `GET` | `/api/v1/media/threads/{thread_id}/messages` | authenticated thread replay |
| `PATCH` | `/api/v1/media/threads/{thread_id}` | rename, archive, or update thread prompt |
| `DELETE` | `/api/v1/media/threads/{thread_id}` | delete owned thread |
| `POST` | `/api/v1/media/upload` | authenticated user-scoped upload via the active storage backend |
| `GET` | `/uploads/{user_id}/{filename}` | local-upload preview path when the local backend is active |

### 8.1 Authentication Rules

1. `register` accepts JSON username/password and returns both `access_token` and `refresh_token`.
2. `login` uses `OAuth2PasswordRequestForm` and returns both `access_token` and `refresh_token`.
3. `refresh` accepts JSON `refresh_token`, validates the matching `RefreshSession`, revokes the previous session, and returns a fresh token pair.
4. new access tokens are bound to the active refresh-session identifier and protected routes validate that bound session is still active.
5. `logout` accepts JSON `refresh_token` and revokes the matching `RefreshSession`.
6. `GET /api/v1/auth/sessions` returns only active, non-revoked, non-expired sessions for the current user.
7. `DELETE /api/v1/auth/sessions/{session_id}` revokes an owned refresh session by ID.
8. `POST /api/v1/auth/password-reset-request` and `POST /api/v1/auth/password-reset` do not require an access token.
9. `POST /api/v1/auth/reset-password` and `PATCH /api/v1/auth/profile` MUST be called with a valid access token.
10. `POST /api/v1/media/upload` MUST be called with a valid access token.
11. Chat and history routes MUST include `Authorization: Bearer <access_token>`.
12. Missing or invalid tokens return `401`.

### 8.2 Ownership Rules

1. Every `Thread` belongs to exactly one `User`.
2. History, update, deletion, and chat continuation MUST filter by `Thread.user_id`.
3. A user attempting to read another user's thread receives `404`.
4. New threads are created with the current authenticated user as owner.

### 8.3 Chat Persistence Lifecycle

`POST /api/v1/media/chat/stream` currently performs:

1. ownership check for `thread_id`
2. thread upsert with `user_id`, `title`, and `system_prompt`
3. user message persistence
4. material reference normalization and persistence
5. upload-record thread backfill plus OSS temporary-object promotion for newly bound material uploads
6. provider stream execution
7. assistant text persistence before `done`
8. artifact persistence into `ArtifactRecord`

## 9. Data Contracts

Backend contracts are defined in [app/models/schemas.py](/E:/omnimedia-agent/app/models/schemas.py).

Frontend mirror types are defined in [frontend/src/app/types.ts](/E:/omnimedia-agent/frontend/src/app/types.ts).

### 9.1 Core Request Contracts

#### `MaterialInput`

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `type` | `MaterialType` | yes | none |
| `url` | `str \| None` | no | `None` |
| `text` | `str` | no | `""` |

#### `MediaChatRequest`

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `thread_id` | `str` | yes | none | unique thread identifier |
| `platform` | `Platform` | yes | none | target platform |
| `task_type` | `TaskType` | yes | none | task type |
| `message` | `str` | yes | none | user input |
| `materials` | `list[MaterialInput]` | no | `[]` | attached materials |
| `system_prompt` | `str \| None` | no | `None` | per-thread persona override |
| `thread_title` | `str \| None` | no | `None` | explicit thread title |

### 9.2 Auth Contracts

#### `RegisterRequest`

| Field | Type | Required |
| --- | --- | --- |
| `username` | `str` | yes |
| `password` | `str` | yes |

#### `PasswordResetRequestCreate`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `username` | `str` | yes | target username for recovery flow |

#### `PasswordResetRequestResponse`

| Field | Type | Notes |
| --- | --- | --- |
| `accepted` | `true` | request accepted regardless of whether a matching user was found |
| `expires_in_minutes` | `int` | reset token lifetime for the current environment |

#### `PasswordResetConfirmRequest`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `token` | `str` | yes | short-lived password-reset JWT |
| `new_password` | `str` | yes | replacement password, minimum `8` characters |

#### `PasswordResetConfirmResponse`

| Field | Type | Notes |
| --- | --- | --- |
| `password_reset` | `true` | reset completed successfully |
| `revoked_sessions` | `int` | number of previously active sessions that were revoked |

#### `AuthTokenResponse`

| Field | Type | Notes |
| --- | --- | --- |
| `access_token` | `str` | JWT bearer token |
| `refresh_token` | `str` | long-lived JWT refresh token |
| `token_type` | `"bearer"` | fixed |
| `user` | `UserProfile` | authenticated user payload |

#### `RefreshTokenRequest`

| Field | Type | Required |
| --- | --- | --- |
| `refresh_token` | `str` | yes |

#### `LogoutRequest`

| Field | Type | Required |
| --- | --- | --- |
| `refresh_token` | `str` | yes |

#### `LogoutResponse`

| Field | Type | Notes |
| --- | --- | --- |
| `logged_out` | `true` | revocation request accepted |

#### `AuthSessionItem`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `str` | refresh-session identifier |
| `device_info` | `str \| None` | parsed device label from request headers |
| `ip_address` | `str \| None` | detected client IP |
| `expires_at` | ISO 8601 UTC string | session expiry |
| `last_seen_at` | ISO 8601 UTC string | last observed activity |
| `created_at` | ISO 8601 UTC string | session creation time |
| `is_current` | `bool` | whether the current access token belongs to this session |

#### `AuthSessionsResponse`

| Field | Type | Notes |
| --- | --- | --- |
| `items` | `list[AuthSessionItem]` | active sessions for current user |

#### `SessionRevokeResponse`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `str` | revoked session identifier |
| `revoked` | `bool` | revocation result |

#### `UserProfile`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `str` | yes | user identifier |
| `username` | `str` | yes | login name |
| `nickname` | `str \| None` | no | display name override |
| `bio` | `str \| None` | no | short profile bio |
| `avatar_url` | `str \| None` | no | resolved avatar delivery URL; persistence MAY store a normalized managed-storage path internally |
| `created_at` | ISO 8601 UTC string | yes | serialized with trailing `Z` |

#### `UserProfileUpdate`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `nickname` | `str \| None` | no | empty or null clears the value |
| `bio` | `str \| None` | no | empty or null clears the value |
| `avatar_url` | `str \| None` | no | empty or null clears the value; signed upload URLs are normalized before persistence |

### 9.3 Upload Contracts

#### Upload Form Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file` | multipart file | yes | binary upload content |
| `purpose` | `"avatar" \| "material"` | no | defaults to `material` |
| `thread_id` | `str \| None` | no | optional existing thread binding for material uploads |

#### `UploadMediaResponse`

| Field | Type | Notes |
| --- | --- | --- |
| `url` | `str` | frontend delivery URL returned by the active backend; OSS responses are signed and time-limited |
| `file_type` | `str` | image, video, or document |
| `content_type` | `str` | MIME type |
| `filename` | `str` | stored filename |
| `original_filename` | `str` | sanitized original name |
| `purpose` | `"avatar" \| "material"` | tracked usage purpose |
| `thread_id` | `str \| None` | nullable associated thread identifier |

### 9.4 Thread Replay Contracts

#### `ThreadMessagesResponse`

| Field | Type | Notes |
| --- | --- | --- |
| `thread_id` | `str` | thread identifier |
| `title` | `str` | persisted thread title |
| `system_prompt` | `str` | persisted persona prompt |
| `messages` | `list[MessageHistoryItem]` | ordered history messages |
| `materials` | `list[MaterialHistoryItem]` | legacy thread-level materials without a message association |

`MessageHistoryItem.materials` is the authoritative location for attachments submitted with a user message. Frontend history replay SHOULD render message-level materials first and treat top-level `materials` as a legacy compatibility field.

### 9.5 Artifact Contracts

Current stable artifact payloads:

- `TopicPlanningArtifactPayload`
- `ContentGenerationArtifactPayload`
- `HotPostAnalysisArtifactPayload`
- `CommentReplyArtifactPayload`

These payloads are shared by backend validation, SSE `artifact` events, history replay, and frontend right-panel rendering.

### 9.6 Timestamp Contract

The repository now standardizes message, material, thread, and user timestamps with the following rules:

1. backend persistence MUST write UTC timestamps
2. serialized API responses MUST use ISO 8601 UTC strings
3. API payloads SHOULD emit UTC timestamps with trailing `Z`
4. frontend optimistic messages and SSE assistant placeholders MUST generate local timestamps with `new Date().toISOString()`
5. frontend rendering MUST localize those ISO strings with browser-local time formatting and MUST NOT display `Invalid Date`

## 10. SSE Streaming Specification

The streaming route is implemented in [app/api/v1/chat.py](/E:/omnimedia-agent/app/api/v1/chat.py) and backed by [app/services/agent.py](/E:/omnimedia-agent/app/services/agent.py) plus [app/services/providers.py](/E:/omnimedia-agent/app/services/providers.py).

### 10.1 Response Requirements

The backend response MUST:

1. use `Content-Type: text/event-stream`
2. include `Cache-Control: no-cache`
3. include `Connection: keep-alive`
4. include `X-Accel-Buffering: no`

### 10.2 Stable Event Types

#### `start`

```json
{
  "event": "start",
  "thread_id": "thread-xxx",
  "platform": "xiaohongshu",
  "task_type": "content_generation",
  "materials_count": 1
}
```

#### `message`

```json
{
  "event": "message",
  "delta": "正在生成草稿...",
  "index": 0
}
```

#### `tool_call`

```json
{
  "event": "tool_call",
  "name": "web_search",
  "status": "processing",
  "message": "正在搜索全网热点: 2026 最新手机发布会"
}
```

#### `artifact`

```json
{
  "event": "artifact",
  "artifact": {
    "artifact_type": "content_draft",
    "title": "年度复盘内容草稿"
  }
}
```

#### `error`

```json
{
  "event": "error",
  "code": "OPENAI_AUTH_ERROR",
  "message": "OpenAI 鉴权失败，请检查密钥或网关配置。"
}
```

#### `done`

```json
{
  "event": "done",
  "thread_id": "thread-xxx"
}
```

## 11. Provider and Persona Rules

### 11.1 Current Providers

The provider layer currently supports:

- `MockLLMProvider`
- `OpenAIProvider`
- `CompatibleLLMProvider`
- `LangGraphProvider`

### 11.2 Provider Selection

Provider selection is controlled by `OMNIMEDIA_LLM_PROVIDER`:

- `mock`
- `openai`
- `compatible`
- `langgraph`
- `auto`

### 11.3 LangGraph Workflow Baseline

`LangGraphProvider` now compiles a branching multi-node graph with the following stages:

1. `router`
2. `parse_materials_node`
3. `ocr_node` when image materials are present
4. `search_node` when the router decides the request needs live search context
5. `generate_draft_node`
6. `tool_execution_node` when `generate_draft_node` requests business tool calls
7. `review_node`
8. `format_artifact_node`

Current execution rules:

1. `router` performs a structured search-intent decision, sets `needs_search`, and extracts a `search_query` when the request needs up-to-date external context
2. `parse_materials_node` emits a `tool_call` event and converts raw materials into summarized text clues
3. after parse, the graph conditionally routes to `ocr_node` only when image materials are present
4. after parse or OCR, the graph conditionally routes to `search_node` only when `needs_search == true`
5. `search_node` emits `web_search` tool events, prefers real Tavily search when configured, and otherwise falls back to deterministic mock search results
6. `generate_draft_node` first invokes a tool-aware planner created via `inner_provider.bind_tools(...)` when the provider supports it, and otherwise falls back to deterministic heuristic planning so Mock and test providers remain stable
7. the planner appends `AIMessage` entries into `GraphState.messages`; if `AIMessage.tool_calls` are present, the graph routes to `tool_execution_node`, otherwise final drafting proceeds through the configured inner provider with XML-style `<image_context>`, `<search_context>`, and `<business_tool_context>` blocks injected when those contexts exist
8. `tool_execution_node` emits `tool_call` progress, executes local Python tools from `app/services/tools.py`, stores `ToolMessage` results in graph state, and loops back to `generate_draft_node` until the planner stops requesting tools or `business_tool_max_iterations` is reached
9. the current mock baseline supports sequential Business Tools such as `analyze_market_trends` followed by `generate_content_outline`, which enables a real ReAct-style "analyze first, draft later" loop before the final draft is streamed
10. `review_node` emits `tool_call` progress, validates the draft against lightweight structural and persona constraints, and can retry generation up to `2` times
11. only the accepted or max-retry draft is emitted downstream as `message` events, which keeps persisted assistant output aligned with the final visible draft
12. `format_artifact_node` emits a `tool_call` event and produces the final `artifact`
13. when the inner provider returns an invalid artifact payload, the graph falls back to a deterministic local artifact builder
14. the graph preserves the external SSE contract so the route layer does not need special handling

Superseding note for `v1.10.0`:

1. `ocr_node` now prefers a real multimodal model instead of mock OCR when vision credentials are available.
2. both local `/uploads/...` image paths and remote `http://` / `https://` image URLs are normalized to Base64 data URLs before being sent to the vision model.
3. OCR failures now surface printed tracebacks plus runtime error events so the backend can expose the real multimodal fault instead of silently falling back.

Superseding note for `v1.11.0`:

1. `ocr_node` depends on the frontend sending `materials` with image URLs in the `/chat/stream` request.
2. Frontend user-message optimism MUST keep the same material payload that is sent to the backend, so visual feedback and LangGraph routing stay aligned.
3. Uploaded OSS image URLs SHOULD be sent as `{"type":"image","url":"https://...","text":"filename"}` entries in `MediaChatRequest.materials`.
4. Public `http://` and `https://` image URLs are first downloaded by the backend, converted to Base64 data URLs in memory, and only then sent to the vision model as OpenAI-compatible `image_url` parts.
5. Relative `/uploads/...` image paths are read from disk and converted to Base64 data URLs before being sent to the vision model.
6. Vision requests MUST use `LLM_VISION_MODEL` or `OPENAI_VISION_MODEL`, never the default text model as an implicit fallback.
7. `generate_draft_node` now rewrites the effective user message with a smooth XML-style `<image_context>` block when OCR clues are present, while keeping `system_prompt` limited to the thread persona or request prompt without adding extra vision guardrails.
8. When LangGraph delegates draft generation to a text-only inner provider, image materials are stripped from the delegated request so the downstream model only sees OCR-derived text clues instead of raw image URLs or filenames.

Superseding note for `v1.12.0`:

1. `ChatFeed` now consumes the authenticated frontend user state so user-side chat bubbles can render the persisted avatar consistently with the sidebar and profile modal.
2. User and assistant chat avatars now use circular rendering instead of rounded-square rendering to match mainstream profile-avatar expectations.
3. The repository now includes a root-level Chinese `README.md` for onboarding, startup, and day-to-day development entry.

Superseding note for `v1.12.1`:

1. `app/main.py` now restricts local-development CORS origins to the Vite frontend endpoints `http://localhost:5173` and `http://127.0.0.1:5173` instead of using a wildcard origin.
2. CORS middleware registration remains before router inclusion so preflight handling is applied consistently during frontend-backend local integration.

Superseding note for `v1.12.2`:

1. `frontend/vite.config.ts` now binds the Vite development server to `0.0.0.0` so devices on the same LAN can open the workspace directly.
2. the backend local-development CORS whitelist was temporarily expanded for same-LAN access verification.

Superseding note for `v1.12.3`:

1. `app/main.py` no longer relies on a hardcoded LAN origin and now reads optional comma-separated CORS origins from `CORS_ALLOWED_ORIGINS`.
2. when `CORS_ALLOWED_ORIGINS` is unset, backend CORS falls back to localhost development defaults.
3. `.env.example`, `README.md`, and `DEVELOPMENT.md` now document the environment-variable-based LAN access setup.

Superseding note for `v1.13.1`:

1. `frontend/src/styles/theme.css` now defines semantic CSS-variable tokens for Light and Dark workspace themes through `:root` and `.dark`, including dedicated user-bubble and AI-bubble color tokens.
2. `frontend/src/app/ThemeContext.tsx` now persists `mediapilot-theme`, falls back to `prefers-color-scheme`, and applies the active Light or Dark theme class to the root `html` element.
3. the workspace shell, header, sidebars, chat surfaces, artifact panel, thread settings modal, and profile modal now consume semantic theme tokens instead of relying on hardcoded grayscale utility classes.

Superseding note for `v1.13.2`:

1. `router` now performs a structured search decision and extracts a dedicated `search_query` instead of relying on task-type-only hardcoded search routing.
2. `search_node` now emits `web_search` tool events, stores normalized `search_results`, and can fall back to deterministic mock search output when no live search API is configured.
3. `generate_draft_node` now injects XML-style `<search_context>` blocks into the drafting request so the downstream model can incorporate time-sensitive external context.
4. `.env.example`, `README.md`, and `DEVELOPMENT.md` now document the optional Tavily search configuration and the upgraded LangGraph workflow baseline.

### 11.4 Dynamic Persona Rule

The current provider baseline MUST follow these rules:

1. hardcoded business personas are removed from provider code
2. `Thread.system_prompt` is the first source of truth
3. if the thread prompt is empty, fallback is `你是一个通用型的智能助手，请始终使用简体中文回答。`
4. task-specific instruction is injected separately from the user persona

Implementation note for `v1.10.0`:

- the practical fallback prompt is now `你是一个通用型的智能助手，请始终使用简体中文回答。`

### 11.5 Context Isolation Rule

The current provider baseline MUST follow these rules:

1. only load messages where `Message.thread_id == request.thread_id`
2. when a `user_id` is available, join through `Thread.user_id == current_user.id`
3. the current implementation caps provider context at the latest `12` messages
4. providers MUST NOT read messages from other threads

## 12. Upload Boundary

The upload route is implemented in [app/api/v1/oss.py](/E:/omnimedia-agent/app/api/v1/oss.py).

Current enforced boundaries:

1. allowed images: `jpg`, `jpeg`, `png`, `webp`
2. allowed videos: `mp4`, `mov`
3. allowed documents: `txt`, `pdf`, `md`
4. maximum upload size: `15MB`
5. validation is performed while reading the stream
6. filenames are sanitized before storage
7. uploads require a valid bearer token
8. files are streamed to the active backend after validation, without first assembling the full payload in application memory
9. local storage uses `{user_id}/{filename}` object keys and returns `/uploads/{user_id}/{filename}` preview URLs
10. OSS material uploads without a bound thread are staged under `uploads/tmp/{user_id}/{filename}` until they are attached to a confirmed thread
11. once an unbound OSS material is linked to a thread, the backend promotes it to `uploads/{user_id}/{filename}` through a storage-level copy and rewrites the stored path metadata
12. normalized storage paths, rather than long-lived public URLs, are the preferred persistence format for managed uploads
13. OSS delivery URLs returned to the frontend are signed and time-limited; local delivery continues to use `/uploads/...`
14. each saved file is tracked in `UploadRecord`
15. material uploads MAY include an owned `thread_id` when the upload already belongs to an existing thread
16. local paths, signed OSS URLs, or normalized storage references used in chat persistence SHOULD backfill `UploadRecord.thread_id` once the thread is created or confirmed
17. profile avatars and replayed material items resolve frontend-facing delivery URLs dynamically from normalized stored paths
18. avatar uploads can be cleaned up after profile changes when they become stale orphan files
19. stale material uploads older than `24h` are eligible for cleanup when they are still unbound or their thread no longer exists
20. deleting a thread triggers immediate cleanup of linked material upload files and records
21. an APScheduler background job runs `cleanup_abandoned_materials()` every hour and deletes the physical file through the resolved storage backend before removing the database record
22. Aliyun OSS can additionally apply `setup_bucket_lifecycle()` so `uploads/tmp/` objects expire automatically and aged `uploads/` objects transition to colder storage classes
23. partial files are cleaned up on failure

## 13. Frontend Engineering Baseline

### 13.1 Main Responsibilities

[frontend/src/app/App.tsx](/E:/omnimedia-agent/frontend/src/app/App.tsx) now provides:

1. top-level authentication gate
2. login/register card plus password-reset request and token-reset recovery views
3. token-backed workspace shell
4. new-thread modal with title and persona fields
5. thread settings modal for editing persisted `title` and `system_prompt`
6. user profile editing modal for `nickname`, `bio`, and avatar upload
7. chat stream consumption
8. thread history loading and replay
9. sidebar rename and delete actions
10. logout flow
11. backend-backed refresh-session revocation before clearing local auth state
12. optimistic timestamps for user and assistant messages
13. sidebar avatar preview synced from persisted user profile
14. profile modal tabs for both user settings and active-device management
15. collapsible workspace header for task metadata, persona controls, and quick actions
16. optimistic user messages that preserve submitted material attachments for immediate preview
17. `/chat/stream` payload assembly that maps ready uploads into backend `materials`
18. chat-bubble user avatar sync from the persisted authenticated user profile with immediate React state refresh after profile updates
19. global theme state persistence for `light` and `dark`
20. root-level HTML class switching that keeps Tailwind semantic color tokens in sync with the active theme
21. themed workspace surfaces across the header, sidebars, feed, composer, right panel, and modal overlays

### 13.2 Composer and Chat Material Flow

The current frontend material flow is:

1. `Composer` receives `uploadedMaterials` from `App` and submits them through `ComposerSubmitPayload`.
2. `App.handleSubmit()` filters ready uploads, maps them to `MediaChatMaterialPayload`, and reuses that same array for both the optimistic user message and `createChatStream()`.
3. User messages MAY include `ConversationMessage.materials`.
4. `ChatFeed` MUST render image materials as thumbnails in the user bubble and non-image materials as compact attachment chips.
5. Composer text and upload state MUST be cleared after a successful local submit handoff, while in-flight uploads still block submission.
6. This flow is required for LangGraph image routing because the backend only enters `ocr_node` when `MediaChatRequest.materials` contains image entries.
7. User-side chat bubbles SHOULD render `currentUser.avatar_url` when available, and MUST fall back to the default user icon when the avatar is missing or fails to load.
8. User-facing chat avatars SHOULD use circular rendering to stay visually aligned with common profile-avatar expectations across the workspace.

### 13.3 Frontend API Layer

[frontend/src/app/api.ts](/E:/omnimedia-agent/frontend/src/app/api.ts) now provides:

- `APIError`
- `fetchWithInterceptor`
- token storage helpers
- refresh-token storage helpers
- user storage helpers
- `login()`
- `register()`
- `logoutAPI()`
- automatic token refresh on `401`
- `updateUserProfile()`
- `fetchSessions()`
- `revokeSession()`
- `uploadMedia()` with optional `threadId`
- `fetchThreads()`
- `fetchThreadMessages()`
- `updateThread()`
- `deleteThread()`
- `createChatStream()`

### 13.4 Frontend Time Handling Rules

1. optimistic user messages MUST receive a local ISO timestamp immediately
2. assistant placeholder messages MUST receive a local ISO timestamp when the SSE `start` event is received
3. history replay MUST render backend timestamps without extra client-side mutation
4. timestamp formatting is centralized in `frontend/src/app/utils.ts`
5. UI MUST avoid rendering `Invalid Date`

### 13.5 Authentication and Profile UX Rules

1. no usable session means the workspace MUST render the auth card
2. successful auth stores access token, refresh token, and user info in `localStorage`
3. `401` from protected APIs SHOULD first attempt refresh-token renewal before forcing logout
4. new threads are configured via modal before first message submission
5. thread settings updates MUST refresh the active thread title and `system_prompt` in-memory immediately
6. avatar uploads SHOULD complete before submitting the profile form
7. profile updates MUST refresh both React state and `localStorage` immediately
8. opening the profile modal SHOULD fetch active sessions so the device list stays fresh
9. non-current devices MAY be revoked directly from the profile modal

### 13.6 Frontend Theme System

1. `ThemeProvider` MUST persist the active workspace theme under the `mediapilot-theme` localStorage key.
2. when no saved theme exists, the frontend SHOULD fall back to `prefers-color-scheme` and default to Light when the system preference is not dark.
3. only one root theme class MAY be active at a time: `dark` or neither for the Light baseline.
4. semantic color tokens in `frontend/src/styles/theme.css` SHOULD be the default source of truth for workspace backgrounds, text, borders, overlays, and status surfaces.
5. new workspace UI SHOULD prefer semantic theme utilities such as `bg-card`, `bg-muted`, `text-foreground`, and `border-border` instead of hardcoded grayscale palettes.
6. theme transitions SHOULD remain smooth, but the implementation MUST continue to respect reduced-motion user preferences.

## 14. Database Baseline

### 14.1 Current ORM Models

Current SQLAlchemy models:

- `User`
- `Thread`
- `Message`
- `Material`
- `ArtifactRecord`
- `UploadRecord`
- `RefreshSession`

### 14.2 User and Thread Fields

`User` now includes:

- `id`
- `username`
- `hashed_password`
- `nickname`
- `bio`
- `avatar_url`
- `created_at`

`UploadRecord` now includes:

- `user_id`
- `filename`
- `file_path`
- `mime_type`
- `file_size`
- `purpose`
- `thread_id`
- `created_at`

`Material` now includes:

- `thread_id`
- `message_id`
- `type`
- `url`
- `text`
- `created_at`

`Material.message_id` is nullable for legacy rows, but new `/chat/stream` submissions MUST link every request material to the persisted user `Message` row.

`RefreshSession` now includes:

- `user_id`
- `refresh_token_jti`
- `device_info`
- `ip_address`
- `expires_at`
- `last_seen_at`
- `is_revoked`
- `created_at`

`Thread` now includes:

- `user_id`
- `title`
- `system_prompt`
- `is_archived`
- `created_at`
- `updated_at`

### 14.3 Timestamp Persistence Rule

The ORM layer uses a UTC-aware normalization strategy:

1. database writes use UTC values
2. SQLite naive datetimes are normalized back to UTC on read
3. `created_at` and `updated_at` fields are treated as UTC application-wide

### 14.4 Migration Baseline

Current migration chain:

1. `20260424_01_initial.py`
2. `20260424_02_thread_management_and_artifacts.py`
3. `20260424_03_auth_and_persona.py`
4. `20260425_01_user_profile_fields.py`
5. `20260425_02_user_avatar_url.py`
6. `20260425_03_upload_record_tracking.py`
7. `20260425_04_refresh_session_revocation.py`
8. `20260425_05_upload_record_thread_binding.py`
9. `20260425_06_refresh_session_metadata.py`
10. `20260427_01_material_message_link.py`

If a database existed before the auth migration, `20260424_03_auth_and_persona.py` seeds a legacy owner row so older thread data can still be upgraded safely.

## 15. Test and Verification Baseline

### 15.1 Automated Test Coverage

Current automated tests are located in:

- [tests/test_chat.py](/E:/omnimedia-agent/tests/test_chat.py)
- [tests/test_graph_search.py](/E:/omnimedia-agent/tests/test_graph_search.py)
- [tests/test_graph_vision.py](/E:/omnimedia-agent/tests/test_graph_vision.py)
- [tests/test_graph_tools.py](/E:/omnimedia-agent/tests/test_graph_tools.py)
- [tests/test_oss.py](/E:/omnimedia-agent/tests/test_oss.py)
- [tests/test_oss_client.py](/E:/omnimedia-agent/tests/test_oss_client.py)
- [tests/test_config.py](/E:/omnimedia-agent/tests/test_config.py)
- [tests/test_scheduler.py](/E:/omnimedia-agent/tests/test_scheduler.py)
- [frontend/e2e/auth.spec.ts](/E:/omnimedia-agent/frontend/e2e/auth.spec.ts)
- [frontend/e2e/chat.spec.ts](/E:/omnimedia-agent/frontend/e2e/chat.spec.ts)

Covered cases:

1. registration and login
2. refresh-token renewal
3. refresh-token rotation revokes the previous session
4. refresh endpoint rejects access token misuse
5. logout revokes refresh-session reuse
6. profile update API
7. profile avatar URL persistence
8. protected chat endpoint rejects missing token
9. SSE event order for `content_generation`
10. artifact validation for `topic_planning`
11. artifact validation for `content_generation`
12. artifact validation for `hot_post_analysis`
13. artifact validation for `comment_reply`
14. thread history replay with persisted `system_prompt`
15. thread `system_prompt` update persistence
16. cross-user thread isolation
17. UTC timestamp serialization for auth and history payloads
18. thread rename, archive, and delete flow
19. upload authentication enforcement
20. upload success with user-scoped local or OSS-backed storage
21. upload type rejection
22. upload size rejection
23. upload record metadata persistence
24. upload record thread binding persistence
25. avatar orphan-file cleanup after profile update
26. stale unbound material cleanup after the retention window
27. chat persistence backfills upload records for both local and OSS material URLs
28. thread deletion removes linked material uploads immediately
29. active session listing marks the current device and returns device/IP metadata
30. targeted session revocation invalidates the corresponding access token chain
31. scheduler job registration and hourly cleanup execution across storage backends
32. local upload image paths are converted to data URLs for multimodal requests
33. custom vision clues are passed into the downstream drafting context
34. vision-analysis failures degrade safely while preserving the main workflow
35. LangGraph text-material path skips OCR and emits review-stage tool calls
36. LangGraph image-material path routes through OCR and retries after review failure
37. thread history returns user-message image materials after refresh/replay
38. LangGraph search routing injects `<search_context>` into drafting requests before artifact generation
39. LangGraph search fallback uses deterministic mock results when no live search API is configured
40. local storage and Aliyun OSS clients both support direct stream-based uploads
41. OSS client V4 auth and bucket wiring use the configured credential set
42. OSS `.env` configuration reloads after file changes and reports missing required fields clearly
43. password-reset request logs a short-lived local-development recovery link when the user exists
44. token-based password reset revokes all active sessions for the user before they log back in
45. invalid password-reset tokens are rejected without mutating the stored password
46. Playwright auth coverage verifies browser registration/login token persistence, password-reset form transition, and logout local-storage cleanup
47. Playwright workspace coverage verifies new-thread modal creation and streamed chat bubble rendering with user-avatar fallback
48. Business Tool registry exports OpenAI-compatible function schemas and typed mock tool outputs
49. LangGraph business-tool execution routes from draft generation to local tool execution and loops back with `<business_tool_context>` before review
50. OSS delivery URLs are generated as signed previews instead of persisted long-lived public links
51. profile avatars and thread-history materials resolve frontend URLs dynamically from normalized storage references
52. unbound OSS material uploads are staged under a temporary prefix and promoted to permanent object keys on thread bind
53. Aliyun OSS lifecycle setup provisions both temporary-object expiration and aged-object storage transitions
54. upload persistence normalization accepts signed OSS URLs and rewrites them back to managed storage paths safely

### 15.2 E2E Browser Automation

Frontend Playwright tests live under `frontend/e2e/` and use mocked API responses for deterministic browser smoke coverage without requiring a live backend service.

Run from the frontend directory:

```bash
cd frontend
npx playwright test
```

Interactive runner:

```bash
cd frontend
npx playwright test --ui
```

The Playwright config starts the Vite dev server automatically with `npm run dev` and uses `http://localhost:5173` as `baseURL`.

### 15.3 Latest Verification Result

The following checks were executed for the current OSS signed-delivery and lifecycle hardening change set on `2026-04-28` and passed:

```bash
python -m pytest -q
```

Observed result baseline:

- full backend test suite: 69 passed
- covered storage-hardening flows: signed preview URL generation, bucket lifecycle rule provisioning, temporary-prefix OSS material staging, copy-based promotion on thread bind, normalized avatar/media persistence, and signed thread-history replay URLs
- existing auth, scheduler, upload-retention, LangGraph search/tool, and multimodal OCR regression suites remain green under the new storage-reference normalization flow

The previous Playwright E2E baseline remains: `5 passed` for auth, password reset, logout, new-thread setup, and streamed chat rendering.

### 15.4 Current Warning

Current tests still emit a deprecation warning from `httpx` used by `FastAPI TestClient` regarding the deprecated `app` shortcut. This does not block execution but SHOULD be cleaned up during future dependency maintenance.

## 16. Current Implementation Status

### 16.1 Completed in v1.13.8

This version adds or solidifies:

1. `AliyunOSSClient` now exposes `generate_presigned_url()` and `setup_bucket_lifecycle()` so production deployments can serve time-limited delivery URLs and provision native OSS lifecycle rules for temporary cleanup plus cold-storage transition.
2. the shared storage abstraction now supports `build_delivery_url(...)`, `build_temporary_object_key(...)`, and synchronous copy-based promotion, keeping local and OSS behavior aligned behind the same persistence boundary.
3. unbound OSS material uploads are now staged under `uploads/tmp/{user_id}/{filename}`, while thread binding promotes them to permanent `uploads/{user_id}/{filename}` object keys and rewrites `UploadRecord` plus `Material` storage references accordingly.
4. profile avatars, thread-history materials, and upload responses now persist normalized managed-storage paths and resolve frontend-facing URLs dynamically, so the database no longer depends on long-lived OSS public URLs.
5. LangGraph OCR image resolution can now consume OSS-managed image materials by converting normalized stored paths into signed delivery URLs before remote download.
6. `tests/test_oss.py`, `tests/test_oss_client.py`, `README.md`, `.env.example`, and `DEVELOPMENT.md` now lock the signed delivery, lifecycle, promotion, and normalization baseline.

### 16.2 Completed in v1.13.7

This version adds or solidifies:

1. `BaseLLMProvider` now exposes optional `bind_tools(...)`, and both `OpenAIProvider` plus `CompatibleLLMProvider` adapt LangChain-style tool binding on top of their existing `AsyncOpenAI` clients.
2. `LangGraphProvider` now initializes a provider-level tool planner with `inner_provider.bind_tools(get_business_tools())` when available, while preserving heuristic fallback for Mock/test providers.
3. Business Tool planning now supports autonomous and sequential ReAct loops, so planning-heavy requests can proactively call `analyze_market_trends`, then `generate_content_outline`, and only then hand off to the final drafting provider.
4. post-draft routing now inspects only the latest `AIMessage.tool_calls`, which prevents stale historical tool-call messages from causing recursive loopbacks.
5. `pytest.ini` constrains default discovery to `tests/`, so `python -m pytest -q` no longer walks transient `uploads/` directories during collection.
6. `tests/test_graph_tools.py`, `README.md`, and `DEVELOPMENT.md` now lock the sequential Business Tools baseline, title-only single-tool fallback, and the updated verification entrypoint.

### 16.3 Completed in v1.13.6

This version adds or solidifies:

1. `app/services/tools.py` defines typed LangChain Core Business Tools including `analyze_market_trends` and `generate_content_outline` with deterministic mock JSON outputs.
2. `LangGraphProvider` now carries normalized tool-call state through `AIMessage` / `ToolMessage` compatible graph messages.
3. `generate_draft_node` can request Business Tools before final drafting, route to `tool_execution_node`, and loop back with `<business_tool_context>` injected into the final draft request.
4. `tool_execution_node` emits SSE `tool_call` progress events for `processing`, `completed`, and `failed` states while executing local Python tools.
5. `tests/test_graph_tools.py` locks the tool schema export, mock tool output, and ReAct loopback behavior without requiring live model credentials.
6. `README.md` and `DEVELOPMENT.md` now document the Business Tools architecture and preserve the mandatory documentation-update rule.

### 16.4 Completed in v1.13.5

This version adds or solidifies:

1. `frontend/playwright.config.ts` defines the Playwright browser E2E baseline with `http://localhost:5173` as `baseURL` and an automatic `npm run dev` web server.
2. `frontend/e2e/auth.spec.ts` covers registration/login token persistence, password-reset request-to-reset-form transition, and logout local-storage cleanup.
3. `frontend/e2e/chat.spec.ts` covers new-thread modal creation and streamed chat rendering for user and assistant bubbles.
4. `frontend/e2e/fixtures.ts` provides deterministic API mocks so browser smoke tests do not require a live backend during frontend regression runs.
5. frontend components now expose stable accessibility labels and `data-testid` anchors for critical auth, workspace, composer, and chat-bubble assertions.
6. `README.md` and `DEVELOPMENT.md` now document E2E setup, commands, coverage scope, and the mandatory documentation-update rule for future changes.

### 16.5 Completed in v1.13.4

This version adds or solidifies:

1. `app/services/auth.py` now supports short-lived password-reset JWT creation and verification through a dedicated `reset` token type
2. `app/api/v1/auth.py` now exposes `password-reset-request` and `password-reset` routes, logs a local-development recovery link, and revokes every active session after a successful token-based reset
3. the authenticated `reset-password` route remains available for in-session password changes while preserving only the current device session
4. the frontend auth card now supports forgot-password request and token-based reset flows, and it clears any cached local session data after a successful recovery reset
5. `.env.example`, `README.md`, and `DEVELOPMENT.md` now document the password-reset capability, reset-token lifetime, and global forced sign-out behavior
6. regression coverage and frontend production build validation now explicitly include account-recovery and password-reset compatibility

### 16.6 Current Non-Blocking Gaps

The project is now a stronger SaaS-ready MVP, but the following gaps remain:

1. access tokens are now tied to the refresh-session chain, but there is still no separate global access-token blacklist or organization-wide forced-revocation control plane
2. password reset now works for local development, but there is still no real email/SMS delivery channel, signed recovery URL distribution, or admin-assisted recovery workflow
3. upload cleanup now covers avatars plus local and OSS-backed material retention, and OSS delivery now uses signed URLs with lifecycle-ready prefixes, but the project still lacks automated lifecycle rollout hooks, CDN invalidation, and operator-facing retention governance
4. LangGraph now has branching, real vision integration, search routing, review retry control, provider-level `bind_tools`, and sequential mock Business Tools, but still lacks deeper retrieval and live external business-system integrations
5. E2E smoke coverage now exists for auth, password reset, logout, new-thread setup, and streamed chat rendering, but still needs expansion for replay, uploads, avatar updates, refresh rotation, session management, thread settings, and full LangGraph flows

## 17. Recommended Next Steps

The next engineering steps SHOULD prioritize:

1. deepen LangGraph retrieval and replace the current sequential mock Business Tools baseline with live external business-system integrations
2. harden OSS governance with automated lifecycle rollout, CDN invalidation, signed-download policy tuning, and richer retention analytics on top of the current signed-delivery baseline
3. expand end-to-end browser coverage beyond the initial Playwright smoke suite to include replay, uploads, avatar updates, refresh flows, session management, thread settings, and deeper SSE/LangGraph flows
4. add real email/SMS recovery delivery, one-time reset-link UX, and broader access-token revocation strategy beyond the current refresh-session chain

## 18. Change Control Principle

When updating this project:

1. backend schema changes MUST be reflected in both `app/models/schemas.py` and `frontend/src/app/types.ts`
2. new protected routes MUST be documented with their auth expectation
3. new SSE event types MUST be added to this document before being treated as stable
4. persistence changes MUST include an Alembic migration or an explicit migration note
5. frontend UX rules that affect message timing or session state SHOULD be documented here
6. every implementation, test-baseline, workflow, or user-facing behavior change MUST update both `README.md` and `DEVELOPMENT.md` in the same change set when relevant
7. this document SHOULD be updated in the same change set as the implementation
8. root-level onboarding or usage changes SHOULD be reflected in `README.md` in the same change set
