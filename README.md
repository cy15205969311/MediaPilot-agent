# MediaPilot Agent 开发说明

更新时间：`2026-05-03`

`MediaPilot-agent` 是仓库名称，运行时和部分代码标识中仍保留 `OmniMedia Agent` 命名。两者指向同一套系统：一个面向内容运营团队的 AI 内容工作台与后台管理一体化工程。

## 1. 项目概述

当前仓库由一套共享后端、两套前端应用和一个扩展预留目录组成：

- `app/`：`FastAPI` 后端，负责认证鉴权、会话历史、SSE 流式生成、素材解析、知识库、上传存储、管理端接口与 Token 流水。
- `frontend/`：C 端主工作台，面向内容创作者与运营同学，提供生成、草稿、知识库、历史会话和个人安全设置等功能。
- `omnimedia-admin-web/`：B 端管理后台，面向管理员提供用户管理、账号冻结、Token 调度、后台概览等能力。
- `extension/`：浏览器扩展或站外辅助能力接入的预留目录。

系统本地开发默认使用：

- `SQLite` 作为数据库
- `uploads/` 作为本地文件存储目录
- 可选接入阿里云 `OSS`
- `LangGraph` 作为多模态工作流编排层
- `OpenAI / DashScope / OpenAI-Compatible` 作为模型网关

## 2. 当前工程基线

以下内容已经落在当前代码中，开发与联调时请以此为准。

### 2.1 账号冻结与全局阻断

- 后端登录接口与鉴权依赖会在用户状态为 `frozen` 时返回 `403 ACCOUNT_FROZEN`。
- 管理员冻结账号时，会同步撤销刷新会话，并对相关访问令牌执行拉黑。
- C 端前端全局拦截器会在收到 `ACCOUNT_FROZEN` 后自动：
  - 清理本地登录态
  - 中断正在进行的流式生成
  - 回跳登录页
  - 弹出冻结提示

### 2.2 管理端 Token 资产调度

- 管理员调整 Token 已升级为三种明确动作：
  - `add`：增加额度
  - `deduct`：扣减额度
  - `set`：直接设定余额
- 请求体要求携带 `action + amount + remark`。
- 管理后台用户详情侧的 Token 调整交互已升级为“Token 资产调度台”，包含：
  - 操作类型切换
  - 快捷额度包
  - 结果预览
  - 审计备注

### 2.3 多模型真实计费

- `LangGraph` 状态字典中新增 `token_usage`，用于在不同节点之间累计 `{model_name: token_count}`。
- 视觉解析节点、主生成节点、结构化产物节点会分别记录自己的模型消耗。
- 最终结算逻辑不再按输出文本长度估算，而是按真实模型消耗逐条写入 `TokenTransaction`。
- 用户余额扣减总数等于所有模型消耗之和。

### 2.4 Provider 用量透传修复

为修复 `token_ledger skipped ... reason=no_tracked_usage`，当前 Provider 层已经补齐以下约束：

- 流式兼容接口统一优先尝试 `stream_options={"include_usage": True}`。
- `OpenAIProvider`、`CompatibleLLMProvider`、`QwenLLMProvider` 都会在 `done` 事件中回传累计 `token_usage`。
- `CompatibleLLMProvider` 已修复“内部累计了 usage，但 `done` 事件漏传”的问题。
- 当上游拒绝 `include_usage` 或最终仍然拿不到 usage 时，会输出显式 warning 日志，避免静默失败。

### 2.5 SQLite 短事务隔离

- 为避免在 SSE 生成期间长期持有数据库写锁，最终计费改为独立短生命周期会话。
- 计费阶段使用单独的 `SessionLocal` 完成：
  - 用户余额扣减
  - 多条 Token 流水写入
  - `commit / rollback / close`
- 这样可以降低 SQLite 读写互斥对历史会话列表等只读接口的影响。

### 2.6 计费排障日志

当前代码已补齐关键日志，便于定位 usage 是“没提取到”还是“传丢了”：

- Provider 层缺失 usage 时会输出 warning
- `agent.py` 在最终记账前会打印本次 `token_usage`
- 若仍然跳过记账，会把实际 `token_usage` 一并写入日志

### 2.7 管理端用户中心治理升级

- 管理端用户列表接口现在会返回 `avatar_url`，便于后台直接渲染真实头像。
- `omnimedia-admin-web` 已新增统一的 `UserAvatar` 组件：
  - 优先加载后端返回的头像地址
  - 图片缺失或加载失败时自动回退为珊瑚橙底色的首字母头像
- 管理端用户搜索框已支持防抖与“清空即回表”：
  - 输入过程中会自动同步筛选词
  - 当关键词被清空时，会自动恢复全量用户列表，无需手动点击刷新
- 用户列表与详情抽屉已落地企业级 RBAC 约束：
  - 目标账号为 `super_admin` 时，后端禁止冻结、重置密码和调整 Token
  - 前端会把该类账号标记为受保护账号，仅保留“查看详情”
- 管理团队账号在后台按“无限额度”展示：
  - `super_admin`
  - `admin`
- 原先表格行内的悬浮操作菜单已移除，危险操作统一收敛到右侧详情抽屉，彻底规避 `overflow` 导致的菜单裁剪问题。

### 2.8 商业化与资产风控基线

- 新用户注册时，后端会在同一事务中完成两件事：
  - 创建用户并写入初始 `token_balance = 10_000_000`
  - 追加一条 `TokenTransaction(transaction_type="grant")`
- 当前注册赠送流水的默认备注为：`新用户注册千万算力福利`。
- C 端内容生成接口已启用“事前拦截”：
  - 普通用户在 `token_balance <= 0` 时会直接收到 `402 INSUFFICIENT_TOKENS`
  - 不会再进入 LangGraph 工作流或触发实际模型调用
- C 端个人资料弹窗已新增“我的资产”区块：
  - 普通用户显示格式化后的余额，如 `10,000,000 Tokens`
  - 同时保留“获取算力 / 去充值”占位入口，当前会提示支付系统正在接入中
- 当普通用户算力耗尽时，前端会：
  - 停止当前 Loading / 流式生成状态
  - 弹出余额不足提示
  - 引导用户前往个人中心查看资产

### 2.9 管理团队“无限黑卡”豁免

- `super_admin` 与 `admin` 被视为管理团队特权账号。
- 这类账号在 C 端和后端都享受统一的资产豁免策略：
  - 跳过内容生成前的余额检查
  - 跳过最终 Token 扣减与消费流水写入
  - 在个人资料页显示 `∞ 无限算力`
- 管理团队账号不会显示普通用户的“去充值”按钮，而是显示特权标识与尊贵说明。

## 3. 仓库结构

```text
MediaPilot-agent/
├─ app/                        # FastAPI backend
│  ├─ api/v1/                  # 路由模块
│  ├─ db/                      # SQLAlchemy 引擎、Session、ORM 模型
│  ├─ models/                  # Pydantic 请求/响应模型
│  ├─ services/                # 鉴权、Graph、Provider、存储、解析与业务逻辑
│  ├─ config.py                # 环境变量加载与运行时配置
│  └─ main.py                  # 应用入口
├─ alembic/                    # 数据库迁移
├─ frontend/                   # C 端主工作台
│  ├─ e2e/                     # Playwright 测试
│  └─ src/
├─ omnimedia-admin-web/        # B 端管理后台
│  └─ src/
├─ extension/                  # 扩展预留目录
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

### 5.5 安装 Playwright 浏览器

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
- `POST /api/v1/admin/users/{user_id}/reset-password`
- `POST /api/v1/admin/users/{user_id}/tokens`
- `GET /api/v1/admin/dashboard`

## 8. 开发约束

### 8.1 分层原则

- `app/api/` 负责请求校验、依赖注入、响应码与错误返回
- `app/services/` 负责业务逻辑、模型调用、Graph 编排、存储与持久化辅助
- `app/db/` 负责 ORM 模型、Session 和数据库配置
- `app/models/` 负责请求/响应契约

### 8.2 SQLite 使用建议

- 不要在长时间流式输出期间持有未提交写事务
- 写密集逻辑应尽量使用短事务
- 遇到异常必须显式 `rollback`
- 框架托管 Session 与业务自建短会话要分清职责

### 8.3 Provider 计费约束

- 流式模型接入时优先开启 `include_usage`
- Provider 的最终 `done` 事件必须显式携带 `token_usage`
- LangGraph 节点修改状态时必须通过 `return` 返回更新值，不能仅做原地修改
- 新增模型接入时要同步验证：
  - 流式 usage 是否可用
  - 结构化产物调用是否可取到 usage
  - 最终 `token_ledger` 是否能落库

### 8.4 提交规范

推荐使用 Conventional Commits：

- `feat:` 新功能
- `fix:` 缺陷修复
- `refactor:` 重构但不改行为
- `docs:` 文档更新
- `test:` 测试补充
- `chore:` 工程维护

示例：

```text
feat: strengthen provider usage propagation for multimodal billing
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

### 9.4 Usage 排障观察点

若再次出现 `no_tracked_usage`，优先检查日志中是否存在：

- `include_usage rejected`
- `Provider usage missing after ...`
- `agent.stream final token_usage ...`

### 9.5 后台用户中心验收点

1. 在用户列表中确认真实头像可显示，失效地址会自动回退为首字母头像。
2. 验证搜索框在输入后会自动筛选，清空关键词后会自动恢复全量列表。
3. 检查 `super_admin` 行：
   - Token 列显示 `∞ 无限制`
   - 行内不再出现危险操作入口
   - 详情抽屉只展示保护说明，不允许冻结、重置密码或调额
4. 检查普通用户行：
   - “查看详情”按钮可正常打开右侧抽屉
   - 抽屉内可执行冻结、重置密码和 Token 调整
5. 水平滚动表格时，确认操作区不再出现下拉菜单被裁剪的问题。

### 9.6 注册与算力风控验收点

1. 新注册一个普通用户，确认其初始余额为 `10,000,000`。
2. 检查数据库中是否同步写入一条 `grant` 类型的 Token 流水。
3. 将普通用户余额调整为 `0` 后再次发起内容生成，确认接口直接返回 `402 INSUFFICIENT_TOKENS`。
4. 确认前端会弹出“余额不足”的商业化提示，而不是空白失败。

### 9.7 管理团队无限黑卡验收点

1. 将测试账号角色设为 `admin` 或 `super_admin` 且余额设为 `0`。
2. 在 C 端个人资料页确认显示 `∞ 无限算力`，不显示充值按钮。
3. 继续发起内容生成，确认请求可正常通过，不会触发余额不足拦截。
4. 检查生成完成后该管理账号余额不会被扣减，也不会新增消费流水。

---

如需英文工程基线，请查看 [DEVELOPMENT.md](./DEVELOPMENT.md)。
