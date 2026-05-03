# MediaPilot Agent 开发说明

更新时间：`2026-05-03`

`MediaPilot-agent` 是当前仓库名；运行时、接口标题或部分历史代码中仍可能出现 `OmniMedia Agent` 命名。两者指向同一套系统：一个面向内容团队的 AI 创作工作台与管理后台一体化工程。

英文工程基线请查看 [DEVELOPMENT.md](./DEVELOPMENT.md)。

## 1. 文档定位

本文件用于说明当前仓库的中文开发基线，适合以下场景：

- 新成员快速理解仓库结构与运行拓扑
- 后端 `app/` 模块开发与联调
- C 端工作台 `frontend/` 开发
- B 端管理后台 `omnimedia-admin-web/` 开发
- 鉴权、流式生成、知识库、上传、计费与管理能力排障
- 提交、验收、交接与发布前自检

## 2. 项目概览

当前仓库由一套共享后端、两个前端应用和一个预留扩展目录组成：

- `app/`：`FastAPI` 后端，负责认证鉴权、历史会话、流式生成、素材解析、知识库、文件上传、管理员接口、仪表盘与 Token 流水
- `frontend/`：C 端内容工作台，面向创作者与运营同学，提供生成、改写、资产查看、知识检索、历史会话、个人资料与安全设置等能力
- `omnimedia-admin-web/`：B 端管理后台，面向管理员与运营角色，提供用户治理、资产调度、账号冻结、仪表盘与审计入口
- `extension/`：浏览器扩展或站外能力预留目录

默认本地基础设施：

- `SQLite` 作为本地数据库
- `uploads/` 作为本地文件存储目录
- 可选接入阿里云 `OSS`
- `LangGraph` 作为多模态工作流编排层
- `OpenAI / DashScope / OpenAI-Compatible` 作为模型接入网关

## 3. 仓库结构

```text
MediaPilot-agent/
|- app/
|  |- api/v1/                  # FastAPI 路由
|  |- db/                      # 引擎、Session、ORM 模型
|  |- models/                  # Pydantic Schema
|  |- services/                # 鉴权、Graph、Provider、存储、解析、调度与业务逻辑
|  |- config.py                # 环境变量与运行时配置
|  '- main.py                  # 应用入口
|- alembic/                    # 数据库迁移
|- frontend/                   # C 端工作台
|  |- e2e/                     # Playwright 测试
|  '- src/
|- omnimedia-admin-web/        # B 端管理后台
|  '- src/
|- extension/                  # 扩展预留目录
|- tests/                      # 后端测试
|- uploads/                    # 本地上传目录
|- .env.example                # 环境变量模板
|- requirements.txt            # Python 依赖
|- README.md                   # 中文开发说明
'- DEVELOPMENT.md              # 英文工程基线
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

默认代理：

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

- `VITE_API_BASE_URL`
- `VITE_CLIENT_APP_URL`

### 5.5 安装 Playwright 浏览器

```powershell
cd frontend
npx playwright install chromium
```

## 6. 环境变量分组

建议从 `.env.example` 复制生成 `.env` 后按模块补齐。

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

### 6.2 图像生成与转写

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

## 7. 当前工程基线

以下内容是当前代码仓库已经落地的真实行为，开发、联调与排障应以此为准。

### 7.1 账号冻结与全局阻断

- 登录与鉴权依赖会在用户状态为 `frozen` 时返回 `403 ACCOUNT_FROZEN`
- 管理端冻结用户时，会同步撤销该用户的 `RefreshSession`，并使相关访问令牌失效
- C 端全局拦截器会在收到 `ACCOUNT_FROZEN` 后自动：
  - 清理本地登录状态
  - 中断当前 SSE 流式连接
  - 跳转回登录页
  - 弹出冻结提示

### 7.2 Token 资产调度与商业化基线

- 管理员调整 Token 采用显式动作模型：
  - `add`
  - `deduct`
  - `set`
- 请求体必须同时携带：
  - `action`
  - `amount`
  - `remark`
- 新用户注册时会在同一事务中完成：
  - 创建 `User`
  - 写入初始 `token_balance = 10_000_000`
  - 写入一条 `TokenTransaction(transaction_type="grant")`
- 普通用户在 `token_balance <= 0` 时，会在模型调用前收到 `402 INSUFFICIENT_TOKENS`
- `super_admin` 与 `admin` 角色享有资产豁免：
  - 跳过事前余额检查
  - 跳过最终扣费流水
  - C 端资产区展示为无限额度

### 7.3 多模型真实计费

- `LangGraph` 状态中维护 `token_usage` 字典，结构为 `{model_name: token_count}`
- 素材解析节点、正文生成节点、结构化产物节点会分别累计自己的模型消耗
- 最终记账不再按输出字数估算，而是按真实模型消耗逐条写入 `TokenTransaction`
- 一次多模态任务可能生成多条模型流水，每条流水对应一个模型
- 管理团队账号不会写入普通消费流水

### 7.4 Provider 用量透传修复

为修复 `token_ledger skipped ... reason=no_tracked_usage`，Provider 层当前约束如下：

- 流式调用优先尝试 `stream_options={"include_usage": True}`
- `OpenAIProvider`、`CompatibleLLMProvider`、`QwenLLMProvider` 会在最终 `done` 事件中回传累计 `token_usage`
- 若上游拒绝 `include_usage` 或最终仍无法拿到 usage，会输出显式告警日志，不允许静默失败
- `agent.py` 会在最终记账前打印本次 `token_usage` 结果，便于快速定位问题是出在提取阶段还是状态传递阶段

### 7.5 SQLite 短事务隔离

由于 `SQLite` 采用文件级写锁，当前写路径必须坚持短事务原则：

- 流式输出期间不允许长期持有数据库写事务
- 最终记账使用独立、短生命周期的 `SessionLocal()`
- 记账逻辑必须显式执行 `commit / rollback / close`
- 这样可以降低会话历史、仪表盘、后台列表等只读接口被写锁阻塞的风险

### 7.6 智能预算熔断与负余额防穿透

这是本次更新新增的关键基线：

- `MediaChatRequest` 新增内部预算字段 `max_generation_tokens`
- `app/services/agent.py` 会在进入真实 Provider 前，根据普通用户当前余额动态注入运行时预算
- `app/services/providers.py` 会将该预算下传为兼容模型调用的 `max_tokens`
- 预算控制的目标是让模型在物理层面尽量不要生成超过当前余额可承受的结果

同时，最终记账层加入了零值兜底：

- 用户余额更新遵循 `zero-floor` 规则，最低只会落到 `0`
- 最终流水不再记录“理论透支额度”，只记录本次“实际可扣额度”
- 多模型任务下，实际可扣额度会按各模型占比拆分到多条真实流水中
- 即使上游模型没有完全遵守 `max_tokens`，数据库层也不会再出现负数余额

### 7.7 管理端用户中心治理升级

- 用户列表接口返回真实 `avatar_url`
- 管理后台统一使用 `UserAvatar` 展示真实头像，图片缺失时退回首字母头像
- 搜索框支持防抖与“清空即回表”
- `super_admin` 受前后端共同保护：
  - 后端拒绝冻结、重置密码、调整 Token
  - 前端仅允许查看详情，不暴露危险操作
- `super_admin` 与 `admin` 在后台按“无限额度”展示
- 行内浮层危险菜单已被右侧详情抽屉替代，规避表格 `overflow` 裁剪问题

### 7.8 管理端最近活跃设备链路

这是本次更新新增的第二条关键基线：

- `GET /api/v1/admin/users` 现在会为当前页每个用户附带 `latest_session`
- `latest_session` 当前包含：
  - `device_info`
  - `ip_address`
  - `last_seen_at`
  - `created_at`
- 后端通过 `RefreshSession` 为每个用户选择最近活跃的一条会话记录
- 管理后台用户列表“最近活跃”列不再使用占位文案，而是渲染：
  - 设备信息，如 `Chrome · Windows`
  - 相对活跃时间，如“刚刚”“xx 分钟前”“xx 小时前”
  - 必要时附带 `IP`
- 详情抽屉中的“最近活跃”信息也与列表保持一致

### 7.9 C 端素材上传体验升级

当前 C 端输入区已经升级为统一素材接入链路：

- 点击上传、剪贴板粘贴、拖拽上传都会进入同一条素材队列
- `frontend/src/app/components/Composer.tsx` 只负责采集原始 `File[]`
- 统一的队列与上传流程由 `frontend/src/app/App.tsx` 承接
- 前端校验规则与后端 `app/api/v1/oss.py` 保持一致

支持格式：

- 图片：`.jpg .jpeg .png .webp`
- 视频：`.mp4 .mov .avi .wmv`
- 音频：`.mp3 .wav .flac .m4a .ogg`
- 文档：`.txt .pdf .md .docx`

当前限制：

- 单次捕获最多 `12` 个文件
- 同一发送队列最多 `9` 张图片
- 大小限制：
  - 图片 / 文档：`15MB`
  - 音频：`100MB`
  - 视频：`300MB`

已知限制：

- 仍为整文件直传，未接入分片上传
- 暂无字节级进度条
- 前端主要展示 `uploading / ready / error` 等状态

### 7.10 C 端结果面板资产包与上下文接力

右侧结果面板已从“只展示最后一条产物”升级为“会话级资产包”：

- 会从当前 Thread 的 `messages` 中提取结构化 `artifact`
- 会按任务类型建立本地索引与 Tab
- 切换顶部任务选择器时，不会把已生成资产直接清空

当前本地资产类别：

- `content_generation`
- `comment_reply`
- `topic_planning`
- `hot_post_analysis`

当前接力逻辑：

- 若当前任务类型已有对应资产，则优先激活该资产 Tab
- 若切换到 `comment_reply` 时当前线程只有正文没有评论，则显示智能空状态，而不是伪造内容
- 智能空状态可触发一次显式的后续请求，基于当前正文继续生成评论回复

## 8. 后端边界与分层规则

### 8.1 路由分组

当前 `app/api/v1/` 下主要路由包括：

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

### 8.2 分层原则

- `app/api/` 负责请求校验、鉴权依赖、HTTP 状态码与响应模型
- `app/services/` 负责工作流、Provider、解析、存储与业务逻辑
- `app/db/` 负责引擎、Session、ORM 模型与迁移兼容
- `app/models/` 负责 Pydantic Schema 与共享 API 契约

避免把复杂数据库逻辑和跨模块业务逻辑长期堆在路由层。

## 9. 核心接口概览

### 9.1 认证与用户

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

### 9.2 媒体与生成工作流

- `POST /api/v1/media/chat/stream`
- `GET /api/v1/media/threads`
- `GET /api/v1/media/threads/{thread_id}/messages`
- `PATCH /api/v1/media/threads/{thread_id}`
- `DELETE /api/v1/media/threads/{thread_id}`
- `GET /api/v1/media/artifacts`
- `POST /api/v1/media/upload`
- `GET /api/v1/media/dashboard/summary`
- `GET /api/v1/models/available`

### 9.3 知识库、模板与选题

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

### 9.4 管理端

- `GET /api/v1/admin/users`
- `POST /api/v1/admin/users/{user_id}/status`
- `POST /api/v1/admin/users/{user_id}/reset-password`
- `POST /api/v1/admin/users/{user_id}/tokens`
- `GET /api/v1/admin/dashboard`

## 10. 验证清单

提交前至少验证你实际改动覆盖到的部分。

### 10.1 通用验证

- 后端语法检查：`python -m compileall app`
- 若改动 `frontend/`：执行对应构建或针对性验证
- 若改动 `omnimedia-admin-web/`：执行对应构建或针对性验证
- 若改动 Schema：检查前后端契约兼容性
- 若改动数据库写路径：重点检查 `SQLite` 锁与事务释放

### 10.2 本次功能重点验证

1. 冻结普通用户并确认其被强制登出。
2. 使用 `add / deduct / set` 三种方式调度 Token，并确认余额与流水一致。
3. 跑一次音频、图片或视频参与的多模态任务，确认存在按模型拆分的 `TokenTransaction`。
4. 普通用户余额为 `0` 时，请求 `POST /api/v1/media/chat/stream`，确认收到 `402 INSUFFICIENT_TOKENS`。
5. 普通用户余额较小但发起长内容任务时，确认最终余额不会降到 `0` 以下。
6. 如 Provider 未完全遵守预算，确认数据库最终余额仍被零值兜底保护。
7. 检查日志是否出现：
   - `include_usage rejected`
   - `agent.stream final token_usage ...`
   - `agent.stream token_ledger recorded ... billed_total=...`
8. 打开管理后台用户列表并确认：
   - 最近活跃列能显示真实设备信息
   - 能显示相对时间与必要的 IP
   - 无会话记录的用户展示“暂无活动记录”
9. 打开用户详情抽屉并确认最近活跃信息与列表一致。
10. 再次确认 `GET /api/v1/media/threads`、后台列表、仪表盘等只读接口未因记账写锁异常而超时。

## 11. 提交规范

当前仓库使用 Conventional Commits。

- `feat:` 新功能或能力增强
- `fix:` Bug 修复
- `refactor:` 不改变外部行为的结构调整
- `docs:` 仅文档变更
- `test:` 测试补充或调整
- `chore:` 维护性任务

示例：

```text
feat: harden token billing safeguards and surface admin session activity
```

如果一次提交同时包含功能代码和文档，请优先根据“主要变更内容”选择类型；本次这类代码与文档同步更新，使用 `feat:` 最合适。
