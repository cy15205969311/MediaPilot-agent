# OmniMedia Agent Development Guide

## 1. Document Info

- Document: `DEVELOPMENT.md`
- Current version: `v1.13.30`
- Updated on: `2026-04-30`
- Scope: current repository implementation, including backend gateway, dual-token authentication, password-reset recovery flows, tenant isolation, tracked user-scoped uploads, storage-backend abstraction with local and OSS support, signed delivery URL resolution, managed OSS lifecycle helpers, upload cleanup, scheduled material GC, thread-linked material retention, temporary-object promotion, thread persistence, provider abstraction, dedicated Qwen provider fallback orchestration, LangGraph vision-aware orchestration, document parsing, docx document parsing, video transcription, search routing, multi-step ReAct-style business-tool execution with provider-level `bind_tools` support, Tavily-backed market-intelligence business tools with safe mock fallback, UTC timestamp normalization, user profile management, session visibility, frontend workspace, persistent preset-plus-user template-library CRUD with Chinese management UX, a local-first template center with hidden Skills entry, `100+` industry presets across `10` categories, knowledge-base-scoped templates, a multi-tenant knowledge workspace with txt/md ingestion, scope management, same-source upsert, chunk preview, citation-aware RAG prompt injection, citation-rendered chat replies, user-level productivity dashboard, conversation-to-template capture, a topic-pool kanban with CRUD, thread binding, drafting-state transitions, new-thread cascade prefill, Qwen model selection override, artifact-level and chat-bubble copy interactions, rich-text clipboard delivery, Markdown export delivery, global dual-theme support, expanded Playwright end-to-end browser coverage for thread lifecycle, replay, profile/session security, upload, artifact-action flows, and verification baseline

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
31. Playwright end-to-end browser coverage for auth, password reset, refresh retry, thread lifecycle, replay, profile/session security, uploads, artifact follow-up actions, drafts lifecycle management, template-library cascade flows, and streamed chat flows.
32. Extensible LangGraph Business Tools architecture with tool-call routing, local Python tool execution, and `<business_tool_context>` injection before drafting.
33. Sidebar-driven workspace view routing with an authenticated drafts aggregation page backed by persisted `ArtifactRecord` history.
34. Draft lifecycle management across single delete, batch delete, and clear-all operations for authenticated artifact cards.
35. Persistent template-library API with preset seeding, user-scoped CRUD, Chinese management UI, and new-thread cascade prefill.
36. Multi-tenant knowledge-base management with authenticated scope listing, txt/md upload chunking, same-source upsert, chunk-content preview, per-user scope/source deletion, unsupported-format prevalidation, inline upload-error surfacing, and a dedicated frontend knowledge workspace.
37. User-level productivity dashboard with aggregated draft generation, topic lifecycle, knowledge-base asset counts, estimated words/tokens, and recent activity trend visualization.
38. LangGraph multimodal attachment parsing for txt/md/pdf documents plus moviepy-and-Whisper-backed video transcription, with progress tool calls and `<document_context>` / `<video_transcript>` prompt injection.
39. Dedicated `QwenLLMProvider` with three-tier fallback (`qwen-max -> qwen-plus -> qwen-turbo`), per-request `model_override`, and a frontend model selector persisted in local storage.
40. Backend-driven model registry delivery through `GET /api/v1/models/available`, seeded with an Aliyun DashScope model catalog and consumed by a searchable grouped frontend selector with provider status awareness.
41. Frontend artifact delivery now supports per-block clipboard copy with success-state feedback plus full Markdown export downloads from both header and right-panel actions, covering content-generation, topic-planning, hot-post-analysis, and comment-reply artifacts.
42. Assistant chat bubbles now reuse the shared frontend copy control so plain conversational replies can be copied directly from the main chat feed with the same success-state feedback used by artifact panels.
43. Clipboard writes now deliver both `text/plain` and `text/html` payloads so Markdown-like content can paste into rich editors with headings, bold text, lists, and paragraphs preserved.
44. Chat attachment parsing now accepts `.docx` materials through the shared upload pipeline and extracts paragraph plus table text into the existing `<document_context>` injection path.
45. Knowledge-base RAG prompts now include citation-aware source registries, instructing the model to cite knowledge usage with `[n]` markers and append a final reference list when private knowledge influences the answer.
46. Assistant chat bubbles now render `[n]` references as superscript citation markers and expose the resolved source name through hoverable hints whenever the answer includes a reference list or source-tagged RAG context.

### 3.2 Out of Scope

The following capabilities are intentionally not production-complete yet:

1. third-party SSO or enterprise identity providers
2. access-token revocation lists, device fingerprints, or organization-wide session-management dashboards
3. production observability, rate limiting, or audit logging
4. deeper external business integrations beyond the current Tavily-backed Business Tools baseline
5. CDN invalidation, multi-bucket governance, or a full operator-facing retention control plane beyond the current authenticated retention summary endpoint
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
|  |     |- oss.py
|  |     '- templates.py
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
|     |- template_library.py
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
|     |- 20260425_06_refresh_session_metadata.py
|     |- 20260427_01_material_message_link.py
|     '- 20260428_01_template_library.py
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
|           |- views/
|           |  |- DraftsView.tsx
|           |  |- TopicsView.tsx
|           |  '- TemplatesView.tsx
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
- `langchain-text-splitters==0.3.11`
- `PyPDF2==3.0.1`
- `moviepy==2.2.1`
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
- `OMNIMEDIA_LLM_PROVIDER=mock|openai|compatible|qwen|langgraph|auto`
- `QWEN_API_KEY`
- `QWEN_BASE_URL`
- `QWEN_PRIMARY_MODEL`
- `QWEN_ARTIFACT_MODEL`
- `QWEN_FALLBACK_MODELS`
- `QWEN_TIMEOUT_SECONDS`
- `QWEN_RETRY_ATTEMPTS`
- `QWEN_RETRY_BASE_DELAY_SECONDS`
- `QWEN_ENABLE_TOOL_BINDING`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `OPENAI_ARTIFACT_MODEL`
- `OPENAI_VISION_MODEL`
- `OPENAI_TRANSCRIPTION_API_KEY`
- `OPENAI_TRANSCRIPTION_BASE_URL`
- `OPENAI_TRANSCRIPTION_MODEL`
- `OPENAI_TIMEOUT_SECONDS`
- `LANGGRAPH_INNER_PROVIDER=mock|openai|compatible|qwen`
- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_MODEL`
- `LLM_ARTIFACT_MODEL`
- `LLM_VISION_MODEL`
- `LLM_TIMEOUT_SECONDS`
- `MEDIA_PARSER_DOWNLOAD_TIMEOUT_SECONDS`
- `MEDIA_PARSER_TRANSCRIPTION_TIMEOUT_SECONDS`
- `MEDIA_PARSER_DOCUMENT_MAX_CHARS`
- `MEDIA_PARSER_TRANSCRIPT_MAX_CHARS`
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
- `OSS_SIGNED_URL_MIN_EXPIRE_SECONDS`
- `OSS_SIGNED_URL_MAX_EXPIRE_SECONDS`
- `OSS_TMP_UPLOAD_EXPIRE_DAYS`
- `OSS_THREAD_UPLOAD_TRANSITION_DAYS`
- `OSS_THREAD_UPLOAD_TRANSITION_STORAGE_CLASS`
- `OSS_AUTO_SETUP_LIFECYCLE`

The committed `.env.example` now includes:

- provider selection defaults for `LangGraphProvider`
- text-model and artifact-model placeholders
- vision-model placeholders for multimodal OCR
- optional Tavily search placeholders for real-time web retrieval and market-intelligence business tools
- optional OSS storage placeholders with `auto`, `local`, and `oss` backend selection
- signed delivery URL and lifecycle tuning placeholders for OSS production rollouts
- password-reset token lifetime placeholder for local development
- local SQLite and JWT defaults for development

Current Qwen-provider example:

```env
OMNIMEDIA_LLM_PROVIDER=langgraph
LANGGRAPH_INNER_PROVIDER=qwen
QWEN_API_KEY=your_dashscope_api_key
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_PRIMARY_MODEL=qwen-max
QWEN_ARTIFACT_MODEL=qwen-max
QWEN_FALLBACK_MODELS=qwen-plus,qwen-turbo
QWEN_TIMEOUT_SECONDS=120
QWEN_RETRY_ATTEMPTS=3
QWEN_RETRY_BASE_DELAY_SECONDS=1
QWEN_ENABLE_TOOL_BINDING=false
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
| `GET` | `/api/v1/models/available` | authenticated provider-grouped model registry with provider status and grouped model metadata |
| `POST` | `/api/v1/media/chat/stream` | authenticated SSE media task stream with optional `model_override` for runtime provider model selection |
| `GET` | `/api/v1/media/threads` | authenticated paginated thread list |
| `GET` | `/api/v1/media/threads/{thread_id}/messages` | authenticated thread replay |
| `GET` | `/api/v1/media/artifacts` | authenticated artifact aggregation for drafts workspace |
| `GET` | `/api/v1/media/dashboard/summary` | authenticated productivity and asset dashboard summary for the current user |
| `GET` | `/api/v1/media/knowledge/scopes` | list owned knowledge scopes with chunk and source counts |
| `POST` | `/api/v1/media/knowledge/upload` | upload txt/md knowledge content into an owned scope; same filename in the same scope is overwritten by deleting old chunks first |
| `PATCH` | `/api/v1/media/knowledge/scopes/{scope}` | rename one owned knowledge scope and sync bound thread/template references |
| `DELETE` | `/api/v1/media/knowledge/scopes/{scope}` | delete all owned chunks for one knowledge scope |
| `GET` | `/api/v1/media/knowledge/scopes/{scope}/sources` | list distinct uploaded sources inside one owned knowledge scope |
| `GET` | `/api/v1/media/knowledge/scopes/{scope}/sources/{source}/preview` | rebuild one source preview by joining stored chunks with Markdown separators |
| `DELETE` | `/api/v1/media/knowledge/scopes/{scope}/sources/{source}` | delete one uploaded source and all of its owned chunks |
| `GET` | `/api/v1/media/topics` | authenticated topic-pool list with optional status filter |
| `POST` | `/api/v1/media/topics` | create a new owned topic idea |
| `PATCH` | `/api/v1/media/topics/{topic_id}` | update owned topic content or lifecycle status |
| `DELETE` | `/api/v1/media/topics/{topic_id}` | delete an owned topic record |
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
6. provider stream execution with optional per-request `model_override` cloning plus provider-prefix runtime routing such as `dashscope:qwen-max -> QwenLLMProvider`
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

### 9.5 Draft Aggregation Contracts

#### `ArtifactListItem`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `str` | artifact record identifier |
| `thread_id` | `str` | owning thread identifier |
| `thread_title` | `str` | owning thread title for navigation fallback |
| `message_id` | `str` | linked assistant message identifier |
| `artifact_type` | artifact discriminator | mirrors the structured artifact union |
| `title` | `str` | card title |
| `excerpt` | `str` | concise preview text derived from the artifact payload |
| `platform` | `"xiaohongshu" \| "douyin" \| "both" \| null` | best-effort inferred platform |
| `created_at` | ISO 8601 UTC string | artifact creation timestamp |
| `artifact` | `ArtifactPayloadModel` | full structured payload for detail preview |

#### `ArtifactListResponse`

| Field | Type | Notes |
| --- | --- | --- |
| `items` | `list[ArtifactListItem]` | newest-first drafts payload |
| `total` | `int` | returned item count |

#### `ArtifactDeleteBatchRequest`

| Field | Type | Notes |
| --- | --- | --- |
| `message_ids` | `list[str]` | selected assistant message identifiers to delete |
| `clear_all` | `bool` | when `true`, deletes every owned artifact-linked draft for the current user |

#### `ArtifactDeleteResponse`

| Field | Type | Notes |
| --- | --- | --- |
| `deleted_count` | `int` | number of deleted artifact-linked messages |
| `deleted_message_ids` | `list[str]` | deleted assistant message identifiers |
| `cleared_all` | `bool` | indicates whether the mutation was a full clear-all operation |

#### `TemplateListItem`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `str` | built-in template identifier |
| `title` | `str` | template card title |
| `description` | `str` | short usage summary shown in the template center |
| `platform` | `"小红书" \| "抖音" \| "闲鱼" \| "技术博客"` | publishing context label used for filtering and badges |
| `category` | `"美妆护肤" \| "美食文旅" \| "职场金融" \| "数码科技" \| "电商/闲鱼" \| "教育/干货"` | industry grouping used by the template center |
| `knowledge_base_scope` | `str \| null` | optional downstream RAG / knowledge-base scope |
| `system_prompt` | `str` | prompt body copied into the new-thread modal |
| `is_preset` | `bool` | whether the template is an official preset |
| `created_at` | `str` | UTC timestamp |

#### `TemplateListResponse`

| Field | Type | Notes |
| --- | --- | --- |
| `items` | `list[TemplateListItem]` | available built-in templates |
| `total` | `int` | returned template count |

#### `TemplateSkillSearchResponse`

| Field | Type | Notes |
| --- | --- | --- |
| `query` | `str` | normalized discovery query sent to the Skills backend |
| `category` | `str \| null` | optional category filter |
| `items` | `list[TemplateSkillDiscoveryItem]` | discovered reusable prompt cards |
| `total` | `int` | returned discovery count |
| `data_mode` | `"mock" \| "mock_fallback" \| "live_tavily"` | whether Skills discovery used mock fallback or live Tavily search |
| `fallback_reason` | `str \| null` | optional note when live discovery falls back |

### 9.6 Artifact Contracts

Current stable artifact payloads:

- `TopicPlanningArtifactPayload`
- `ContentGenerationArtifactPayload`
- `HotPostAnalysisArtifactPayload`
- `CommentReplyArtifactPayload`

These payloads are shared by backend validation, SSE `artifact` events, history replay, and frontend right-panel rendering.

### 9.7 Timestamp Contract

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
- `qwen`
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
2. `parse_materials_node` emits attachment-progress `tool_call` events, converts raw materials into summarized text clues, extracts txt/md/pdf documents into `<document_context>`, and transcribes video speech into `<video_transcript>`
3. after parse, the graph conditionally routes to `ocr_node` only when image materials are present
4. after parse or OCR, the graph conditionally routes to `search_node` only when `needs_search == true`
5. `search_node` emits `web_search` tool events, prefers real Tavily search when configured, and otherwise falls back to deterministic mock search results
6. `generate_draft_node` first invokes a tool-aware planner created via `inner_provider.bind_tools(...)` when the provider supports it, and otherwise falls back to deterministic heuristic planning so Mock and test providers remain stable
7. the planner appends `AIMessage` entries into `GraphState.messages`; if `AIMessage.tool_calls` are present, the graph routes to `tool_execution_node`, otherwise final drafting proceeds through the configured inner provider with XML-style `<image_context>`, `<document_context>`, `<video_transcript>`, `<search_context>`, and `<business_tool_context>` blocks injected when those contexts exist
8. `tool_execution_node` emits `tool_call` progress, executes local Python tools from `app/services/tools.py`, stores `ToolMessage` results in graph state, and loops back to `generate_draft_node` until the planner stops requesting tools or `business_tool_max_iterations` is reached
9. the current baseline supports sequential Business Tools such as Tavily-backed `analyze_market_trends` followed by local `generate_content_outline`, which enables a real ReAct-style "analyze first, draft later" loop before the final draft is streamed
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
23. setting `OSS_AUTO_SETUP_LIFECYCLE=true` provisions those lifecycle rules on backend startup and through the daily `oss_lifecycle_rollout` scheduler job
24. signed URL expiry is clamped by configurable min/max bounds to avoid accidentally issuing too-short or too-long delivery URLs
25. authenticated users can query `GET /api/v1/media/retention` for user-scoped upload counts, byte totals, stale temporary material counts, and effective OSS retention policy knobs
26. partial files are cleaned up on failure

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
22. lightweight workspace view routing between `chat`, `drafts`, and placeholder business modules without introducing a full client router
23. authenticated drafts aggregation loading and thread handoff from artifact cards back into persisted chat history
24. optimistic local drafts lifecycle updates after single delete, batch delete, and clear-all mutations
25. template-center loading, platform filtering, and one-click cascade into the prefilled new-thread modal

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
- `fetchArtifacts()`
- `fetchTemplates()`
- `createTemplate()`
- `deleteTemplate()`
- `deleteTemplates()`
- `deleteArtifact()`
- `deleteArtifacts()`
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
- `Template`
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

`Template` now includes:

- `user_id`
- `title`
- `description`
- `platform`
- `category`
- `system_prompt`
- `is_preset`
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
11. `20260428_01_template_library.py`

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
46. Playwright auth coverage verifies browser registration/login token persistence, password-reset form transition, logout local-storage cleanup, and `401 -> refresh -> retry` recovery on protected workspace bootstrap
47. Playwright workspace coverage verifies new-thread modal creation, startup thread replay, thread settings persistence, sidebar rename/delete flows, and streamed chat rendering for user and assistant bubbles
48. Playwright profile coverage verifies nickname, bio, avatar, and in-session password updates through the profile modal with immediate workspace sync
49. Playwright session-management coverage verifies session list refresh, targeted non-current device revocation, and password-change-driven session pruning
50. Playwright upload-plus-SSE coverage verifies image material upload, the chat thinking timeline fed by `tool_call` SSE events, assistant response completion, and right-panel artifact follow-up actions
51. Business Tool registry exports OpenAI-compatible function schemas and typed live-or-fallback tool outputs
52. LangGraph business-tool execution routes from draft generation to local tool execution and loops back with `<business_tool_context>` before review
53. OSS delivery URLs are generated as signed previews instead of persisted long-lived public links
54. profile avatars and thread-history materials resolve frontend URLs dynamically from normalized storage references
55. unbound OSS material uploads are staged under a temporary prefix and promoted to permanent object keys on thread bind
56. Aliyun OSS lifecycle setup provisions both temporary-object expiration and aged-object storage transitions
57. upload persistence normalization accepts signed OSS URLs and rewrites them back to managed storage paths safely
58. signed OSS delivery policy is bounded by min/max expiry controls and accepts both custom public-base URLs plus canonical bucket endpoint signed URLs during normalization
59. the scheduler can automatically roll out OSS lifecycle rules on startup and every 24 hours when `OSS_AUTO_SETUP_LIFECYCLE=true`
60. `GET /api/v1/media/retention` exposes an authenticated, user-scoped retention summary for upload counts, byte totals, stale temporary uploads, and effective lifecycle/signed-URL policy values
61. `GET /api/v1/media/artifacts` returns user-scoped structured drafts ordered newest-first with thread handoff metadata and best-effort platform inference
62. Playwright workspace coverage verifies the drafts empty state, draft-detail preview, and "open in conversation" navigation flow
63. `GET /api/v1/media/templates` returns built-in prompt templates, and Playwright workspace coverage verifies template-center rendering plus one-click modal prefilling
64. LangGraph attachment parsing now reads txt/md/pdf uploads into `<document_context>`, transcribes video speech into `<video_transcript>`, and streams parsing progress back through `tool_call` SSE events
65. the frontend chat feed now aggregates live `tool_call` SSE events into a collapsible "AI thinking" panel so long-running parsing, search, and review steps remain visible without polluting the main message timeline

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

The following checks were executed for the current knowledge-workspace change set on `2026-04-29` and passed:

```bash
python -m pytest -q
cd frontend
npm run build
```

Observed result baseline:

- full backend test suite: 114 passed
- frontend production build: passed
- frontend Playwright E2E suite: last verified at 21 passed on the previous frontend-focused change set
- covered browser flows: auth bootstrap, password-reset request UX, logout cleanup, protected-route refresh retry, thread creation/replay/settings/rename/delete, drafts empty-state/reopen/single-delete/bulk-delete/clear-all flow, template-center render/use-template cascade flow, preset/custom template creation plus batch deletion, profile avatar/nickname/bio updates, active-session refresh and revoke, in-session password change, upload plus tool-call streaming feedback, and right-panel artifact follow-up actions
- existing auth, scheduler, upload-retention, OSS signed-delivery, LangGraph search/tool, Tavily-backed business-tool live/fallback, and multimodal OCR regression suites remain green under the expanded browser baseline

### 15.4 Current Warning

Current tests still emit a deprecation warning from `httpx` used by `FastAPI TestClient` regarding the deprecated `app` shortcut. This does not block execution but SHOULD be cleaned up during future dependency maintenance.

## 16. Current Implementation Status

### 16.1 Completed in v1.13.30

This version adds or solidifies:

- `frontend/src/app/components/views/KnowledgeView.tsx` now performs client-side file-extension validation for both the global uploader and the scope drawer uploader before any network request is made, blocking unsupported formats such as `.docx` from entering the knowledge ingestion path and surfacing a local inline error banner that names the rejected files.
- `frontend/src/app/App.tsx` now returns structured knowledge-upload feedback to the view layer, so backend failures such as `415 Unsupported Media Type` can be echoed directly inside the knowledge workspace instead of only appearing as a distant status change or system message.
- `frontend/e2e/fixtures.ts` now mocks the authenticated knowledge scope list/upload routes, including the backend-style `415` rejection for unsupported file extensions, so browser regressions around knowledge upload UX can be exercised without a live backend.
- `frontend/e2e/chat.spec.ts` now verifies that unsupported knowledge uploads are intercepted in the UI, emit an inline user-facing error, and never fire a `POST /api/v1/media/knowledge/upload` request when the selected file type is outside the supported txt/md/markdown set.
- `app/services/graph/provider.py` now builds citation-aware knowledge-base context blocks, deduplicates source filenames into a numbered registry, and injects explicit drafting instructions that require `[n]` citations plus a final “参考资料” section whenever RAG knowledge is used in the answer.
- the RAG context builder now preserves repeated chunks from the same source under a stable citation number, so multiple retrieved slices from one docx or markdown file point back to the same source identifier instead of fragmenting into fake references.
- `frontend/src/app/components/ChatFeed.tsx` now parses assistant message references, renders inline `[n]` markers as superscript citations, and surfaces the resolved source filename through a hover hint, making private-knowledge answers easier to trust without leaving the chat flow.
- `tests/test_graph_tools.py` now verifies the knowledge-base prompt includes citation instructions plus a deduplicated source registry, while `frontend/e2e/chat.spec.ts` now verifies that rendered assistant citations expose the expected hover hint in the chat UI.

### 16.2 Completed in v1.13.28

This version adds or solidifies:

- `frontend/src/app/components/CopyButton.tsx` now writes both `text/plain` and `text/html` clipboard payloads through `ClipboardItem` when available, converting basic Markdown-like syntax into rich HTML so paste targets such as Word, Feishu Docs, or other WYSIWYG editors can preserve headings, bold emphasis, lists, blockquotes, and paragraph structure.
- all existing copy affordances that already reuse `CopyButton` now inherit the richer clipboard behavior automatically, covering artifact blocks plus assistant chat bubbles without adding separate copy implementations.
- `app/services/media_parser.py` now supports `.docx` documents through `python-docx`, extracting readable paragraph text and table cell content before passing the normalized output through the same truncation and `<document_context>` injection pipeline used for txt, md, and pdf files.
- `app/api/v1/oss.py`, `frontend/src/app/components/Composer.tsx`, and `requirements.txt` now allow `.docx` uploads as document materials and declare the new parser dependency explicitly.
- `tests/test_media_parser.py`, `tests/test_oss.py`, and `frontend/e2e/chat.spec.ts` now verify docx parsing/upload acceptance plus rich clipboard writes for both plain text and HTML clipboard targets.

### 16.3 Completed in v1.13.27

This version adds or solidifies:

- `frontend/src/app/components/CopyButton.tsx` now uses the native Clipboard API with a textarea fallback, switching from the copy icon to a green check state for 2 seconds after a successful copy so users get immediate confirmation.
- `frontend/src/app/artifactMarkdown.ts` now centralizes Markdown export assembly for all structured artifact types, formatting content-generation drafts, topic-planning lists, hot-post analysis, and comment-reply suggestions into stable `.md` downloads through the browser Blob API.
- `frontend/src/app/App.tsx` now replaces the previous export placeholder with a real `handleExportMarkdown(...)` workflow, wiring both the workspace header button and the right-panel artifact action to the same download logic and surfacing a user-facing status update after export.
- `frontend/src/app/components/artifacts/ContentGenerationArtifact.tsx`, `TopicPlanningArtifact.tsx`, `HotPostAnalysisArtifact.tsx`, and `CommentReplyArtifact.tsx` now expose copy affordances for individual artifact blocks such as title candidates, body copy, CTA copy, topic angles, goals, analysis insights, reusable templates, reply suggestions, and compliance notes.
- `frontend/src/app/components/ChatFeed.tsx` now reuses the shared `CopyButton` inside assistant message action bars, so operators can copy ordinary AI replies directly from the conversation stream instead of only from structured artifact panels.
- `frontend/e2e/chat.spec.ts` now verifies that assistant replay bubbles expose the new copy action and that clicking it writes the full assistant message into the mocked browser clipboard.
- the content-delivery loop is now materially complete inside the frontend workspace: operators can copy polished text blocks directly into publishing back offices or export the full structured artifact as Markdown for review, archiving, and downstream editing.

### 16.4 Completed in v1.13.25

This version adds or solidifies:

- `app/services/agent.py` now resolves request-time `model_override` values before execution, splitting provider-scoped IDs such as `dashscope:qwen2.5` into `provider_prefix + actual_model` and routing them through a factory instead of only delegating to the default provider clone path.
- when the active top-level provider is `LangGraphProvider`, request-time provider routing now rebuilds a fresh workflow wrapper around the dynamically selected inner provider, preserving the existing route analyzer, vision analyzer, search analyzer, timeout settings, and business-tool iteration guardrails while replacing only the runtime LLM engine.
- `dashscope` / `qwen` scoped overrides now instantiate `QwenLLMProvider`, `openai:` overrides instantiate `OpenAIProvider`, and `mock:` overrides instantiate `MockLLMProvider`, so frontend model selection no longer falls back to `.env` defaults when the selected provider differs from `LANGGRAPH_INNER_PROVIDER`.
- `app/services/graph/provider.py` now logs both the runtime inner provider class and its effective model name at `langgraph.stream start`, making backend verification explicit during model-switch acceptance checks.
- `tests/test_qwen_provider.py` now includes a regression that starts from a `LangGraphProvider(inner_provider=CompatibleLLMProvider(...))` baseline and verifies that `dashscope:qwen2.5` is routed into a fresh `QwenLLMProvider` at runtime instead of silently staying on the compatible default path.
- the committed `.env.example` already points `LANGGRAPH_INNER_PROVIDER=qwen`; local private `.env` files SHOULD follow the same default when DashScope/Qwen is intended to be the normal inner engine, while request-time overrides still take precedence.

### 16.5 Completed in v1.13.24

This version adds or solidifies:

- `app/services/model_registry.py`, `app/models/schemas.py`, `app/api/v1/models.py`, and `app/main.py` now expose an authenticated `GET /api/v1/models/available` registry endpoint, currently seeded with an Aliyun DashScope catalog and grouped model metadata for frontend consumption.
- DashScope registry entries now carry stable frontend IDs, raw runtime model names, provider status labels, capability groups, and lightweight tags so the selector can mimic Dify-style search and grouped browsing without hardcoding model options in the UI.
- `app/services/providers.py` now normalizes provider-scoped overrides such as `dashscope:qwen-max`, allowing the frontend to send registry IDs while keeping Qwen runtime invocation compatible with the existing fallback stack and safely ignoring mismatched provider prefixes.
- `frontend/src/app/components/ModelSelector.tsx`, `frontend/src/app/components/AppHeader.tsx`, `frontend/src/app/api.ts`, `frontend/src/app/types.ts`, and `frontend/src/app/App.tsx` now replace the static Qwen dropdown with a backend-driven searchable grouped selector, persist the selected registry ID locally, and continue forwarding `model_override` on `/api/v1/media/chat/stream`.
- `tests/test_chat.py` now covers authentication and payload shape for `/api/v1/models/available`, while `tests/test_qwen_provider.py` verifies DashScope-prefixed override compatibility inside `QwenLLMProvider`.
- `app/services/media_parser.py` now centralizes attachment deep parsing, supporting txt/md decoding, full-PDF text extraction through `PyPDF2`, remote-or-local material resolution, and OpenAI-compatible Whisper transcription after `moviepy` audio extraction.
- `app/services/graph/provider.py` now enriches `parse_materials_node` with document parsing and video transcription progress messages, appends `<document_context>` and `<video_transcript>` blocks into downstream drafting context, and degrades gracefully when a single attachment fails to parse.
- `frontend/src/app/components/views/DashboardView.tsx` now turns the sidebar Data Dashboard entry into a professional SaaS cockpit with stat cards, 14-day productivity bars, topic lifecycle progress, and knowledge/token asset snapshots.
- `frontend/src/app/components/views/KnowledgeView.tsx`, `frontend/src/app/App.tsx`, `frontend/src/app/api.ts`, `frontend/src/app/types.ts`, and `frontend/src/app/components/LeftSidebar.tsx` now deliver a dedicated knowledge workspace with global upload, drawer-bound append/overwrite upload, scope rename, grouped source inspection, chunk-content preview, single-file deletion, and whole-scope deletion interactions.
- scope rename now also rewrites current-user `Thread.knowledge_base_scope` and `Template.knowledge_base_scope` references so existing bindings continue to resolve after the rename.
- `tests/test_media_parser.py` now verifies local document parsing, `<document_context>` / `<video_transcript>` injection into LangGraph draft requests, and graceful attachment-parse degradation without collapsing the chat flow.
- `tests/test_chat.py` now covers user-scoped upload/list/delete flows, grouped source management, scope rename conflict handling, and seeded-knowledge fallback, and the current repository baseline is verified by backend tests plus a passing frontend production build.

### 16.6 Completed in v1.13.23

This version adds or solidifies:

1. `TopicRecord` now persists an optional `thread_id`, backed by Alembic migration `20260429_03_topic_thread_binding.py`, so every topic can bind to a single drafting conversation and avoid spawning duplicate chat threads.
2. `app/api/v1/topics.py`, `app/models/schemas.py`, and `frontend/src/app/types.ts` now expose `thread_id` across topic read/write contracts, allowing topic cards to distinguish first-time drafting from resume-drafting flows.
3. `frontend/src/app/App.tsx` now splits topic actions into two paths: first-time drafting binds a generated thread identifier and opens the existing new-thread modal, while already-bound topics skip the modal and jump directly back into the original chat history.
4. When a bound topic points to a thread that no longer exists in persisted history, the workspace now falls back to a restored draft session using the same reserved `thread_id`, instead of silently creating a second fragmented conversation chain.
5. `frontend/src/app/components/views/TopicsView.tsx` now upgrades the primary card CTA from “一键生成草稿” to “继续撰写” whenever a topic already owns a bound thread, making the lifecycle state obvious from the board itself.
6. `tests/test_chat.py`, `frontend/e2e/fixtures.ts`, and `frontend/e2e/chat.spec.ts` now cover topic thread binding, resume-drafting behavior, and the topic-to-chat cascade alongside the earlier topic-pool CRUD baseline.
7. `TopicRecord` remains part of the ORM baseline through `20260429_02_topic_pool_records.py`, and the topics workspace still provides authenticated CRUD, status filtering, a Chinese three-column kanban view, and stable left/right state transitions instead of drag-and-drop risk.
8. Triggering topic drafting continues to align workspace platform, prefill a topic-specific system prompt, and advance status toward `drafting`, preserving the content-ops loop from inspiration capture into generation.
9. `Template` plus `Thread` continue to persist `knowledge_base_scope`, backed by Alembic migrations `20260428_02_template_growth_ecosystem.py` and `20260429_01_thread_knowledge_base_scope.py`, so template-bound knowledge scopes survive from template selection through thread creation, replay, follow-up turns, and final generation.
10. `app/services/template_library.py` continues to generate and runtime-sync `100+` preset templates across 美妆护肤、美食文旅、职场金融、数码科技、电商/闲鱼、教育/干货、房产/家居、汽车/出行、母婴/宠物、情感/心理 10 大行业, while preserving deterministic legacy ids for key cards and pruning stale preset rows from older seed sets.
11. `frontend/src/app/components/views/TemplatesView.tsx` remains a local-first template center with hidden Skills UI, keyword search, 10 category pills, preset/custom badges, batch selection, batch deletion, and one-click apply.
12. `python -m pytest` plus Playwright browser coverage remain green for topic thread binding, resume drafting, topic CRUD, the larger preset inventory, hidden Skills entry, new category tabs, and artifact-to-template capture.

### 16.7 Completed in v1.13.15

This version adds or solidifies:

1. `Template` persistence is now part of the core ORM baseline, backed by Alembic migration `20260428_01_template_library.py` and runtime-safe preset seeding through `app/services/template_library.py`.
2. `GET /api/v1/media/templates` now merges global preset templates with user-owned custom templates, while `POST /api/v1/media/templates`, `DELETE /api/v1/media/templates/{template_id}`, and `DELETE /api/v1/media/templates` provide ownership-safe CRUD coverage.
3. `frontend/src/app/components/views/TemplatesView.tsx` is now a full Chinese template-management workspace with industry pill tabs, keyword search, preset badges, create-modal workflow, single delete, batch delete, and one-click apply.
4. `frontend/src/app/App.tsx`, `frontend/src/app/api.ts`, and `frontend/src/app/types.ts` now own template mutation state, Chinese template contracts, and the preset/custom cascade back into the new-thread modal.
5. `frontend/e2e/fixtures.ts`, `frontend/e2e/chat.spec.ts`, and `tests/test_chat.py` now cover preset listing, custom creation, protected deletion, batch cleanup, and browser-level template management regressions.

### 16.8 Completed in v1.13.14

This version adds or solidifies:

1. `GET /api/v1/media/templates` now serves an authenticated built-in template catalog with curated Xiaohongshu, Xianyu, and TechBlog system prompts.
2. `frontend/src/app/components/views/TemplatesView.tsx` now delivers a dedicated template center with platform filters, production-style cards, prompt previews, and a one-click "Use Template" action.
3. `frontend/src/app/App.tsx` now owns template loading state plus the cross-view cascade that returns the user to chat, opens the new-thread modal, and prefills title plus `system_prompt` from the selected template.
4. `frontend/e2e/fixtures.ts` and `frontend/e2e/chat.spec.ts` now cover template-center rendering and the template-to-modal prefill flow without requiring a live backend.
5. `tests/test_chat.py`, `README.md`, and `DEVELOPMENT.md` now lock the built-in template API baseline and the updated verification counts.

### 16.9 Completed in v1.13.13

This version adds or solidifies:

1. `DELETE /api/v1/media/artifacts/{message_id}` now removes a single owned artifact-linked assistant message and cascades its persisted `ArtifactRecord`.
2. `DELETE /api/v1/media/artifacts` now supports both selected batch deletion through `message_ids` and a full clear-all mutation through `clear_all=true`.
3. `frontend/src/app/App.tsx` now owns draft-mutation callbacks and keeps the drafts workspace responsive by filtering deleted cards out of local state immediately after successful mutations.
4. `frontend/src/app/components/views/DraftsView.tsx` now adds selection state, card-level delete actions, a bulk action bar, and a clear-all affordance while preserving search, filters, detail preview, and thread handoff.
5. `tests/test_chat.py`, `frontend/e2e/fixtures.ts`, and `frontend/e2e/chat.spec.ts` now lock backend ownership-safe draft deletion plus browser coverage for single delete, bulk delete, and clear-all flows.

### 16.10 Completed in v1.13.12

This version adds or solidifies:

1. `GET /api/v1/media/artifacts` now aggregates user-owned `ArtifactRecord` rows into a drafts-friendly API payload that includes excerpt text, thread handoff metadata, full structured artifact payloads, and best-effort platform inference.
2. `frontend/src/app/App.tsx` now owns a lightweight workspace view switcher so the authenticated shell can move between chat, drafts, and future business modules without destabilizing the existing chat workflow.
3. `frontend/src/app/components/views/DraftsView.tsx` now delivers a dedicated drafts page with responsive artifact cards, search, platform filters, empty state, modal detail preview, and one-click navigation back to the source conversation.
4. `frontend/src/app/components/LeftSidebar.tsx` now upgrades the business-module area from static placeholders into real workspace navigation, while cleaning up the current Chinese labels and wiring "我的草稿" to the new view.
5. `frontend/e2e/fixtures.ts`, `frontend/e2e/chat.spec.ts`, and `tests/test_chat.py` now lock the drafts aggregation API plus end-to-end browser behavior for empty-state rendering and draft-to-thread reopen flows.

### 16.11 Completed in v1.13.11

This version adds or solidifies:

1. `app/services/tools.py` now upgrades `analyze_market_trends` from a deterministic mock-only tool to a Tavily-backed market-intelligence tool that returns live search-derived hot keywords, traffic notes, evidence sources, and a safe mock fallback payload when no API key is configured or the upstream call fails.
2. `tool_execution_node` now executes business tools through `asyncio.to_thread(...)`, preventing live network-backed tool calls from blocking the LangGraph event loop while preserving the existing ReAct loop contract.
3. `tests/test_graph_tools.py` now locks three business-tool modes explicitly: mock-only baseline, live Tavily-backed market-trend enrichment, and failure fallback to deterministic mock output.
4. `.env.example` now documents that `TAVILY_API_KEY` powers both LangGraph search retrieval and the market-intelligence business tool path.
5. `README.md` and `DEVELOPMENT.md` now document the live-or-fallback Business Tool baseline so the roadmap no longer treats all market-trend tooling as purely mock data.

### 16.12 Completed in v1.13.10

This version adds or solidifies:

1. frontend workspace surfaces now expose stable `data-testid` anchors for workspace title, composer input, sidebar rename/delete actions, right-panel artifact actions, and profile-password form assertions.
2. `frontend/e2e/chat.spec.ts` now covers sidebar prompt-based rename, confirm-based delete, fallback-history reload, in-session password change, and artifact-action follow-up flows on top of the previous replay/upload/session baseline.
3. the stateful Playwright mock backend continues to drive these richer thread-lifecycle and security-tab flows without requiring a live backend service, keeping browser regression coverage deterministic.
4. right-panel artifact actions are now locked by browser tests that verify prompt priming and cross-platform workspace toggling from persisted artifact history.
5. Playwright browser coverage now spans the full high-frequency authenticated workspace lifecycle except archive-specific and live-backend delivery paths, reducing regression risk across the operator journey.
6. `README.md` and `DEVELOPMENT.md` now document the expanded `14 passed` browser baseline and the narrowed remaining E2E gaps.

### 16.13 Completed in v1.13.9

This version adds or solidifies:

1. `frontend/e2e/fixtures.ts` now provides a stateful mock backend that can simulate thread history, profile mutations, session revocation, upload responses, refresh-token retries, and richer SSE event sequences for browser regression coverage.
2. frontend workspace surfaces now expose stable `data-testid` anchors for thread settings, profile/session management, uploads, tool-call chat notices, and workspace status assertions.
3. `frontend/e2e/auth.spec.ts` now covers protected-route `401 -> refresh -> retry` recovery in addition to registration, password-reset request, and logout cleanup.
4. `frontend/e2e/chat.spec.ts` now covers startup replay of persisted thread history, thread settings persistence, profile avatar/nickname/bio updates, active-session refresh and revocation, and image-upload plus tool-call streaming feedback.
5. Playwright coverage now exercises much more of the authenticated workspace lifecycle without requiring a live backend, reducing regression risk across the highest-frequency operator flows.
6. `README.md` and `DEVELOPMENT.md` now document the expanded browser verification baseline and the increased E2E surface area.

### 16.14 Completed in v1.13.8

This version adds or solidifies:

1. `AliyunOSSClient` now exposes `generate_presigned_url()` and `setup_bucket_lifecycle()` so production deployments can serve time-limited delivery URLs and provision native OSS lifecycle rules for temporary cleanup plus cold-storage transition.
2. the shared storage abstraction now supports `build_delivery_url(...)`, `build_temporary_object_key(...)`, and synchronous copy-based promotion, keeping local and OSS behavior aligned behind the same persistence boundary.
3. unbound OSS material uploads are now staged under `uploads/tmp/{user_id}/{filename}`, while thread binding promotes them to permanent `uploads/{user_id}/{filename}` object keys and rewrites `UploadRecord` plus `Material` storage references accordingly.
4. profile avatars, thread-history materials, and upload responses now persist normalized managed-storage paths and resolve frontend-facing URLs dynamically, so the database no longer depends on long-lived OSS public URLs.
5. LangGraph OCR image resolution can now consume OSS-managed image materials by converting normalized stored paths into signed delivery URLs before remote download.
6. `tests/test_oss.py`, `tests/test_oss_client.py`, `README.md`, `.env.example`, and `DEVELOPMENT.md` now lock the signed delivery, lifecycle, promotion, and normalization baseline.

### 16.15 Completed in v1.13.7

This version adds or solidifies:

1. `BaseLLMProvider` now exposes optional `bind_tools(...)`, and both `OpenAIProvider` plus `CompatibleLLMProvider` adapt LangChain-style tool binding on top of their existing `AsyncOpenAI` clients.
2. `LangGraphProvider` now initializes a provider-level tool planner with `inner_provider.bind_tools(get_business_tools())` when available, while preserving heuristic fallback for Mock/test providers.
3. Business Tool planning now supports autonomous and sequential ReAct loops, so planning-heavy requests can proactively call `analyze_market_trends`, then `generate_content_outline`, and only then hand off to the final drafting provider.
4. post-draft routing now inspects only the latest `AIMessage.tool_calls`, which prevents stale historical tool-call messages from causing recursive loopbacks.
5. `pytest.ini` constrains default discovery to `tests/`, so `python -m pytest -q` no longer walks transient `uploads/` directories during collection.
6. `tests/test_graph_tools.py`, `README.md`, and `DEVELOPMENT.md` now lock the sequential Business Tools baseline, title-only single-tool fallback, and the updated verification entrypoint.

### 16.16 Completed in v1.13.6

This version adds or solidifies:

1. `app/services/tools.py` defines typed LangChain Core Business Tools including `analyze_market_trends` and `generate_content_outline` with deterministic mock JSON outputs.
2. `LangGraphProvider` now carries normalized tool-call state through `AIMessage` / `ToolMessage` compatible graph messages.
3. `generate_draft_node` can request Business Tools before final drafting, route to `tool_execution_node`, and loop back with `<business_tool_context>` injected into the final draft request.
4. `tool_execution_node` emits SSE `tool_call` progress events for `processing`, `completed`, and `failed` states while executing local Python tools.
5. `tests/test_graph_tools.py` locks the tool schema export, mock tool output, and ReAct loopback behavior without requiring live model credentials.
6. `README.md` and `DEVELOPMENT.md` now document the Business Tools architecture and preserve the mandatory documentation-update rule.

### 16.17 Completed in v1.13.5

This version adds or solidifies:

1. `frontend/playwright.config.ts` defines the Playwright browser E2E baseline with `http://localhost:5173` as `baseURL` and an automatic `npm run dev` web server.
2. `frontend/e2e/auth.spec.ts` covers registration/login token persistence, password-reset request-to-reset-form transition, and logout local-storage cleanup.
3. `frontend/e2e/chat.spec.ts` covers new-thread modal creation and streamed chat rendering for user and assistant bubbles.
4. `frontend/e2e/fixtures.ts` provides deterministic API mocks so browser smoke tests do not require a live backend during frontend regression runs.
5. frontend components now expose stable accessibility labels and `data-testid` anchors for critical auth, workspace, composer, and chat-bubble assertions.
6. `README.md` and `DEVELOPMENT.md` now document E2E setup, commands, coverage scope, and the mandatory documentation-update rule for future changes.

### 16.18 Completed in v1.13.4

This version adds or solidifies:

1. `app/services/auth.py` now supports short-lived password-reset JWT creation and verification through a dedicated `reset` token type
2. `app/api/v1/auth.py` now exposes `password-reset-request` and `password-reset` routes, logs a local-development recovery link, and revokes every active session after a successful token-based reset
3. the authenticated `reset-password` route remains available for in-session password changes while preserving only the current device session
4. the frontend auth card now supports forgot-password request and token-based reset flows, and it clears any cached local session data after a successful recovery reset
5. `.env.example`, `README.md`, and `DEVELOPMENT.md` now document the password-reset capability, reset-token lifetime, and global forced sign-out behavior
6. regression coverage and frontend production build validation now explicitly include account-recovery and password-reset compatibility

### 16.19 Current Non-Blocking Gaps

The project is now a stronger SaaS-ready MVP, but the following gaps remain:

1. access tokens are now tied to the refresh-session chain, but there is still no separate global access-token blacklist or organization-wide forced-revocation control plane
2. password reset now works for local development, but there is still no real email/SMS delivery channel, signed recovery URL distribution, or admin-assisted recovery workflow
3. upload cleanup now covers avatars plus local and OSS-backed material retention, OSS delivery now uses signed URLs with lifecycle-ready prefixes, lifecycle rollout can be automated, and users can inspect retention summaries, but the project still lacks CDN invalidation, multi-bucket governance, and a full admin retention console
4. LangGraph now has branching, real vision integration, txt/md/pdf/docx attachment parsing, video transcription, search routing, review retry control, provider-level `bind_tools`, Tavily-backed market-intelligence Business Tools, template-bound knowledge-base retrieval, citation surfacing in the chat UI, and a user-managed multi-tenant knowledge workspace, but the project still lacks advanced vector backends, stronger retrieval observability, product/CRM integrations, and broader live business-system connectivity
5. E2E coverage now spans auth, refresh retry, thread lifecycle, replay, profile/session security, uploads, tool-call streaming with the chat thinking panel, artifact-side follow-up actions, local-first template-center management, artifact-to-template capture, and artifact copy/export affordances, but still needs expansion for archive controls and live backend plus OSS browser paths beyond the current mocked regression harness

## 17. Recommended Next Steps

The next engineering steps SHOULD prioritize:

1. evolve the current tenant-scoped RAG ingestion baseline into a richer document pipeline with Docx and spreadsheet loaders, citation surfacing, chunk inspection, stronger embeddings or vector backends, and broader internal or external business-system integrations such as product, competitor, CRM, or private knowledge sources
2. harden OSS governance further with CDN invalidation, multi-bucket policy rollout, admin retention analytics, and richer signed-download policy controls on top of the current lifecycle rollout and retention-summary baseline
3. expand browser coverage further into archive controls and live backend/OSS delivery flows beyond the current mocked regression baseline
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
