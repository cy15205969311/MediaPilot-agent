# MediaPilot Agent 中文开发说明

更新时间：`2026-05-04`

`MediaPilot-agent` 是当前仓库名。运行时标题、接口描述或部分历史代码中仍可能出现 `OmniMedia Agent` 命名；两者指向同一套系统：一个面向内容团队的 AI 创作工作台与后台管理中台一体化工程。

英文工程基线请查看 [DEVELOPMENT.md](./DEVELOPMENT.md)。

## 1. 文档目标

本文档用于统一说明当前仓库的中文开发基线，适用于以下场景：

- 新成员快速理解仓库结构与运行方式
- 后端 `app/` 模块开发与联调
- C 端工作台 `frontend/` 开发
- B 端管理后台 `omnimedia-admin-web/` 开发
- 鉴权、流式生成、知识库、上传、计费、RBAC 与后台治理能力排障
- 提交、验收、交接与发布前自检

## 2. 项目概览

当前仓库由一套共享后端、两个前端应用和一个预留扩展目录组成：

- `app/`
  `FastAPI` 后端，负责认证鉴权、历史会话、流式生成、素材解析、知识库、文件上传、管理员接口、仪表盘与 Token 流水。
- `frontend/`
  C 端创作工作台，面向创作者与运营同学，提供生成、改写、素材上传、资产查看、知识检索、历史会话、个人资料与安全设置等能力。
- `omnimedia-admin-web/`
  B 端管理后台，面向 `super_admin`、`admin`、`operator`、`finance` 等管理角色，提供用户治理、角色权限、资产调度、真实活跃设备、后台路由权限隔离与运营工作区。
- `extension/`
  浏览器扩展或站外集成预留目录。

默认本地基础设施：

- `SQLite` 作为默认数据库
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
'- DEVELOPMENT.md              # 英文开发说明
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
- `SQLite`
- `ChromaDB`
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
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`
- `DEEPSEEK_ARTIFACT_MODEL`
- `DEEPSEEK_TIMEOUT_SECONDS`
- `PROXY_GPT_API_KEY`
- `PROXY_GPT_BASE_URL`
- `PROXY_GPT_MODEL`
- `PROXY_GPT_ARTIFACT_MODEL`
- `PROXY_GPT_TIMEOUT_SECONDS`
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

当前 OpenAI 兼容生图链路为了适配第三方中转站，默认使用经典 `Images API`，也就是 SDK 的 `client.images.generate(...)` / 网关侧的 `/v1/images/generations`。请求固定要求 `response_format="b64_json"`，不要在未确认上游网关支持的情况下直接切到 `Responses API` 的 `/v1/responses` 生图路径。

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

以下内容反映当前代码仓库已经落地的真实行为，开发、联调与排障请以此为准。

### 7.1 账号冻结与全局阻断

- 登录与鉴权依赖会在用户状态为 `frozen` 时返回 `403 ACCOUNT_FROZEN`
- 管理端冻结用户时，会同步撤销该用户的 `RefreshSession`，并使相关访问令牌失效
- C 端全局拦截器会在收到 `ACCOUNT_FROZEN` 后自动：
  - 清理本地登录状态
  - 中断当前 SSE 流式连接
  - 跳转回登录页
  - 弹出冻结提示

### 7.2 Token 商业化基础链路

- 初始 Token 赠送额度不再硬编码在注册或后台建号逻辑里
- `SystemSetting(key="new_user_bonus")` 是当前唯一的初始赠送配置源
- `POST /api/v1/auth/register` 与 `POST /api/v1/admin/users` 会在运行时动态读取 `new_user_bonus`
- 当配置缺失、未播种或值异常时，赠送额度会安全兜底为 `0`
- 只要赠送额度大于 `0`，系统仍会在同一事务里同步完成：
  - 创建或更新 `User.token_balance`
  - 写入一条匹配的 `TokenTransaction(transaction_type="grant")`
- 普通用户在 `token_balance <= 0` 时，请求 `POST /api/v1/media/chat/stream` 会收到 `402 INSUFFICIENT_TOKENS`
- `super_admin` 与 `admin` 为资产豁免角色：
  - 跳过事前余额拦截
  - 跳过最终普通消费流水扣减
  - C 端资产区展示为无限额度

### 7.3 多模型真实计费

- `LangGraph` 状态中维护 `token_usage` 字典，结构为 `{model_name: token_count}`
- 素材解析节点、正文生成节点、结构化产物节点会分别累加自身模型消耗
- 最终记账不再按字符估算，而是按真实模型维度写入多条 `TokenTransaction`
- 一次多模态任务可生成多条模型流水，每条流水对应一个模型

### 7.4 Provider 用量透传修复

- 流式请求优先尝试 `stream_options={"include_usage": True}`
- `OpenAIProvider`、`CompatibleLLMProvider`、`QwenLLMProvider` 会在最终 `done` 事件里回传累计 `token_usage`
- 若上游拒绝 `include_usage` 或最终仍拿不到 usage，会输出显式 warning，不允许静默失败
- `agent.py` 会在最终记账前打印本次 `token_usage`，便于快速定位是提取失败还是状态丢失

### 7.5 SQLite 短事务隔离

- 流式输出期间不允许长期持有数据库写事务
- 最终记账使用独立、短生命周期的 `SessionLocal()`
- 记账逻辑必须显式执行 `commit / rollback / close`
- 这样可以降低线程历史、仪表盘、后台列表等只读接口被写锁阻塞的风险

### 7.6 智能预算熔断与零值兜底

- `MediaChatRequest` 已具备内部预算字段 `max_generation_tokens`
- `app/services/agent.py` 会在进入真实 Provider 前，根据普通用户当前余额注入运行时预算
- `app/services/providers.py` 会将该预算下传为兼容模型调用的 `max_tokens`
- 最终余额更新遵循 `zero-floor` 规则，数据库余额不会再落到负数
- 多模型任务下，实际可扣额度会按各模型占比分摊回多条真实流水

### 7.7 管理端用户中心治理升级

- 用户列表接口会返回真实 `avatar_url`
- 后台统一使用 `UserAvatar` 渲染头像，图片缺失时退回首字母头像
- 搜索框支持防抖和“清空即回表”
- 表格当前固定为每页 `5` 条数据，保持与最新管理端设计基线一致
- 角色标签已改为更轻量的彩色文字样式，用户列展示“主名称 + 短 ID”的信息层级
- `super_admin` 在前后端均受保护：
  - 后端拒绝冻结、重置密码、调整 Token
  - 前端仅允许查看详情，不暴露危险操作
- `super_admin` 与 `admin` 在后台按“无限额度”展示
- 行内操作已收纳为三点下拉菜单，避免再次回到平铺按钮造成的视觉拥挤
- `POST /api/v1/admin/users/{user_id}/reset-password` 对可治理账号固定重置为 `12345678`
- `DELETE /api/v1/admin/users/{user_id}` 已支持单体删除，并阻止自删与删除 `super_admin`
- 删除成功会同步撤销 RefreshSession、拉黑相关最新 access token jti，并写入 `delete_user` 审计日志

### 7.8 管理端真实设备活跃链路

- `GET /api/v1/admin/users` 会为当前页每个用户附带 `latest_session`
- `latest_session` 当前包含：
  - `device_info`
  - `ip_address`
  - `last_seen_at`
  - `created_at`
- 后台用户列表与详情抽屉都会渲染真实设备信息和相对活跃时间

### 7.9 企业级 RBAC 角色链路

当前后台 RBAC 已形成“定义、分配、访问隔离”的完整闭环：

- 真实角色值当前包括：
  - `super_admin`
  - `admin`
  - `finance`
  - `operator`
  - `premium`
  - `user`
- 角色权限页已落地为真实页面：
  - 路由：`/roles`
  - 组件：`omnimedia-admin-web/src/pages/AdminRolesPage.tsx`
  - 交互：卡片展示、右侧抽屉、权限分组、多选配置、系统角色锁定
- 用户中心已支持角色分配：
  - 接口：`PATCH /api/v1/admin/users/{user_id}/role`
  - 仅 `super_admin` 可调用
  - 不允许修改自己的角色
  - 不允许修改其他 `super_admin` 的角色
- 角色页成员数量已改为真实聚合：
  - 接口：`GET /api/v1/admin/roles/summary`
  - 由后端对 `User.role` 进行 `GROUP BY`
  - 前端不再依赖 mock 人数

### 7.10 动态后台工作区与路由兜底

当前管理后台已支持基于角色的动态菜单过滤与安全路由重定向：

- `omnimedia-admin-web/src/adminMeta.ts` 统一维护后台菜单配置、角色白名单与默认落点
- `AdminLayout` 仅渲染当前角色可访问的菜单项
- `AuthGuard` 会在用户通过 URL 强行访问无权限页面时：
  - 拦截当前路由
  - 自动重定向到该角色的默认安全工作区
  - 通过路由状态触发 Toast 提示
- 当前默认工作区策略：
  - `super_admin` / `admin` -> `/dashboard`
  - `operator` -> `/users`
  - `finance` -> `/tokens`
- `/tokens` 已升级为真实流水工作台，面向 `super_admin` 与 `finance` 提供财务侧查询入口。
- 对应后端接口为 `GET /api/v1/admin/transactions` 与 `GET /api/v1/admin/transactions/stats`。
- 当前流水页支持按用户名或昵称模糊筛选、防抖查询、上一页 / 下一页分页，以及顶部四张真实 KPI 卡片。

### 7.11 管理端角色与页面访问矩阵

当前后台访问策略如下：

| 页面/能力 | super_admin | admin | operator | finance |
| --- | --- | --- | --- | --- |
| 数据总览 `/dashboard` | 是 | 是 | 否 | 否 |
| 用户中心 `/users` | 是 | 是 | 是 | 否 |
| 角色权限 `/roles` | 是 | 否 | 否 | 否 |
| Token 流水 `/tokens` | 是 | 否 | 否 | 是 |
| 审计日志 `/audit` | 是 | 是 | 否 | 否 |
| 模板库 `/templates` | 是 | 是 | 是 | 否 |
| 存储治理 `/storage` | 是 | 是 | 否 | 否 |
| 系统设置 `/settings` | 是 | 否 | 否 | 否 |
| 查看用户列表接口 `GET /api/v1/admin/users` | 是 | 是 | 是 | 是 |
| 修改用户状态 / 密码 / Token | 是 | 是 | 是 | 否 |
| 修改用户角色 | 是 | 否 | 否 | 否 |
| 读取角色成员汇总 | 是 | 否 | 否 | 否 |

说明：

- `finance` 当前是后台只读财务角色，可进入后台并查看与财务相关的页面，但不参与用户治理动作
- `admin` 当前保留为兼容型高权限角色，参与后台治理与资产豁免，但不开放系统级角色管理
- `Token 流水` 当前仅开放给 `super_admin` 与 `finance`；`admin` 保留治理权限，但不进入财务台账工作区
- 角色权限页当前主要展示系统管理最相关的内建角色卡：超级管理员、运营人员、财务人员；`admin` 仍是有效角色值，并在用户中心可分配

### 7.12 C 端素材上传体验升级

- 点击上传、剪贴板粘贴、拖拽上传都会进入同一条素材队列
- `Composer.tsx` 负责采集原始 `File[]`
- `frontend/src/app/App.tsx` 负责统一队列与上传状态管理
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
- 仍为整文件直传，暂未接入分片与字节级进度条

### 7.13 C 端结果面板资产包与上下文接力

- 右侧结果面板已从“只显示最后一条产物”升级为“会话级资产包”
- 会从当前 Thread 的 `messages` 中提取结构化 `artifact`
- 会按任务类型建立本地索引与 Tab
- 切换顶部任务选择器时，不会把已生成资产直接清空

当前本地资产类别：

- `content_generation`
- `comment_reply`
- `topic_planning`
- `hot_post_analysis`

### 7.14 计费诊断日志

当前诊断信息包括：

- Provider usage 缺失 warning
- `agent.py` 在持久化前打印最终 `token_usage`
- 记账跳过日志会带上原始 `token_usage`
- 记账成功日志会打印 `requested_total` 与 `billed_total`

### 7.15 模板资产治理闭环

Admin 模板库已从“只支持新建”升级为完整的共享模板治理工作台：

- `omnimedia-admin-web/src/pages/AdminTemplatesPage.tsx` 支持新建、编辑、预览、单体删除、多选与批量删除，且模板列表固定为每页 `10` 条
- `app/api/v1/admin_templates.py` 提供后台共享模板的增删改查与批量清理能力，并已放开管理员对官方预置模板的编辑与删除权限
- 新建与编辑共用同一个居中 Modal，而不是旧版侧边 Drawer
- Modal 内新增“设为官方预置模板”开关，提交时会与 `title`、`platform`、`description`、`prompt_content` 一起组成后端支持的核心请求体
- 模板卡片已升级为长卡片形态，包含平台/归属标签、`PROMPT SNAPSHOT` 预览区与三列统计网格
- 单体删除与批量删除都带二次确认，降低误删对 C 端模板可用性的影响；若删除的是系统补种的官方预置模板，会通过 tombstone 隐藏而不是直接硬删除，从而避免刷新后被自动补回
- `app/services/template_library.py` 的预置模板补种逻辑已调整为“只补缺失，不强制覆盖”，因此管理员对官方模板的编辑不会在下次读取时被自动回滚
- 批量选择后会显示带动画的操作栏，并通过更高层级覆盖卡片区域
- Modal 中当前只保留“行业分类”作为 UI 辅助字段；“关联知识库”入口已从后台模板弹窗移除，避免与现有 FastAPI 契约产生偏差

C 端本地模板中心也同步补齐了生命周期能力：

- `PATCH /api/v1/media/templates/{template_id}` 支持编辑用户自有模板
- `DELETE /api/v1/media/templates` 支持使用 SQLAlchemy `delete(...)` 执行批量删除
- 系统预置模板在 C 端继续保持只读，不支持编辑或删除；管理端则通过后台专用路由放开维护权限，形成“管理端集权、使用端隔离”的双轨治理模型

### 7.16 新建用户居中 Modal

`omnimedia-admin-web/src/pages/AdminUsersPage.tsx` 中的“新建用户”入口已经重构为更轻量的居中弹窗：

- 提交到 `POST /api/v1/admin/users` 的请求体仅包含 `username`、`password`、`role`
- 初始密码区域支持随机生成与一键复制
- 角色分配使用卡片式单选，直接展示角色职责说明
- Modal 使用最大高度限制与内部滚动，避免“顶天立地”的全屏观感
- 底部提示横幅明确说明了初始 Token / 无限额度与审计流水的自动发放逻辑

### 7.17 管理端删除用户与审计联动

- 用户中心三点菜单已接入真实删除能力，不再保留可见的占位编辑入口
- 删除前会弹出阻断式确认弹窗，明确提示登录、会话与用户资产清理影响
- 删除成功后会自动刷新当前页数据；如果当前页最后一条被删除，会同步回退分页游标
- 审计日志页已识别 `delete_user` 事件，并补齐独立标签、图标与摘要文案
- 审计日志页当前固定为每页 `5` 条，方便后台核对删除、重置密码与角色治理动作
- 重置密码动作仍保留在同一菜单中，便于运营在删除前先执行找回或交接

### 7.18 SystemSetting 配置中心与安全基线

- 后台系统设置已从纯前端占位页升级为真实的 KV 配置中心
- `app/db/models.py` 中新增 `SystemSetting` 模型，包含 `key`、`value`、`category`、`description`
- `app/services/system_settings.py` 负责配置项目录、默认值播种、类型校验、分组响应与更新逻辑
- `GET /api/v1/admin/settings` 会按 `basic / token / security / notification` 分组返回真实配置
- `PUT /api/v1/admin/settings` 会写入数据库，并生成 `update_system_settings` 审计日志
- 审计日志中的系统设置变更会携带 `changed_keys` 与结构化 `changes`，便于前端渲染 Diff
- `new_user_bonus`、`session_timeout_minutes`、`ip_whitelist_enabled`、`ip_whitelist_ips` 等可运维基线都统一归口到该配置中心
- 安全相关配置会通过 `app/core/security.py` 做进程内缓存，避免每次后台请求都直查数据库

### 7.19 审计日志详情抽屉

- 审计日志列表的每一行都提供“查看详情”入口
- 右侧详情抽屉会展示完整审计载荷
- 对于 `update_system_settings` 事件，抽屉会按 `details.changes` 渲染红删绿增的差异视图
- 对于其他事件，抽屉会用格式化 JSON 展示原始审计详情，方便排查后台治理动作

### 7.20 系统通知中心与待办预警

- `app/db/models.py` 中新增 `SystemNotification` 模型，负责承接后台消息流
- `GET /api/v1/admin/notifications` 返回最新通知与未读数量，`PUT /api/v1/admin/notifications/read_all` 支持一键已读
- 系统设置保存、系统设置回滚等高风险后台动作会同步写入通知中心
- `GET /api/v1/admin/dashboard/pending-tasks` 会聚合真实业务状态，目前至少包含：
  - `abnormal_users`
  - `storage_warnings`
- `AdminLayout` 已接入右上角铃铛与左下角待办卡片：
  - 铃铛展示最新 `5` 条通知与未读徽标
  - 待办卡片按角色权限跳转到 `/users?status=frozen` 或 `/storage`

### 7.21 存储治理真实化

- 存储治理页已不再使用假数据，改为读取 `UploadRecord` 聚合结果
- `GET /api/v1/admin/storage/stats` 会返回：
  - `total_bytes`
  - `capacity_bytes`
  - `distribution.image / video / audio / document / other`
- `GET /api/v1/admin/storage/users` 会按用户聚合：
  - 文件总大小
  - 文件数量
  - 最近上传时间
- 前端会统一用字节格式化函数显示 `KB / MB / GB / TB`
- 当前排行榜接口默认 `limit=10`

### 7.22 系统设置回滚链路

- `POST /api/v1/admin/settings/rollback/{audit_log_id}` 已支持从系统设置审计快照执行一键回滚
- 回滚逻辑会：
  - 校验审计记录类型
  - 提取旧值
  - 更新 `SystemSetting`
  - 写入新的 `rollback_system_settings` 审计日志
  - 同步写入系统通知
- 前端审计详情抽屉已接入“危险区”回滚按钮，并带二次确认弹窗
- 回滚与审计写入在同一事务内完成，避免只回滚配置、不写审计的状态撕裂

### 7.23 后台搜索入口收敛

- 后台顶部 Header 全局搜索框已移除，避免跨模块状态同步继续膨胀
- 审计日志页已恢复为“仅使用高级筛选抽屉”的单入口模型，不再叠加第二个文本搜索框
- `omnimedia-admin-web/src/components/common/StandardSearchInput.tsx` 作为后台标准局部搜索组件，当前用于：
  - 用户中心
  - Token 流水
  - 模板库
- 该组件负责：
  - 本地输入缓冲
  - 防抖写回 URL
  - 外部 URL 反向同步
  - 一键清空并回表
- 模板库搜索框已收敛为固定宽度工具栏控件，不再挤压 Tab 区

### 7.24 C 端模板中心分页与卡片稳定性

- C 端模板中心当前按 `page_size=9` 进行 3x3 分页展示
- 翻页时不再清空旧卡片，而是保留原有 DOM，并叠加局部毛玻璃加载态
- 模板网格使用 `content-start`，最后一页不足 `9` 条时不会再把卡片纵向拉伸
- 卡片外层已统一为 `h-full + flex-col`，同一行保持整齐对齐
- `getTemplateSourceLabel` 当前只负责把模板来源映射为可读中文：
  - `本地预置`
  - `团队共享`
  - `我的模板`

### 7.25 OpenAI 兼容生图网关基线

- `app/services/image_generation.py` 当前对 OpenAI 兼容生图统一走 SDK `AsyncOpenAI.images.generate(...)`
- 为了兼容尚未适配 `/v1/responses` 的第三方中转站，请求固定为 `response_format="b64_json"`、`n=1`、`size="1024x1024"`
- 后端日志必须先经过 `sanitize_image_response_for_log()` 一类的脱敏处理，严禁直接打印原始 `b64_json`
- Base64 仅允许在服务端内存中短暂存在，随后立即解码并持久化到本地 `uploads/` 或对象存储，再向前端返回可访问 URL
- `app/main.py` 挂载的 `/uploads` 静态目录属于本地落盘链路的一部分，排障时不要误删
- 若 OpenAI 兼容链路失败，现有 DashScope 兜底逻辑仍然保留，用于保障可用性

## 8. 后端边界与分层规则

### 8.1 路由分组

当前 `app/api/v1/` 主要路由包括：

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
- `admin_storage.py`
- `admin_settings.py`
- `admin_notifications.py`
- `admin_search.py`
- `admin_tokens.py`
- `admin_templates.py`
- `admin_audit_logs.py`

### 8.2 分层原则

- `app/api/` 负责请求校验、依赖注入、HTTP 状态码与响应模型
- `app/services/` 负责工作流、Provider、解析、存储与业务逻辑
- `app/db/` 负责引擎、Session、ORM 模型与迁移兼容
- `app/models/` 负责 Pydantic Schema 与 API 契约

避免把复杂数据库逻辑和跨模块业务逻辑长期堆积在路由层。

### 8.3 配置中心分层约束

- 需要运营可调的商业化、安全或通知类基线，不应继续写死在路由处理函数中
- 这类动态基线应优先落到 `SystemSetting`
- 普通业务流程通过 `app/services/system_settings.py` 读取强类型配置
- 中间件、Token 过期时间、IP 白名单等高频安全链路通过 `app/core/security.py` 读取缓存快照

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
- `PATCH /api/v1/media/templates/{template_id}`
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

### 9.4 管理端

- `GET /api/v1/admin/users`
- `POST /api/v1/admin/users`
- `DELETE /api/v1/admin/users/{user_id}`
- `POST /api/v1/admin/users/{user_id}/status`
- `POST /api/v1/admin/users/{user_id}/reset-password`
- `POST /api/v1/admin/users/{user_id}/tokens`
- `PATCH /api/v1/admin/users/{user_id}/role`
- `GET /api/v1/admin/templates`
- `POST /api/v1/admin/templates`
- `PATCH /api/v1/admin/templates/{template_id}`
- `DELETE /api/v1/admin/templates/{template_id}`
- `DELETE /api/v1/admin/templates`
- `GET /api/v1/admin/roles/summary`
- `GET /api/v1/admin/dashboard`
- `GET /api/v1/admin/storage/stats`
- `GET /api/v1/admin/storage/users`
- `GET /api/v1/admin/transactions`
- `GET /api/v1/admin/transactions/stats`
- `GET /api/v1/admin/notifications`
- `PUT /api/v1/admin/notifications/read_all`
- `GET /api/v1/admin/dashboard/pending-tasks`
- `GET /api/v1/admin/global-search`
- `GET /api/v1/admin/settings`
- `PUT /api/v1/admin/settings`
- `POST /api/v1/admin/settings/rollback/{audit_log_id}`
- `GET /api/v1/admin/audit-logs`
- `GET /api/v1/admin/audit-logs/export`

## 10. 验证清单

提交前至少验证你实际改动覆盖到的部分。

### 10.1 通用验证

- 后端语法检查：`python -m compileall app`
- 若改动 `frontend/`：执行对应构建或针对性验证
- 若改动 `omnimedia-admin-web/`：执行 `npm run build`
- 若改动 Schema：检查前后端契约兼容性
- 若改动数据库写路径：重点检查 `SQLite` 事务释放与只读接口响应
- 若改动 ORM 或 Alembic 迁移：发布前必须执行 `alembic upgrade head`
- 若改动 OpenAI 兼容生图链路：至少执行 `python -m pytest tests/test_image_generation.py`
- 历史迁移修补必须保持幂等，不要假设旧表、旧列或旧索引一定存在
- 推荐迁移冒烟命令：

```powershell
$env:DATABASE_URL = "sqlite:///./tmp_migration_smoke.db"
alembic upgrade head
Remove-Item .\tmp_migration_smoke.db
```

- 若改动认证、系统设置或后台安全中间件，推荐优先执行：

```powershell
python -m pytest tests/test_chat.py -k "auth_register_and_login or admin_settings_update_bonus_affects_register_and_admin_provisioning or admin_settings_security_controls_apply_dynamic_expiry_and_ip_whitelist"
```

### 10.2 后台治理与 RBAC 验证

1. 使用 `super_admin` 登录后台，确认能看到完整菜单。
2. 使用 `operator` 登录后台，确认默认进入 `/users`，且看不到 `/dashboard`、`/roles`、`/settings` 等菜单。
3. 使用 `finance` 登录后台，确认默认进入 `/tokens`，且不显示用户治理类菜单。
4. 手动输入无权限路径，例如让 `operator` 访问 `/dashboard`，确认自动跳转回安全工作区并弹出提示。
5. 在用户中心为普通用户切换角色，确认：
   - `PATCH /api/v1/admin/users/{user_id}/role` 成功
   - 列表角色标签即时更新
   - 超级管理员不能修改自己或其他 `super_admin`
6. 打开角色权限页，确认成员数量来自真实聚合而非写死 mock。
7. 确认 `super_admin` 行仍然受保护，不能冻结、重置密码、删除或调整 Token。
8. 打开用户列表三点菜单，确认：
   - 当前分页固定为每页 `5` 条
   - 菜单内包含查看详情、重置密码、修改角色、Token、冻结/解冻与删除动作
   - 不再展示可见的占位“编辑用户”入口
9. 对一个可治理账号执行重置密码，确认：
   - `POST /api/v1/admin/users/{user_id}/reset-password` 成功
   - 返回的新密码固定为 `12345678`
   - 相关活跃会话会被同步撤销
10. 删除一个普通账号，确认：
   - `DELETE /api/v1/admin/users/{user_id}` 成功
   - 当前列表行被移除，必要时分页游标自动回退
   - 审计日志页能看到 `delete_user` 事件
11. 使用 `finance` 或 `super_admin` 打开 `/tokens`，确认顶部 KPI 卡片来自真实接口，用户名筛选支持防抖，分页翻页后记录与总数同步更新。
12. 打开“新建用户” Modal，确认：
   - 弹窗为居中模式，并使用内部滚动而不是全高侧边抽屉
   - 表单只包含 `username`、`password`、`role`
   - 发往 `POST /api/v1/admin/users` 的请求体也只包含这三个字段
13. 打开 Admin 模板库，确认：
   - 编辑共享模板会调用 `PATCH /api/v1/admin/templates/{template_id}`
   - 官方预置模板与自定义模板都能看到编辑、删除与批量选择入口
   - 新建与编辑都使用居中模板 Modal，而不是侧边 Drawer
   - Modal 内可切换“设为官方预置模板”，且“关联知识库”入口已被移除
   - “行业分类”等 UI 辅助字段不会被带入后端请求体
   - 单体删除需要二次确认，且成功后会从列表移除
   - 批量删除后选中状态会清空，列表会自动刷新
   - 删除系统补种的官方预置模板后再次刷新列表，该模板不会被自动补回
14. 打开审计日志页，确认：
   - 默认分页固定为每页 `5` 条
   - 翻页、筛选和详情查看不会导致总数或分页状态错乱
   - `update_system_settings` 日志能在右侧抽屉里看到红删绿增的 Diff
   - 其他日志类型会在同一抽屉中展示格式化 JSON
15. 打开系统设置并修改任意一项配置，确认：
   - 保存后铃铛消息中心会新增一条通知
   - 审计日志会出现 `update_system_settings`
   - 在详情抽屉里可以看到 Diff
16. 对同一条系统设置审计执行“一键回滚”，确认：
   - 配置值恢复
   - 生成 `rollback_system_settings` 审计记录
   - 铃铛消息中心出现回滚通知
17. 打开存储治理页，确认：
   - 总量、分布、排行榜来自真实聚合接口
   - 文件大小以 `KB / MB / GB / TB` 形式展示，而不是原始字节数
18. 分别打开用户中心、Token 流水和模板库，确认：
   - 本地搜索框支持清空与 URL 同步
   - 模板库搜索框保持固定宽度，不会挤压左侧 Tab 栏

### 10.3 计费与多模态验证

1. 冻结普通用户并确认其被强制登出。
2. 使用 `add / deduct / set` 三种方式调度 Token，确认余额与流水一致。
3. 跑一次音频、图片或视频参与的多模态任务，确认存在按模型拆分的 `TokenTransaction`。
4. 普通用户余额为 `0` 时，请求 `POST /api/v1/media/chat/stream`，确认收到 `402 INSUFFICIENT_TOKENS`。
5. 普通用户余额较小但发起长内容任务时，确认最终余额不会低于 `0`。

## 11. 提交规范

当前仓库使用 Conventional Commits：

- `feat:` 新功能或能力增强
- `fix:` Bug 修复
- `refactor:` 不改变外部行为的结构调整
- `docs:` 仅文档变更
- `test:` 测试补充或调整
- `chore:` 维护性任务

示例：

```text
feat: 打通系统设置回滚链路与后台治理工作台
```

如果一次提交同时包含功能代码和文档更新，请优先根据“主要变更内容”选择类型；像本次这类代码与文档同步演进的更新，使用 `feat:` 最合适。
