# MediaPilot Agent 开发说明

更新时间：`2026-05-03`

`MediaPilot-agent` 是仓库名，运行时与部分历史代码中仍会出现 `OmniMedia Agent` 命名。两者指向同一套系统：一个面向内容运营团队的 AI 内容工作台与管理后台一体化工程。

英文工程基线请查看 [DEVELOPMENT.md](./DEVELOPMENT.md)。

## 1. 项目概览

当前仓库由一套共享后端、两个前端应用和一个扩展预留目录组成：

- `app/`：`FastAPI` 后端，负责认证鉴权、会话历史、流式生成、素材解析、知识库、文件上传、管理端接口与 Token 流水。
- `frontend/`：C 端内容工作台，面向创作者与运营同学，提供生成、草稿、知识库、历史会话、个人资料与安全设置等功能。
- `omnimedia-admin-web/`：B 端管理后台，面向管理员提供用户管理、账号冻结、Token 调度、后台概览等能力。
- `extension/`：浏览器扩展或站外辅助能力的预留目录。

本地开发默认使用：

- `SQLite` 作为数据库
- `uploads/` 作为本地文件存储目录
- 可选接入阿里云 `OSS`
- `LangGraph` 作为多模态工作流编排层
- `OpenAI / DashScope / OpenAI-Compatible` 作为模型网关

## 2. 仓库结构

```text
MediaPilot-agent/
|- app/                        # FastAPI backend
|  |- api/v1/                  # 路由模块
|  |- db/                      # SQLAlchemy 引擎、Session、ORM 模型
|  |- models/                  # Pydantic 请求/响应模型
|  |- services/                # 鉴权、Graph、Provider、存储、解析与业务逻辑
|  |- config.py                # 环境变量与运行时配置
|  '- main.py                  # 应用入口
|- alembic/                    # 数据库迁移
|- frontend/                   # C 端内容工作台
|  |- e2e/                     # Playwright 测试
|  '- src/
|- omnimedia-admin-web/        # B 端管理后台
|  '- src/
|- extension/                  # 扩展预留目录
|- tests/                      # 后端测试
|- uploads/                    # 本地上传素材
|- .env.example                # 环境变量模板
|- requirements.txt            # Python 依赖
|- README.md                   # 中文开发说明
'- DEVELOPMENT.md              # 英文工程基线
```

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

### 3.2 前端

- `React 18`
- `Vite`
- `TypeScript`
- `Tailwind CSS`
- `Lucide React`
- `Playwright`

## 4. 当前工程基线

以下能力已经落入当前代码，请开发与联调时以此为准。

### 4.1 账号冻结与全局阻断

- 登录接口与鉴权依赖会在用户状态为 `frozen` 时返回 `403 ACCOUNT_FROZEN`。
- 管理员冻结账号时，会同步撤销该用户的刷新会话并使相关访问令牌失效。
- C 端前端全局拦截器在收到 `ACCOUNT_FROZEN` 后会自动：
  - 清理本地登录状态
  - 中断正在进行的流式生成
  - 跳转登录页
  - 弹出冻结提示

### 4.2 Token 资产调度与商业化基线

- 管理员调整 Token 支持三种显式动作：
  - `add`：增加额度
  - `deduct`：扣减额度
  - `set`：直接设定余额
- 请求体必须携带 `action + amount + remark`。
- 新用户注册时会在同一事务中完成：
  - 创建用户
  - 写入初始 `token_balance = 10_000_000`
  - 写入一条 `TokenTransaction(transaction_type="grant")`
- 普通用户在 `token_balance <= 0` 时，会在模型调用前直接收到 `402 INSUFFICIENT_TOKENS`。
- `super_admin` 与 `admin` 享受资产豁免：
  - 跳过事前余额检查
  - 跳过最终 Token 扣减
  - C 端资产区显示 `∞ 无限算力`

### 4.3 多模型真实计费

- `LangGraph` 状态字典中新增 `token_usage`，用于累计 `{model_name: token_count}`。
- 素材解析节点、主生成节点、结构化产物节点会分别记录各自模型消耗。
- 最终记账不再按输出文本长度估算，而是按真实模型消耗逐条写入 `TokenTransaction`。
- 用户余额扣减总数等于所有模型消耗之和。
- 管理团队账号不会写入普通消费流水。

### 4.4 Provider 用量透传修复

为修复 `token_ledger skipped ... reason=no_tracked_usage`，当前 Provider 层已经补齐以下约束：

- 流式兼容接口优先尝试 `stream_options={"include_usage": True}`。
- `OpenAIProvider`、`CompatibleLLMProvider`、`QwenLLMProvider` 会在最终 `done` 事件中回传累计 `token_usage`。
- 当上游拒绝 `include_usage` 或最终仍然拿不到 usage 时，会输出显式警告日志，避免静默失败。
- `agent.py` 在最终记账前会打印本次 `token_usage`，便于快速定位问题是否出在提取阶段还是状态传递阶段。

### 4.5 SQLite 短事务隔离

- 流式生成期间不允许长期持有数据库写事务。
- 最终记账使用独立、短生命周期的 `SessionLocal()`：
  - 扣减余额
  - 写入多条 Token 流水
  - 显式执行 `commit / rollback / close`
- 这样可以降低 `SQLite` 写锁阻塞历史会话、仪表盘等只读接口的风险。

### 4.6 管理端用户中心治理升级

- 管理端用户列表接口会返回 `avatar_url`，前端可直接渲染真实头像。
- 新增统一的 `UserAvatar` 组件：
  - 优先展示头像图片
  - 图片缺失或加载失败时回退为珊瑚橙首字母头像
- 搜索框支持防抖与“清空即回表”。
- `super_admin` 在前后端均受保护：
  - 后端禁止冻结、重置密码、调整 Token
  - 前端仅保留查看详情能力
- `super_admin` 与 `admin` 在管理后台中以“无限额度”展示。
- 原有行内悬浮操作菜单已移除，危险操作统一收敛到右侧详情抽屉，规避表格 `overflow` 裁剪问题。

### 4.7 C 端素材上传体验升级

当前 `frontend` 的输入区已经完成一次体验升级，素材接入统一由 `App.tsx` 控制，`Composer.tsx` 负责捕获原始文件事件：

- 支持三种素材进入方式：
  - 点击上传
  - `Ctrl + V` 剪贴板粘贴
  - 拖拽文件到输入区
- 输入区拖拽时会显示品牌色高亮与“松开鼠标即可上传”的提示层。
- 图片与非图片附件会进入同一套待上传队列，统一复用现有 `POST /api/v1/media/upload` 链路。

前端文件校验已与后端 `app/api/v1/oss.py` 对齐：

- 支持格式：
  - 图片：`.jpg .jpeg .png .webp`
  - 视频：`.mp4 .mov .avi .wmv`
  - 音频：`.mp3 .wav .flac .m4a .ogg`
  - 文档：`.txt .pdf .md .docx`
- 单次捕获最多处理 `12` 个素材。
- 图片仍保留最多 `9` 张的业务限制。
- 大小限制：
  - 图片 / 文档 / 默认：`15MB`
  - 音频：`100MB`
  - 视频：`300MB`

当前已知限制：

- 仍然是单次整文件上传，尚未接入分片上传。
- 目前没有字节级百分比进度条。
- 前端只展示队列状态：`uploading / ready / error` 与辅助状态文案。

### 4.8 C 端结果面板资产包与上下文接力流

当前 `frontend` 的右侧结果面板已经从“单个最新产物渲染器”升级为“会话级资产包”：

- 会从当前 Thread 的 `messages` 中提取所有结构化 `artifact`，按任务类型建立本地索引。
- 支持在同一会话下以本地 Tab 方式切换查看不同产物：
  - `正文草稿`
  - `互动评论`
  - `选题方案`
  - `爆款拆解`
- 顶部全局任务切换器仍然是“输入任务类型”而不是“后端多任务批处理开关”，不会自动让后端一次性生成所有产物。
- 右侧面板内部会维护独立的当前查看状态，避免用户切换顶部任务时把已生成产物清空。

当前已落地的“上下文接力流”行为：

- 如果会话里已经存在对应类型产物，切换到相应任务时会优先展示该结果。
- 如果用户切换到 `评论回复`，但当前会话还没有评论产物、只有正文草稿：
  - 右侧面板会展示智能空状态卡片
  - 引导文案会提示“检测到当前会话已有正文”
  - 点击按钮后会自动带着隐藏 prompt 发起一次新的评论回复任务
- 接力生成仍然复用原有单任务后端链路，不改后端任务模型与计费口径。

当前范围说明：

- 已落地的一键接力目标主要是“正文草稿 -> 评论回复”。
- 右侧底部动作区会始终作用于当前选中的 artifact，而不是盲目作用于最后一次生成结果。

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

- `VITE_API_BASE_URL`
- `VITE_CLIENT_APP_URL`

### 5.5 安装 Playwright 浏览器

```powershell
cd frontend
npx playwright install chromium
```

## 6. 环境变量分组

建议从 `.env.example` 复制出 `.env` 后按分组补齐。

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

### 6.2 图像生成与转录

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
- `POST /api/v1/admin/users/{user_id}/reset-password`
- `POST /api/v1/admin/users/{user_id}/tokens`
- `GET /api/v1/admin/dashboard`

## 8. 开发约束

### 8.1 分层原则

- `app/api/` 负责请求校验、依赖注入、响应码与错误返回。
- `app/services/` 负责业务逻辑、模型调用、Graph 编排、存储与持久化辅助。
- `app/db/` 负责 ORM 模型、Session 与数据库配置。
- `app/models/` 负责请求/响应契约。

### 8.2 SQLite 使用建议

- 不要在长时间流式输出期间持有未提交写事务。
- 写密集逻辑应尽量使用短事务。
- 遇到异常必须显式 `rollback`。
- 框架托管 Session 与业务自建短会话要分清职责。

### 8.3 Provider 计费约束

- 流式模型接入时优先开启 `include_usage`。
- Provider 的最终 `done` 事件必须显式携带 `token_usage`。
- LangGraph 节点修改状态时必须通过 `return` 返回更新值，不能只做原地修改。
- 新增模型接入时要同步验证：
  - 流式 usage 是否可用
  - 结构化调用是否能取到 usage
  - 最终 `token_ledger` 是否能落账

### 8.4 素材上传约束

- 前端支持的格式与大小限制必须与后端 `app/api/v1/oss.py` 保持一致。
- 新增文件格式时，必须同时修改：
  - 后端扩展名白名单
  - 前端校验规则
  - 文件选择器 `accept`
  - 开发文档
- 在接入分片上传前，不要在 UI 中误导性展示伪进度百分比。

### 8.5 结果面板与接力流约束

- 顶部任务切换器默认仍然表示“下一次请求要发起什么任务”，不是后端批量多任务开关。
- 右侧资产包只能基于当前会话中已经存在的 artifact 做聚合展示，不能伪造未生成产物。
- 新增接力流场景时，优先走“前端引导 + 隐藏 prompt + 单任务请求”模式，避免一次请求堆叠多个重任务。
- 右侧动作区必须始终绑定当前选中的 artifact，避免导出、存模板、发布误作用于其他结果。

### 8.6 提交规范

推荐使用 Conventional Commits：

- `feat:` 新功能
- `fix:` 缺陷修复
- `refactor:` 重构但不改变行为
- `docs:` 文档更新
- `test:` 测试补充
- `chore:` 工程维护

示例：

```text
feat: add asset matrix handoff flow to creator workspace
```

## 9. 联调与验收建议

### 9.1 账号冻结链路

1. 由管理员冻结一个普通用户。
2. 验证该用户会被强制退出。
3. 验证其再次访问受保护接口时收到 `403 ACCOUNT_FROZEN`。

### 9.2 Token 调整链路

1. 在管理后台选择 `add / deduct / set` 任一动作。
2. 确认请求体包含 `action + amount + remark`。
3. 验证余额与 Token 流水同步更新。

### 9.3 多模型计费链路

1. 发起“音频/视频/图片解析 + 文案生成”任务。
2. 检查日志中是否出现最终 `token_usage`。
3. 检查 `TokenTransaction` 是否出现多条不同模型记录。
4. 验证余额扣减总数等于各模型消耗之和。

### 9.4 C 端素材上传链路

1. 点击上传一张受支持图片，确认进入待上传队列并最终变为 `已就绪`。
2. 对输入框执行 `Ctrl + V` 粘贴截图，确认无需手动选文件即可开始上传。
3. 将图片、音频、视频或文档拖拽到输入区，确认出现高亮提示并可成功入队。
4. 拖入不支持格式文件，确认收到明确的警告提示。
5. 拖入超限文件，确认收到“文件过大，无法处理”的提示。
6. 单次拖入超过 `12` 个文件或图片超过 `9` 张，确认系统会自动截断并提示。

### 9.5 C 端结果面板资产包与接力流

1. 在同一会话中先生成一份正文草稿，再继续生成评论回复或选题方案。
2. 打开右侧面板，确认会出现本地 Tab 资产包而不是只保留最后一个结果。
3. 切换顶部任务类型时，确认右侧已生成产物不会被意外清空。
4. 将顶部任务切换到 `评论回复`，且当前会话只有正文没有评论时：
   - 右侧应显示智能空状态卡片
   - 文案应明确提示检测到了正文草稿
   - 点击主按钮后应自动发起新的评论回复任务
5. 生成完成后确认右侧出现新的 `互动评论` Tab。
6. 在不同 Tab 下执行“导出 Markdown / 存为模板 / 去发布”等操作，确认作用目标是当前选中的 artifact。

### 9.6 管理端用户中心验收点

1. 在用户列表中确认真实头像可显示，失效地址会自动回退为首字母头像。
2. 验证搜索框在输入后会自动筛选，清空关键字后会自动恢复全量列表。
3. 检查 `super_admin` 行：
   - Token 列显示 `∞ 无限制`
   - 不再出现危险操作入口
4. 检查普通用户行：
   - 可正常打开右侧详情抽屉
   - 可在抽屉中执行冻结、重置密码与 Token 调整

### 9.7 注册与商业化风控验收点

1. 新注册一个普通用户，确认其初始余额为 `10,000,000`。
2. 检查数据库中是否同步写入一条 `grant` 类型 Token 流水。
3. 将普通用户余额调整为 `0` 后再次发起内容生成，确认接口直接返回 `402 INSUFFICIENT_TOKENS`。
4. 检查前端会弹出商业化风控提示，而不是静默失败。

### 9.8 管理团队无限黑卡验收点

1. 将测试账号角色设为 `admin` 或 `super_admin` 且余额设为 `0`。
2. 在 C 端个人资料页确认显示 `∞ 无限算力`，且不显示普通充值入口。
3. 继续发起内容生成，确认请求仍可正常通过。
4. 检查生成完成后该账号不会被扣减余额，也不会新增普通消费流水。
