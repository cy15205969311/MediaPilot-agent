# MediaPilot Agent 开发说明

更新时间：`2026-05-03`

`MediaPilot-agent` 是仓库名称，代码内部和运行时服务仍大量使用 `OmniMedia Agent` 命名。两者指向同一个项目：一个面向内容运营团队的 AI 工作台，覆盖内容策划、知识检索、素材解析、会话协作、草稿沉淀、图片生成与后台管理等完整链路。

## 1. 项目概览

当前仓库包含四个核心部分：

- `app/`：`FastAPI` 后端，负责鉴权、数据持久化、流式聊天、知识库、模板、选题、存储与管理接口。
- `frontend/`：面向内容生产与运营人员的主工作台，基于 `React 18 + Vite + TypeScript + Tailwind CSS v4`。
- `omnimedia-admin-web/`：面向运营后台与管理员的独立管理端，当前重点覆盖用户列表、状态控制、密码重置、额度调整和后台仪表盘。
- `extension/omnimedia-publisher/`：浏览器扩展辅助目录，用于后续发布链路或站外辅助能力接入。

项目的默认后端服务名为 `OmniMedia Agent API`，默认数据库为本地 `SQLite`，默认上传存储为本地 `/uploads`，在配置完整时可自动切换到阿里云 `OSS`。

## 2. 核心能力

### 2.1 后端能力

- 提供注册、登录、刷新令牌、退出登录、找回密码、站内改密、会话管理、用户资料更新等完整鉴权链路。
- 提供线程化聊天能力，支持 `SSE` 流式返回、聊天中止、历史回放、线程重命名与删除。
- 提供内容工作流接口，支持选题规划、正文生成、热点分析、评论回复等任务类型。
- 提供知识库接口，支持空间管理、文档上传、来源预览、来源删除、空间重命名与空间删除。
- 提供模板、选题、草稿箱、仪表盘、模型注册表、上传留存统计等业务接口。
- 提供管理后台接口，支持管理员查看用户、冻结/解冻账号、重置用户密码、增减额度。
- 提供本地存储与 `OSS` 双后端，支持签名地址、临时上传前缀、线程绑定后提级与生命周期任务。
- 提供图片生成与多模态解析链路，支持 `dashscope`、`openai` 兼容网关与关闭模式三种后端。

### 2.2 主工作台能力

- 中文内容工作台，包含仪表盘、聊天区、知识库、模板库、选题池、草稿箱等主视图。
- 支持流式消息渲染、引用审计面板、结构化产物侧栏、复制、导出与富文本剪贴板写入。
- 支持主题切换、模型选择、线程设置、附件上传和用户资料管理。

### 2.3 管理后台能力

- 独立登录页与鉴权守卫。
- 后台布局、数据看板、用户列表页和占位页面。
- 用户管理接口已对接 `/api/v1/admin/users` 相关能力。
- 管理端默认独立运行在 `5174` 端口，可通过 `VITE_API_BASE_URL` 指向任意后端环境。

## 3. 技术栈

### 3.1 后端

- `Python 3.11+`
- `FastAPI`
- `Pydantic v2`
- `SQLAlchemy 2`
- `Alembic`
- `LangGraph`
- `LangChain Core`
- `ChromaDB`
- `SQLite`
- `APScheduler`
- `oss2`

### 3.2 前端

- `React 18`
- `Vite`
- `TypeScript`
- `Tailwind CSS v4`
- `Lucide React`
- `Playwright`

## 4. 仓库结构

```text
MediaPilot-agent/
├─ app/                      # FastAPI backend
│  ├─ api/v1/                # Route modules
│  ├─ db/                    # Database session and ORM models
│  ├─ models/                # Pydantic request/response schemas
│  ├─ services/              # Business logic, graph, providers, storage
│  ├─ config.py              # Environment loading and runtime helpers
│  └─ main.py                # FastAPI app entrypoint
├─ alembic/                  # Database migrations
├─ frontend/                 # Main creator workspace
│  ├─ e2e/                   # Playwright tests
│  └─ src/
├─ omnimedia-admin-web/      # Admin console
│  └─ src/
├─ extension/                # Optional browser extension
├─ tests/                    # Backend pytest suite
├─ uploads/                  # Local uploaded assets
├─ .env.example              # Sample environment variables
├─ requirements.txt          # Python dependencies
├─ README.md                 # 中文说明
└─ DEVELOPMENT.md            # 英文开发基线
```

## 5. 快速开始

### 5.1 环境要求

- `Python 3.11+`
- `Node.js 18+`
- `npm 9+`
- Windows、macOS、Linux 均可；以下命令以 Windows PowerShell 为主

### 5.2 后端启动

```powershell
copy .env.example .env
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```

后端默认地址：

- `http://127.0.0.1:8000`
- OpenAPI 文档：`http://127.0.0.1:8000/docs`
- 健康检查：`http://127.0.0.1:8000/health`

### 5.3 主工作台启动

```powershell
cd frontend
npm install
npm run dev
```

主工作台默认地址：

- `http://127.0.0.1:5173`

当前 `frontend/vite.config.ts` 已配置代理：

- `/api -> http://127.0.0.1:8000`
- `/health -> http://127.0.0.1:8000`
- `/uploads -> http://127.0.0.1:8000`

### 5.4 管理后台启动

```powershell
cd omnimedia-admin-web
npm install
npm run dev
```

管理后台默认地址：

- `http://127.0.0.1:5174`

可选环境变量：

- `VITE_API_BASE_URL`：指定管理端请求的后端地址，默认 `http://127.0.0.1:8000`
- `VITE_CLIENT_APP_URL`：指定“返回工作台”按钮地址，默认 `http://127.0.0.1:5173`

### 5.5 浏览器自动化测试准备

首次运行主工作台 `Playwright` 用例前安装浏览器：

```powershell
cd frontend
npx playwright install chromium
```

## 6. 环境变量说明

建议先复制 `.env.example`，再按环境逐项补齐。重点分组如下：

### 6.1 大模型与工作流

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

### 6.2 图片生成与转写

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

### 6.3 存储

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

### 6.4 鉴权与基础设施

- `JWT_SECRET_KEY`
- `JWT_ALGORITHM`
- `JWT_ACCESS_EXPIRE_MINUTES`
- `JWT_REFRESH_EXPIRE_DAYS`
- `JWT_PASSWORD_RESET_EXPIRE_MINUTES`
- `CORS_ALLOWED_ORIGINS`
- `DATABASE_URL`

`.env` 包含密钥与私有地址，未提交到仓库。

## 7. API 概览

### 7.1 基础接口

- `GET /`
- `GET /health`
- `GET /docs`

### 7.2 鉴权与用户

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

### 7.3 内容工作台

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

### 7.4 模板、选题与知识库

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

### 7.5 管理后台

- `GET /api/v1/admin/users`
- `POST /api/v1/admin/users/{user_id}/status`
- `POST /api/v1/admin/users/{user_id}/reset-password`
- `POST /api/v1/admin/users/{user_id}/tokens`

## 8. 常用命令

### 8.1 后端

```powershell
pip install -r requirements.txt
alembic upgrade head
python -m pytest -q
uvicorn app.main:app --reload
```

### 8.2 主工作台

```powershell
cd frontend
npm install
npm run dev
npm run build
npm run test:e2e
npx playwright test --ui
```

### 8.3 管理后台

```powershell
cd omnimedia-admin-web
npm install
npm run dev
npm run build
npm run lint
```

## 9. 测试与验证建议

文档更新本身不需要改动业务代码，但涉及接口、数据模型、路由、上传链路或前端展示变更时，建议至少执行下列检查：

- 后端：`python -m pytest -q`
- 主工作台构建：`cd frontend && npm run build`
- 主工作台浏览器用例：`cd frontend && npm run test:e2e`
- 管理后台构建：`cd omnimedia-admin-web && npm run build`
- 管理后台静态检查：`cd omnimedia-admin-web && npm run lint`

如果本次修改只涉及文档，可在提交说明中明确写明“未执行自动化测试，仅更新文档”。

## 10. 开发协作约定

- 后端接口或数据契约变更时，必须同步更新 `app/models/schemas.py` 与前端类型定义。
- 迁移数据库结构时，必须补充 `Alembic` 迁移，不能只改 ORM。
- 涉及上传、知识库、图像生成、`OSS`、模型注册或流式协议变更时，必须同步更新根目录文档。
- 主工作台与管理后台共用同一后端时，注意 `CORS_ALLOWED_ORIGINS` 同时覆盖 `5173` 和 `5174`。
- 如果改动影响用户可见行为，请同时更新本文件和 `DEVELOPMENT.md`。

## 11. 文档分工

- `README.md`：中文总览、启动说明、目录说明和常用命令。
- `DEVELOPMENT.md`：英文工程基线、架构边界、接口分组、开发流程与变更要求。

后续如新增模块、独立服务、前端子应用、重要接口组或部署方式，请同步维护这两份文档。
