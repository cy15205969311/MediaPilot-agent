# MediaPilot Agent 开发说明

更新时间：`2026-05-03`

`MediaPilot-agent` 是仓库名，代码与运行时中仍保留较多 `OmniMedia Agent` 命名。两者指向同一套系统：一个面向内容运营团队的 AI 内容工作台与管理后台一体化工程。

## 1. 项目概述

当前仓库由三套核心应用和一套共享后端组成：

- `app/`：`FastAPI` 后端，负责认证鉴权、会话历史、SSE 流式生成、素材解析、知识库、上传存储、管理端接口与 Token 流水。
- `frontend/`：C 端主工作台，面向内容创作与运营人员，提供聊天生成、知识库检索、草稿管理、历史会话与个人安全设置。
- `omnimedia-admin-web/`：B 端管理后台，面向管理员提供用户列表、账号状态控制、Token 额度调整与后台运营视图。
- `extension/`：浏览器扩展预留目录，用于后续发布链路或站外辅助能力接入。

系统默认使用：

- `SQLite` 作为本地开发数据库
- `uploads/` 作为本地文件存储目录
- 可选接入阿里云 `OSS`
- `LangGraph` 编排多模态工作流
- `OpenAI / DashScope / OpenAI-Compatible` 模型网关

## 2. 近期重要更新

以下内容已经体现在当前代码中，开发时请以此为准：

### 2.1 账号冻结与全局阻断

- 后端登录与鉴权链路会在用户状态为 `frozen` 时返回 `403 ACCOUNT_FROZEN`。
- 管理员冻结账号时，会同步撤销该用户的刷新会话并拉黑相关访问令牌。
- C 端前端全局拦截器会捕获 `ACCOUNT_FROZEN`，自动：
  - 清理本地登录态
  - 终止正在进行的流式请求
  - 跳转回登录页
  - 弹出冻结提示

### 2.2 管理端 Token 资产调度

- 管理员调整 Token 已升级为三种动作：
  - `add`：增加额度
  - `deduct`：扣减额度
  - `set`：直接设定余额
- 请求体要求携带必填 `remark`，用于审计追踪。
- 管理后台用户页已升级为“Token 资产调度台”交互，包含操作类型切换、快捷额度包与结果预览。

### 2.3 多模型真实计费

- `LangGraph` 状态中新增 `token_usage`，用于在多节点之间累计不同模型的真实消耗。
- 素材视觉解析节点、主生成节点、结构化产物节点都会分别记录自身模型用量。
- 最终记账逻辑不再按最终文本长度估算，而是按 `model_name -> token_count` 逐模型写入多条 `TokenTransaction`。

### 2.4 SQLite 事务隔离修复

- 为避免 SSE 生成期间长时间占用同一个数据库写事务，最终计费已切换为独立短生命周期会话。
- 计费阶段会使用单独的 `SessionLocal` 完成：
  - 用户余额扣减
  - 多条 Token 流水写入
  - `commit / rollback / close`
- 这样可以降低 SQLite 读写互斥对历史会话列表等只读接口的影响。

## 3. 仓库结构

```text
MediaPilot-agent/
├─ app/                        # FastAPI backend
│  ├─ api/v1/                  # 路由模块
│  ├─ db/                      # SQLAlchemy 引擎、Session、ORM 模型
│  ├─ models/                  # Pydantic 请求/响应模型
│  ├─ services/                # 业务服务、Graph、Provider、存储、鉴权
│  ├─ config.py                # 环境变量加载与运行时配置
│  └─ main.py                  # 应用入口
├─ alembic/                    # 数据库迁移
├─ frontend/                   # C 端主工作台
│  ├─ e2e/                     # Playwright 测试
│  └─ src/
├─ omnimedia-admin-web/        # B 端管理后台
│  └─ src/
├─ extension/                  # 浏览器扩展预留目录
├─ tests/                      # 后端测试
├─ uploads/                    # 本地上传资源
├─ .env.example                # 环境变量模板
├─ requirements.txt            # Python 依赖
├─ README.md                   # 中文开发说明
└─ DEVELOPMENT.md              # 英文开发基线
```

## 4. 技术栈

### 4.1 后端

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

### 4.2 前端

- `React 18`
- `Vite`
- `TypeScript`
- `Tailwind CSS`
- `Lucide React`
- `Playwright`

## 5. 本地启动

### 5.1 环境要求

- `Python 3.11+`
- `Node.js 18+`
- `npm 9+`

### 5.2 启动后端

```powershell
copy .env.example .env
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```

默认地址：

- `http://127.0.0.1:8000`
- `http://127.0.0.1:8000/docs`
- `http://127.0.0.1:8000/health`

### 5.3 启动 C 端工作台

```powershell
cd frontend
npm install
npm run dev
```

默认地址：

- `http://127.0.0.1:5173`

当前 Vite 代理：

- `/api -> http://127.0.0.1:8000`
- `/health -> http://127.0.0.1:8000`
- `/uploads -> http://127.0.0.1:8000`

### 5.4 启动 B 端管理后台

```powershell
cd omnimedia-admin-web
npm install
npm run dev
```

默认地址：

- `http://127.0.0.1:5174`

可选环境变量：

- `VITE_API_BASE_URL`：指定管理端 API 基础地址
- `VITE_CLIENT_APP_URL`：指定“返回工作台”按钮地址

### 5.5 首次安装 Playwright 浏览器

```powershell
cd frontend
npx playwright install chromium
```

## 6. 环境变量分组

建议从 `.env.example` 复制出 `.env` 后按分组补全。

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

## 7. 核心接口概览

### 7.1 基础与认证

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

### 7.2 内容工作台

- `POST /api/v1/media/chat/stream`
- `GET /api/v1/media/threads`
- `GET /api/v1/media/threads/{thread_id}/messages`
- `PATCH /api/v1/media/threads/{thread_id}`
- `DELETE /api/v1/media/threads/{thread_id}`
- `GET /api/v1/media/artifacts`
- `POST /api/v1/media/upload`
- `GET /api/v1/media/dashboard/summary`
- `GET /api/v1/models/available`

### 7.3 知识库、模板与选题

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

### 7.4 管理后台

- `GET /api/v1/admin/users`
- `POST /api/v1/admin/users/{user_id}/status`
- `POST /api/v1/admin/users/{user_id}/password-reset`
- `POST /api/v1/admin/users/{user_id}/tokens`
- `GET /api/v1/admin/dashboard`

## 8. 开发约束

### 8.1 分层原则

- `app/api/` 负责参数校验、依赖注入、响应码与错误返回
- `app/services/` 负责业务逻辑与外部能力编排
- `app/db/` 负责模型、引擎和 Session 管理
- `app/models/` 负责请求响应契约

### 8.2 SQLite 使用建议

- 不要在长时间流式输出过程中持有未提交写事务
- 写密集逻辑尽量使用短事务
- 遇到异常必须明确 `rollback`
- 框架托管 Session 与业务自建短会话不要混用职责

### 8.3 提交规范

推荐使用 Conventional Commits：

- `feat:` 新功能
- `fix:` 缺陷修复
- `refactor:` 重构但不改行为
- `docs:` 文档更新
- `test:` 测试补充
- `chore:` 工程维护

示例：

```text
feat: strengthen account freeze control and multimodal token billing
```

## 9. 联调与验收建议

### 9.1 账号冻结链路

1. 使用管理员冻结一个普通用户。
2. 验证该用户已被强制退出。
3. 验证其再次访问受保护接口时收到 `403 ACCOUNT_FROZEN`。

### 9.2 Token 调整链路

1. 在管理后台选择 `add / deduct / set` 任一动作。
2. 确认请求体包含 `action + amount + remark`。
3. 验证 `User.token_balance` 与 `TokenTransaction` 流水同步更新。

### 9.3 多模态计费链路

1. 发起“图片/视频解析 + 文案生成”任务。
2. 检查 `TokenTransaction` 是否出现多条不同模型记录。
3. 验证余额扣减总数等于各模型消耗之和。

---

如需英文工程基线，请查看 [DEVELOPMENT.md](./DEVELOPMENT.md)。
