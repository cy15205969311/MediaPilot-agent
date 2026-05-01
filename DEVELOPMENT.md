# OmniMedia Agent 开发文档

文档版本：`v1.13.39`

更新日期：`2026-05-01`

适用范围：当前仓库实现，包括后端接口、鉴权、会话、素材、对象存储、知识库、模板、选题、仪表盘、模型注册、流式生成、图片生成、前端工作台、测试基线和变更规则。

## 1. 文档定位

本文是仓库的工程基线文档。凡是涉及接口契约、数据库结构、持久化行为、流式事件、前后端联动、重要用户交互或测试基线的变更，都应该在同一个变更集中更新本文。

配套文档：

- `README.md`：中文项目概览、快速上手和运行说明。
- `DEVELOPMENT.md`：工程约束、接口边界、实现状态和变更规则。

保留英文的范围仅限必要的技术名、代码标识、环境变量、命令、路径、接口、字段名和协议名。

## 2. 产品定位

OmniMedia Agent 是一个任务型内容运营工作台，当前重点覆盖小红书和抖音内容生产。它的核心目标是把内容运营中分散的步骤收束到统一工作流：

1. 选题规划。
2. 素材上传与解析。
3. 私有知识库检索。
4. 模板化内容生成。
5. 热点与竞品信息辅助。
6. 结构化草稿审阅。
7. 生成图交付。
8. 历史会话和内容资产管理。

主要用户包括内容运营、品牌市场团队、个人 IP 运营者和代运营团队。

## 3. 当前范围

### 3.1 已纳入范围

1. 基于 `FastAPI` 的后端接口。
2. 基于 `React + Vite + TypeScript + Tailwind CSS` 的中文前端工作台。
3. 用户注册、登录、刷新令牌、退出登录、忘记密码、密码重置和站内改密。
4. 刷新会话持久化、设备会话查看、定向下线、访问令牌黑名单。
5. 按 `password_changed_at` 统一失效旧访问令牌。
6. 按用户隔离线程、消息、素材、模板、选题、知识库和草稿。
7. 线程级 `system_prompt` 和 `knowledge_base_scope` 持久化。
8. 基于 `SSE` 的流式聊天和产物返回。
9. 本地存储与阿里云 `OSS` 双后端上传。
10. `OSS` 签名链接、临时前缀、线程绑定提升、生命周期辅助下发和留存统计。
11. `SQLite` 默认持久化，`SQLAlchemy` 作为数据访问层。
12. `Alembic` 数据库迁移。
13. 线程历史回放、重命名、删除。
14. 用户资料编辑、头像上传、头像孤儿文件清理。
15. `LangGraph` 多模态编排、视觉理解、文档解析、视频转写、联网搜索、业务工具调用和安全降级。
16. `QwenLLMProvider` 三级模型降级和请求级模型覆盖。
17. 后端模型注册表接口，前端可搜索、分组并按状态选择模型。
18. 业务工具通过 `bind_tools` 接入，支持顺序工具规划。
19. `Tavily` 市场趋势工具，未配置或失败时回退到确定性模拟结果。
20. 草稿箱、模板库、选题池、知识库、数据仪表盘等工作台视图。
21. 模板中心内置 `100+` 行业模板，并支持用户自定义模板。
22. 知识库支持 `.txt`、`.md`、`.markdown`、`.pdf`、`.docx`、`.csv`、`.xlsx`。
23. 知识库支持空间列表、上传、改名、来源列表、来源预览、来源删除和空间删除。
24. 知识库检索增强回答支持引用标记和前端悬停来源提示。
25. 结构化产物失败时保留可用原始草稿，并降级为可渲染产物。
26. 流式失败时前端显示明确错误卡片，并移除空白助手占位。
27. 内容产物支持分块复制、富文本剪贴板、完整 `Markdown` 导出。
28. 图片生成服务支持 `dashscope`、`openai` 和关闭模式。
29. `openai` 兼容图片链路支持 `/images/generations`、`b64_json`、标准图片链接和回退。
30. 生成图片会尽量保存为当前存储后端的受管引用。
31. 历史会话和草稿响应会按需重新生成图片访问链接。
32. 亮色和深色主题，以及本地主题偏好持久化。
33. 后端测试覆盖鉴权、历史、上传、知识库、图片生成、调度器和图工作流。
34. 前端 `Playwright` 覆盖登录、密码重置、刷新重试、线程生命周期、资料和设备安全、上传、模板、知识库、复制导出等高频链路。

### 3.2 暂未生产完备的范围

1. 第三方单点登录和企业身份源。
2. 设备指纹、组织级强制下线后台和黑名单定期压缩。
3. 完整生产级观测、限流和审计日志。
4. 更深的外部业务系统集成，例如商品库、客户关系系统、竞品库和投放系统。
5. CDN 刷新、多桶治理和完整运营后台留存控制台。
6. 真实邮件或短信找回密码投递。
7. 更高级的头像裁剪、压缩和 CDN 托管。

## 4. 架构概览

### 4.1 总体结构

```text
前端工作台 -> 前端网络层 -> 鉴权令牌 -> FastAPI 路由 -> 归属校验
          -> 持久化服务 -> LangGraph / 业务服务 -> 模型或工具
          -> SSE / JSON 响应 -> 前端状态更新
```

主要分层：

- `app/api/`：只处理路由、鉴权依赖、请求响应组装和状态码。
- `app/models/`：后端接口模型和字段契约。
- `app/db/`：数据库连接、会话和 ORM 模型。
- `app/services/`：业务逻辑、模型提供者、存储、知识库、调度器和持久化辅助。
- `app/services/graph/`：`LangGraph` 工作流。
- `frontend/src/app/api.ts`：前端唯一网络边界。
- `frontend/src/app/components/`：前端组件和视图。
- `frontend/src/app/components/artifacts/`：结构化产物渲染。

### 4.2 目录结构

```text
omnimedia-agent/
|- app/
|  |- main.py
|  |- config.py
|  |- api/v1/
|  |  |- auth.py
|  |  |- chat.py
|  |  |- dashboard.py
|  |  |- history.py
|  |  |- knowledge.py
|  |  |- models.py
|  |  |- oss.py
|  |  |- templates.py
|  |  '- topics.py
|  |- db/
|  |  |- database.py
|  |  '- models.py
|  |- models/
|  |  '- schemas.py
|  '- services/
|     |- agent.py
|     |- auth.py
|     |- dashboard.py
|     |- image_generation.py
|     |- knowledge_base.py
|     |- media_parser.py
|     |- model_registry.py
|     |- oss_client.py
|     |- persistence.py
|     |- providers.py
|     |- scheduler.py
|     |- template_library.py
|     |- tools.py
|     '- graph/provider.py
|- alembic/versions/
|- frontend/
|  |- package.json
|  |- playwright.config.ts
|  |- vite.config.ts
|  '- src/app/
|     |- App.tsx
|     |- api.ts
|     |- artifactMarkdown.ts
|     |- types.ts
|     |- ThemeContext.tsx
|     '- components/
|- tests/
|- uploads/
|- .env.example
|- requirements.txt
|- README.md
'- DEVELOPMENT.md
```

## 5. 环境与启动

### 5.1 后端

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```

### 5.2 前端

```bash
cd frontend
npm install
npm run dev
```

首次运行浏览器测试：

```bash
cd frontend
npx playwright install chromium
```

### 5.3 访问地址

- 前端工作台：`http://127.0.0.1:5173`
- 局域网访问：`http://<你的局域网 IP>:5173`
- 后端服务：`http://127.0.0.1:8000`
- 后端接口文档：`http://127.0.0.1:8000/docs`

### 5.4 关键环境变量

模型与工作流：

- `LLM_PROVIDER`
- `LANGGRAPH_INNER_PROVIDER`
- `QWEN_API_KEY`
- `QWEN_BASE_URL`
- `QWEN_PRIMARY_MODEL`
- `QWEN_ARTIFACT_MODEL`
- `QWEN_FALLBACK_MODELS`
- `QWEN_ENABLE_TOOL_BINDING`
- `TAVILY_API_KEY`

图片生成：

- `IMAGE_GENERATION_BACKEND`
- `IMAGE_GENERATION_API_KEY`
- `IMAGE_GENERATION_BASE_URL`
- `IMAGE_GENERATION_MODEL`
- `IMAGE_GENERATION_COUNT`
- `IMAGE_GENERATION_TIMEOUT_SECONDS`
- `IMAGE_GENERATION_PERSIST_RESULTS`
- `OPENAI_IMAGE_BASE_URL`
- `OPENAI_IMAGE_API_KEY`
- `OPENAI_IMAGE_MODEL`
- `OPENAI_IMAGE_REQUEST_TIMEOUT_SECONDS`

对象存储：

- `OMNIMEDIA_STORAGE_BACKEND`
- `OSS_ACCESS_KEY_ID`
- `OSS_ACCESS_KEY_SECRET`
- `OSS_ENDPOINT`
- `OSS_BUCKET_NAME`
- `OSS_REGION`
- `OSS_PUBLIC_BASE_URL`
- `OSS_SIGNED_URL_EXPIRE_SECONDS`
- `OSS_AUTO_SETUP_LIFECYCLE`

鉴权和本地联调：

- `JWT_SECRET_KEY`
- `JWT_ACCESS_EXPIRE_MINUTES`
- `JWT_REFRESH_EXPIRE_DAYS`
- `JWT_PASSWORD_RESET_EXPIRE_MINUTES`
- `CORS_ALLOWED_ORIGINS`
- `DATABASE_URL`

## 6. 后端接口概览

所有需要登录的接口都必须携带 `Authorization: Bearer <access_token>`。除注册、登录、刷新令牌和找回密码请求外，默认视为受保护接口。

### 6.1 鉴权接口

- `POST /api/v1/auth/register`：注册并返回令牌。
- `POST /api/v1/auth/login`：登录并返回令牌。
- `POST /api/v1/auth/refresh`：刷新访问令牌和刷新令牌。
- `POST /api/v1/auth/logout`：退出登录并吊销当前访问令牌。
- `POST /api/v1/auth/password-reset-request`：创建找回密码令牌。
- `POST /api/v1/auth/password-reset`：使用找回密码令牌重置密码。
- `POST /api/v1/auth/reset-password`：登录状态下修改密码。
- `GET /api/v1/auth/sessions`：查看当前用户设备会话。
- `DELETE /api/v1/auth/sessions/{session_id}`：定向下线指定设备。
- `PATCH /api/v1/auth/profile`：更新用户资料。

### 6.2 媒体与会话接口

- `POST /api/v1/media/chat/stream`：流式聊天和产物生成。
- `GET /api/v1/media/threads`：线程列表。
- `GET /api/v1/media/threads/{thread_id}/messages`：线程历史消息。
- `PATCH /api/v1/media/threads/{thread_id}`：更新线程标题或提示词。
- `DELETE /api/v1/media/threads/{thread_id}`：删除线程。
- `POST /api/v1/media/upload`：上传头像或素材。
- `GET /api/v1/media/retention`：上传留存统计。

### 6.3 草稿、模板、选题、知识库

- `GET /api/v1/media/artifacts`：草稿列表。
- `DELETE /api/v1/media/artifacts/{message_id}`：删除单条草稿。
- `DELETE /api/v1/media/artifacts`：批量删除或清空草稿。
- `GET /api/v1/media/templates`：模板列表。
- `POST /api/v1/media/templates`：创建模板。
- `DELETE /api/v1/media/templates/{template_id}`：删除模板。
- `DELETE /api/v1/media/templates`：批量删除模板。
- `GET /api/v1/media/skills/search`：预留技能搜索接口。
- `GET /api/v1/media/topics`：选题列表。
- `POST /api/v1/media/topics`：创建选题。
- `PATCH /api/v1/media/topics/{topic_id}`：更新选题。
- `DELETE /api/v1/media/topics/{topic_id}`：删除选题。
- `GET /api/v1/media/knowledge/scopes`：知识库空间列表。
- `POST /api/v1/media/knowledge/upload`：上传知识文档。
- `PATCH /api/v1/media/knowledge/scopes/{scope_name}`：知识库空间改名。
- `DELETE /api/v1/media/knowledge/scopes/{scope}`：删除知识库空间。
- `GET /api/v1/media/knowledge/scopes/{scope_name}/sources`：来源文件列表。
- `GET /api/v1/media/knowledge/scopes/{scope_name}/sources/{source_name}/preview`：来源切块预览。
- `DELETE /api/v1/media/knowledge/scopes/{scope_name}/sources/{source_name}`：删除来源文件。

### 6.4 其他接口

- `GET /api/v1/media/dashboard/summary`：当前用户生产力仪表盘。
- `GET /api/v1/models/available`：可用模型注册表。

## 7. 数据契约

### 7.1 聊天请求

`MediaChatRequest` 是流式聊天的核心请求：

- `thread_id`：线程标识。
- `platform`：目标平台，当前为 `xiaohongshu` 或 `douyin`。
- `task_type`：任务类型，包括 `topic_planning`、`content_generation`、`hot_post_analysis`、`comment_reply`。
- `message`：用户输入。
- `materials`：上传或外部素材列表。
- `system_prompt`：线程级人设或品牌提示词。
- `knowledge_base_scope`：线程绑定的知识库空间。
- `thread_title`：可选线程标题。
- `model_override`：请求级模型覆盖，例如 `dashscope:qwen-max`。

`MaterialInput` 字段：

- `type`：`image`、`video_url` 或 `text_link`。
- `url`：原始地址、上传地址或受管存储路径。
- `text`：补充文本或提取文本。

### 7.2 产物类型

当前稳定产物类型：

- `topic_list`：选题规划。
- `content_draft`：内容草稿。
- `hot_post_analysis`：爆款分析。
- `comment_reply`：评论回复。

`content_draft` 可携带 `generated_images`，用于保存后端生成图片的受管访问地址或可解析引用。

### 7.3 时间规则

后端统一保存和返回 UTC 时间。接口序列化使用 ISO 格式并以 `Z` 结尾。前端负责按浏览器本地时区展示。

### 7.4 归属规则

所有用户数据查询和变更都必须按当前用户过滤。包括：

- 线程和消息。
- 素材和上传记录。
- 草稿产物。
- 模板。
- 选题。
- 知识库空间和来源。
- 设备会话。

不存在或不属于当前用户的资源，应该返回 `404` 或等价安全响应，不暴露其他用户数据是否存在。

## 8. 流式事件约定

`POST /api/v1/media/chat/stream` 使用 `SSE`。稳定事件类型如下：

- `start`：流式任务开始。
- `message`：助手正文增量。
- `tool_call`：工具、解析、搜索、图片生成等中间进度。
- `artifact`：结构化产物。
- `error`：可展示错误。
- `done`：流式任务完成。

前端要求：

1. 流式失败时显示明确错误状态。
2. 如果助手没有任何可见内容，失败后移除空白占位气泡。
3. `tool_call` 应展示为可折叠的思考或进度面板。
4. `artifact` 到达后应更新右侧产物面板，并持久化到草稿箱可见。
5. 生成图应该跟随对应助手回复内联展示，同时保留右侧面板查看能力。

## 9. 模型与工作流

### 9.1 提供者

当前主要提供者：

- `MockLLMProvider`：测试和无密钥降级。
- `OpenAIProvider`：标准 OpenAI 兼容聊天接口。
- `CompatibleLLMProvider`：通用兼容接口。
- `QwenLLMProvider`：阿里云百炼兼容模式，带三级降级。
- `LangGraphProvider`：工作流包装提供者。

### 9.2 模型选择

后端通过 `GET /api/v1/models/available` 暴露模型注册表。前端模型选择器不应硬编码可选模型，应优先消费注册表。

请求级 `model_override` 可以使用 `provider:model` 形式。后端需要按提供者前缀路由到正确模型引擎，不能只停留在前端选择状态。

### 9.3 工作流节点

`LangGraph` 当前覆盖：

1. 请求归一化。
2. 素材解析。
3. 图片视觉理解。
4. 文档内容抽取。
5. 视频转写。
6. 搜索路由。
7. 业务工具规划和执行。
8. 知识库检索注入。
9. 草稿生成。
10. 复核和重试。
11. 可选图片生成。
12. 结构化产物格式化。
13. 安全降级输出。

## 10. 上传与存储边界

上传入口为 `POST /api/v1/media/upload`。上传必须记录到 `UploadRecord`，并按用户隔离。

存储规则：

- 本地存储使用 `/uploads`。
- `OSS` 存储保存规范化后的对象路径。
- 传给前端的 `OSS` 链接应按需签发，不应长期保存一次性签名链接。
- 未绑定线程的素材进入临时前缀。
- 线程首条消息落库并绑定后，素材提升到长期前缀。
- 删除线程时应清理关联素材记录和可清理对象。
- 头像更新后应清理旧头像孤儿文件。
- 生成图片持久化时应保存受管引用，历史读取时重新解析访问链接。

知识库上传支持：

- `.txt`
- `.md`
- `.markdown`
- `.pdf`
- `.docx`
- `.csv`
- `.xlsx`

浏览器端和后端白名单必须保持一致。

## 11. 图片生成基线

图片生成服务位于 `app/services/image_generation.py`。

关键规则：

1. 图片生成只增强内容产物，不允许阻断正文交付。
2. 只有适合生成图片的内容生成任务才进入图片节点。
3. `IMAGE_GENERATION_BACKEND=disabled` 时跳过图片生成。
4. `IMAGE_GENERATION_BACKEND=dashscope` 时使用阿里云图片链路。
5. `IMAGE_GENERATION_BACKEND=openai` 时使用兼容 `/images/generations` 的接口。
6. `openai` 兼容链路默认请求 `response_format=b64_json`。
7. 图片接口响应可以是 `data[].url`，也可以是 `b64_json`。
8. `b64_json` 会先转成 `data:image/...;base64,...`，再进入统一持久化。
9. 当主链路失败且 `DashScope` 凭据可用时，可以自动回退到 `DashScope`。
10. 生成图片应尽量保存到当前存储后端，避免依赖上游临时链接。
11. 历史会话和草稿读取时必须重新生成可用访问链接。

相关测试位于 `tests/test_image_generation.py` 和 `tests/test_chat.py`。

## 12. 前端工程基线

前端主要约束：

1. `frontend/src/app/api.ts` 是唯一网络边界。
2. 鉴权令牌刷新和重试逻辑集中在前端网络层。
3. 工作台视图由 `App.tsx` 协调，具体视图组件负责展示和局部交互。
4. 聊天输入、附件、流式状态和产物状态必须保持一致。
5. 复制能力统一复用 `CopyButton`。
6. 结构化产物的导出逻辑集中在 `artifactMarkdown.ts`。
7. 主题变量集中在 `frontend/src/styles/theme.css`。
8. 前端类型需要与 `app/models/schemas.py` 同步。
9. 浏览器测试依赖稳定的可访问标签和 `data-testid`。
10. 所有中文工作台界面应优先使用中文文案。

重要视图：

- `DashboardView.tsx`：数据仪表盘。
- `DraftsView.tsx`：草稿箱。
- `KnowledgeView.tsx`：知识库。
- `TemplatesView.tsx`：模板库。
- `TopicsView.tsx`：选题池。
- `ChatFeed.tsx`：聊天消息和引用渲染。
- `RightPanel.tsx`：产物面板。
- `ModelSelector.tsx`：模型选择器。

## 13. 数据库基线

当前主要 ORM 模型：

- `User`：用户。
- `Thread`：会话线程。
- `Message`：消息。
- `Material`：消息素材。
- `ArtifactRecord`：结构化产物记录。
- `Template`：模板。
- `TopicRecord`：选题。
- `UploadRecord`：上传记录。
- `RefreshSession`：刷新会话。
- `AccessTokenBlacklist`：访问令牌黑名单。

迁移规则：

1. 数据库结构变更必须新增 `Alembic` 迁移，除非明确说明无需迁移。
2. 新字段需要同步更新后端模型、前端类型和相关测试。
3. SQLite 兼容性必须被考虑。
4. 时间字段应统一使用 UTC。
5. 涉及用户数据的表必须有明确用户归属或通过父级资源间接归属。

## 14. 测试与验证

### 14.1 后端测试

常用命令：

```bash
python -m pytest -q
```

当前后端回归基线：`117 passed`。

重点测试文件：

- `tests/test_chat.py`
- `tests/test_config.py`
- `tests/test_graph_search.py`
- `tests/test_graph_tools.py`
- `tests/test_graph_vision.py`
- `tests/test_image_generation.py`
- `tests/test_knowledge_base.py`
- `tests/test_media_parser.py`
- `tests/test_oss.py`
- `tests/test_oss_client.py`
- `tests/test_qwen_provider.py`
- `tests/test_scheduler.py`

### 14.2 前端测试

常用命令：

```bash
cd frontend
npx playwright test
```

当前前端浏览器回归基线：`21 passed`。

可视化调试：

```bash
cd frontend
npx playwright test --ui
```

前端构建：

```bash
cd frontend
npm run build
```

### 14.3 已知警告

当前后端测试仍可能出现来自 `PyPDF2` 和 `httpx` 测试客户端快捷参数的弃用警告。这些警告不阻断执行，但后续依赖维护时应清理。

## 15. 当前实现状态

### 15.1 本次文档基线

本次文档更新完成以下整理：

1. 将根目录两个主要开发文档统一改为中文主文档。
2. 移除说明性英文段落，只保留必要代码标识、命令、变量、路径和接口。
3. 补齐当前图片生成链路说明，包括 `openai` 兼容网关、`b64_json` 解析、受管存储和回退策略。
4. 补齐知识库上传范围、引用渲染、空间管理和表格解析说明。
5. 补齐生成图片在历史会话和草稿中重新解析访问链接的规则。
6. 统一 README 与工程文档中的测试基线和文档同步规则。

### 15.2 最近功能状态

最近已落地能力包括：

1. 生成图片不再把一次性签名链接永久写入产物历史，而是优先写入受管存储引用。
2. 历史会话和草稿列表读取时会为生成图片重新解析可用访问链接。
3. 对旧数据中仍保存历史签名链接的产物，读取时提供尽力恢复路径。
4. 知识库前后端均支持文本、`PDF`、`Word` 和表格上传。
5. 表格文件会转换为适合检索的文本块。
6. 私有知识库回答支持引用标记和前端来源提示。
7. 结构化产物失败时，系统会保留可用正文并降级为可渲染产物。
8. 流式失败会在前端明确展示错误，不再留下空白助手气泡。
9. 内容产物和普通助手回复都支持复制。
10. 剪贴板写入同时支持纯文本和基础富文本。
11. 内容产物支持完整 `Markdown` 导出。
12. 图片生成支持 `openai` 兼容接口和 `DashScope` 回退。

## 16. 当前非阻塞缺口

1. 访问令牌黑名单已有基础能力，但仍缺少定期压缩、设备指纹增强和组织级强制下线后台。
2. 找回密码已有本地开发链路，但还没有真实邮件或短信投递。
3. 上传和 `OSS` 生命周期已有基础治理，但还没有 CDN 刷新、多桶策略和完整管理控制台。
4. 知识库已有多格式上传、检索和引用展示，但还需要更强的向量后端、检索可观测性和业务系统连接。
5. 浏览器测试已覆盖主要高频链路，但仍需扩展归档控制、真实后端联调和真实 `OSS` 浏览器路径。

## 17. 建议下一步

1. 强化知识库管线：更好的文档解析、切块策略、嵌入模型配置、检索评分展示和引用审计。
2. 强化存储治理：CDN 刷新、多桶策略、管理员留存报表和更细的签名下载策略。
3. 强化安全后台：设备指纹、黑名单清理、组织级会话管理和操作审计。
4. 强化业务集成：商品库、竞品库、客户资料、私有资料库和投放数据接入。
5. 强化端到端测试：真实后端、真实上传、真实图片生成和 `OSS` 签名访问链路。

## 18. 变更规则

后续更新项目时必须遵守：

1. 后端契约变更要同步更新 `app/models/schemas.py` 和 `frontend/src/app/types.ts`。
2. 新增受保护接口必须说明鉴权要求。
3. 新增稳定 `SSE` 事件类型前，必须先更新本文档。
4. 持久化结构变更必须新增迁移，或写明无需迁移的理由。
5. 影响消息时序、会话状态、上传状态或用户可见行为的前端变更，应更新本文档。
6. 功能、接口、持久化、流程、测试基线或用户可见行为发生重要变化时，应同步更新 `README.md` 和 `DEVELOPMENT.md`。
7. 根目录上手方式变化时，必须更新 `README.md`。
8. 中文文档中不得再加入大段说明性英文；必要英文仅用于代码、命令、路径、变量、接口、协议和技术名。
