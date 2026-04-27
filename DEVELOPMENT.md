# OmniMedia Agent Development Guide

## 1. Document Info

- Document: `DEVELOPMENT.md`
- Current version: `v1.11.0`
- Updated on: `2026-04-27`
- Scope: current repository implementation, including backend gateway, dual-token authentication, tenant isolation, tracked user-scoped uploads, upload cleanup, scheduled material GC, thread-linked material retention, thread persistence, provider abstraction, LangGraph vision-aware orchestration, UTC timestamp normalization, user profile management, session visibility, frontend workspace, and verification baseline

This document is the authoritative engineering baseline for the repository. Contract changes, route changes, persistence changes, and frontend/backend interface changes SHOULD be reflected here in the same change set.

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
3. JWT-based authentication with access token, refresh token, registration, login, session refresh, and server-side refresh-session revocation.
4. Per-user thread ownership and tenant isolation.
5. Per-thread dynamic `system_prompt` persistence.
6. Provider-based SSE streaming chat flow.
7. Local upload API with whitelist and size limit.
8. SQLite persistence via SQLAlchemy.
9. Alembic migrations for schema evolution.
10. Thread history replay, rename, archive, and deletion APIs.
11. User profile editing for `nickname`, `bio`, and `avatar_url`.
12. Thread settings editing for persisted `title` and `system_prompt`.
13. UTC-normalized backend timestamps plus frontend local rendering.
14. Frontend login view, token storage, authenticated request interception, and local user cache sync.
15. Frontend new-thread setup flow with title and persona configuration.
16. Authenticated upload storage under per-user directories.
17. Upload metadata tracking with `UploadRecord`.
18. Avatar orphan-file cleanup after profile updates.
19. Frontend avatar upload and profile-preview sync.
20. LangGraph branching orchestration with real vision-model OCR support, safe degradation, and review/retry control.
21. Thread-linked material upload tracking, backfill, and cleanup on thread deletion.
22. Active session visibility and targeted device revocation.
23. Hourly scheduled abandoned-material cleanup via APScheduler.
24. Frontend material attachments are preserved from upload completion through optimistic chat bubbles and `/chat/stream` payloads.
25. Automated backend tests for auth-protected SSE, history isolation, thread prompt updates, profile updates, avatar persistence, upload tracking, cleanup, upload retention, refresh rotation, logout revocation, session management, scheduler behavior, and LangGraph branching behavior.

### 3.2 Out of Scope

The following capabilities are intentionally not production-complete yet:

1. third-party SSO or enterprise identity providers
2. access-token revocation lists, device fingerprints, or organization-wide session-management dashboards
3. cloud object storage integration
4. production observability, rate limiting, or audit logging
5. advanced LangGraph workflows beyond the current branching vision/review baseline
6. end-to-end browser automation tests
7. scheduled or cloud-backed media retention policies beyond the current local cleanup rules
8. advanced avatar processing such as cropping, compression, and CDN hosting

## 4. Architecture Overview

### 4.1 High-Level Structure

The project uses a frontend-backend separated structure:

- Backend: `FastAPI + Pydantic + SQLAlchemy + Alembic`
- Frontend: `React + Vite + TypeScript + Tailwind CSS`
- Streaming: `SSE`
- Auth: `JWT + passlib`
- Local uploads: `/uploads`
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
|  |- package.json
|  |- vite.config.ts
|  '- src/
|     |- main.tsx
|     '- app/
|        |- App.tsx
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
|           |- UserProfileModal.tsx
|           '- artifacts/
|              |- CommentReplyArtifact.tsx
|              |- ContentGenerationArtifact.tsx
|              |- HotPostAnalysisArtifact.tsx
|              '- TopicPlanningArtifact.tsx
|- tests/
|  |- test_chat.py
|  |- test_graph_vision.py
|  |- test_oss.py
|  '- test_scheduler.py
|- uploads/
|- .env.example
|- .gitignore
|- omnimedia_agent.db
|- alembic.ini
|- requirements.txt
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

### 6.2 Frontend

- `react==18.3.1`
- `react-dom==18.3.1`
- `vite==6.3.5`
- `typescript==5.8.3`
- `tailwindcss==4.1.12`
- `@tailwindcss/vite==4.1.12`
- `lucide-react==0.487.0`

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

The committed `.env.example` now includes:

- provider selection defaults for `LangGraphProvider`
- text-model and artifact-model placeholders
- vision-model placeholders for multimodal OCR
- local SQLite and JWT defaults for development

Current compatible-provider example:

```env
OMNIMEDIA_LLM_PROVIDER=compatible
LLM_API_KEY=your_dashscope_api_key
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen3.5-flash
LLM_ARTIFACT_MODEL=qwen3.5-flash
OPENAI_TIMEOUT_SECONDS=60
JWT_SECRET_KEY=change-this-secret-in-production
JWT_ALGORITHM=HS256
JWT_ACCESS_EXPIRE_MINUTES=30
JWT_REFRESH_EXPIRE_DAYS=7
```

Install:

```bash
pip install -r requirements.txt
```

Run:

```bash
uvicorn app.main:app --reload
```

### 7.2 Frontend

- Node.js `18+` recommended

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
| `GET` | `/api/v1/auth/sessions` | list active login devices for current user |
| `DELETE` | `/api/v1/auth/sessions/{session_id}` | revoke a specific login device |
| `PATCH` | `/api/v1/auth/profile` | update current user profile |
| `POST` | `/api/v1/media/chat/stream` | authenticated SSE media task stream |
| `GET` | `/api/v1/media/threads` | authenticated paginated thread list |
| `GET` | `/api/v1/media/threads/{thread_id}/messages` | authenticated thread replay |
| `PATCH` | `/api/v1/media/threads/{thread_id}` | rename, archive, or update thread prompt |
| `DELETE` | `/api/v1/media/threads/{thread_id}` | delete owned thread |
| `POST` | `/api/v1/media/upload` | authenticated user-scoped local upload |
| `GET` | `/uploads/{user_id}/{filename}` | uploaded file preview |

### 8.1 Authentication Rules

1. `register` accepts JSON username/password and returns both `access_token` and `refresh_token`.
2. `login` uses `OAuth2PasswordRequestForm` and returns both `access_token` and `refresh_token`.
3. `refresh` accepts JSON `refresh_token`, validates the matching `RefreshSession`, revokes the previous session, and returns a fresh token pair.
4. new access tokens are bound to the active refresh-session identifier and protected routes validate that bound session is still active.
5. `logout` accepts JSON `refresh_token` and revokes the matching `RefreshSession`.
6. `GET /api/v1/auth/sessions` returns only active, non-revoked, non-expired sessions for the current user.
7. `DELETE /api/v1/auth/sessions/{session_id}` revokes an owned refresh session by ID.
8. `PATCH /api/v1/auth/profile` MUST be called with a valid access token.
9. `POST /api/v1/media/upload` MUST be called with a valid access token.
10. Chat and history routes MUST include `Authorization: Bearer <access_token>`.
11. Missing or invalid tokens return `401`.

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
4. material persistence
5. upload-record thread backfill for local `/uploads/...` material URLs
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
| `url` | `HttpUrl \| None` | no | `None` |
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
| `avatar_url` | `str \| None` | no | avatar image URL, usually an app-relative uploads path |
| `created_at` | ISO 8601 UTC string | yes | serialized with trailing `Z` |

#### `UserProfileUpdate`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `nickname` | `str \| None` | no | empty or null clears the value |
| `bio` | `str \| None` | no | empty or null clears the value |
| `avatar_url` | `str \| None` | no | empty or null clears the value |

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
| `url` | `str` | app-relative preview path |
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
  "name": "artifact_structuring",
  "status": "processing"
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
4. `generate_draft_node`
5. `review_node`
6. `format_artifact_node`

Current execution rules:

1. `parse_materials_node` emits a `tool_call` event and converts raw materials into summarized text clues
2. after parse, the graph conditionally routes to `ocr_node` only when image materials are present
3. `ocr_node` emits a `tool_call` event and appends mock visual-extraction clues into the material context
4. `generate_draft_node` delegates drafting to the configured inner provider and buffers the latest draft candidate
5. `review_node` emits `tool_call` progress, validates the draft against lightweight structural and persona constraints, and can retry generation up to `2` times
6. only the accepted or max-retry draft is emitted downstream as `message` events, which keeps persisted assistant output aligned with the final visible draft
7. `format_artifact_node` emits a `tool_call` event and produces the final `artifact`
8. when the inner provider returns an invalid artifact payload, the graph falls back to a deterministic local artifact builder
9. the graph preserves the external SSE contract so the route layer does not need special handling

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
8. files are stored under `uploads/{user_id}/`
9. each saved file is tracked in `UploadRecord`
10. material uploads MAY include an owned `thread_id` when the upload already belongs to an existing thread
11. local material URLs used in chat persistence SHOULD backfill `UploadRecord.thread_id` once the thread is created or confirmed
12. avatar uploads can be cleaned up after profile changes when they become stale orphan files
13. stale material uploads older than `24h` are eligible for cleanup when they are still unbound or their thread no longer exists
14. deleting a thread triggers immediate cleanup of linked material upload files and records
15. an APScheduler background job runs `cleanup_abandoned_materials()` every hour
16. partial files are cleaned up on failure

## 13. Frontend Engineering Baseline

### 13.1 Main Responsibilities

[frontend/src/app/App.tsx](/E:/omnimedia-agent/frontend/src/app/App.tsx) now provides:

1. top-level authentication gate
2. login/register card
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

### 13.2 Composer and Chat Material Flow

The current frontend material flow is:

1. `Composer` receives `uploadedMaterials` from `App` and submits them through `ComposerSubmitPayload`.
2. `App.handleSubmit()` filters ready uploads, maps them to `MediaChatMaterialPayload`, and reuses that same array for both the optimistic user message and `createChatStream()`.
3. User messages MAY include `ConversationMessage.materials`.
4. `ChatFeed` MUST render image materials as thumbnails in the user bubble and non-image materials as compact attachment chips.
5. Composer text and upload state MUST be cleared after a successful local submit handoff, while in-flight uploads still block submission.
6. This flow is required for LangGraph image routing because the backend only enters `ocr_node` when `MediaChatRequest.materials` contains image entries.

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
- [tests/test_graph_vision.py](/E:/omnimedia-agent/tests/test_graph_vision.py)
- [tests/test_oss.py](/E:/omnimedia-agent/tests/test_oss.py)
- [tests/test_scheduler.py](/E:/omnimedia-agent/tests/test_scheduler.py)

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
20. upload success with user-scoped storage
21. upload type rejection
22. upload size rejection
23. upload record metadata persistence
24. upload record thread binding persistence
25. avatar orphan-file cleanup after profile update
26. stale unbound material cleanup after the retention window
27. chat persistence backfills upload records for local material URLs
28. thread deletion removes linked material uploads immediately
29. active session listing marks the current device and returns device/IP metadata
30. targeted session revocation invalidates the corresponding access token chain
31. scheduler job registration and hourly cleanup execution
32. local upload image paths are converted to data URLs for multimodal requests
33. custom vision clues are passed into the downstream drafting context
34. vision-analysis failures degrade safely while preserving the main workflow
35. LangGraph text-material path skips OCR and emits review-stage tool calls
36. LangGraph image-material path routes through OCR and retries after review failure
37. thread history returns user-message image materials after refresh/replay

### 15.2 Latest Verification Result

The following checks were executed on `2026-04-25` and passed:

```bash
alembic upgrade head
python -m pytest -q
cd frontend && npm run build
```

Observed result baseline:

- `pytest`: `32 passed`
- `alembic upgrade head`: success
- frontend production build: success

### 15.3 Current Warning

Current tests still emit a deprecation warning from `httpx` used by `FastAPI TestClient` regarding the deprecated `app` shortcut. This does not block execution but SHOULD be cleaned up during future dependency maintenance.

## 16. Current Implementation Status

### 16.1 Completed in v1.11.0

This version adds or solidifies:

1. `RefreshSession` now records `device_info`, `ip_address`, and `last_seen_at`
2. access tokens are now bound to the active refresh-session chain and protected routes reject revoked session chains
3. `GET /api/v1/auth/sessions` and `DELETE /api/v1/auth/sessions/{session_id}` now provide device visibility and targeted revocation
4. the frontend profile modal now includes a device-management tab with refresh and revoke actions
5. APScheduler now runs hourly abandoned-material cleanup in the FastAPI lifespan
6. `LangGraphProvider` now supports real multimodal vision analysis for image materials with safe degradation when credentials or requests fail
7. the frontend workspace header can be collapsed to preserve chat viewport height
8. uploaded image attachments now remain attached to optimistic user messages and `/chat/stream` request payloads
9. `ChatFeed` now renders submitted image materials as clickable thumbnails inside user bubbles
10. backend history replay now returns message-level materials so refreshed chat bubbles keep their images
11. backend coverage now validates device-session management, scheduler job setup, OSS credential routing, vision payload construction, and message-level material replay
12. refreshed development documentation

### 16.2 Current Non-Blocking Gaps

The project is now a stronger SaaS-ready MVP, but the following gaps remain:

1. access tokens are now tied to the refresh-session chain, but there is still no separate global blacklist or password-reset invalidation flow
2. no password reset or account recovery flow
3. upload cleanup now covers avatars plus local material retention with a scheduled local job, but still lacks cloud-storage lifecycle support
4. LangGraph now has branching, real vision integration, and review retry control, but still lacks retrieval, search, and external business tool execution
5. no E2E tests covering browser login, stream replay, thread settings, thread mutations, avatar upload, logout flow, refresh rotation, session management, and LangGraph flows

## 17. Recommended Next Steps

The next engineering steps SHOULD prioritize:

1. deepen LangGraph with retrieval, search, and business-grade tool nodes beyond the current vision + review baseline
2. evolve scheduled cleanup into a production retention strategy with cloud object storage and lifecycle policies
3. end-to-end browser coverage for auth, replay, uploads, avatar updates, refresh flows, session management, thread settings, and SSE flows
4. strengthen account recovery, password reset, and broader access-token revocation strategy

## 18. Change Control Principle

When updating this project:

1. backend schema changes MUST be reflected in both `app/models/schemas.py` and `frontend/src/app/types.ts`
2. new protected routes MUST be documented with their auth expectation
3. new SSE event types MUST be added to this document before being treated as stable
4. persistence changes MUST include an Alembic migration or an explicit migration note
5. frontend UX rules that affect message timing or session state SHOULD be documented here
6. this document SHOULD be updated in the same change set as the implementation
