# MediaPilot Agent 项目说明

## 1. 项目简介

MediaPilot Agent 是一个面向新媒体内容运营场景的智能工作台，当前聚焦于小红书与抖音内容生产流程。项目同时提供：

- 基于 FastAPI 的后端接口与流式对话能力
- 基于 React 18 + Vite 的前端工作台
- 素材上传、视觉分析与结构化内容生成
- 线程化会话、用户资料、设备会话与素材持久化
- Light / Dark 双主题切换
- Playwright 端到端浏览器自动化测试基线
- LangGraph ReAct 业务工具调用、顺序多工具规划与可扩展业务工具节点
- 独立 `QwenLLMProvider`、三级模型降级 (`qwen-max -> qwen-plus -> qwen-turbo`)、后端驱动的模型注册表接口，以及支持搜索/分组/状态感知并可按 `provider:model` 真正切换后端引擎的前端模型选择器

这套主题系统基于 CSS 变量和 `ThemeProvider` 实现，支持在工作台顶部一键切换 Light / Dark，并会将用户偏好保存到本地 `localStorage`。

## 2. 当前核心能力

- 用户注册、登录、刷新令牌、退出登录
- 忘记密码、密码重置与重置后全局设备强制下线
- 线程会话创建、历史回放、重命名、删除
- 用户资料编辑，包括昵称、简介与头像上传
- 设备会话查看与定向下线
- 素材上传、持久化跟踪、本地 / OSS 双后端存储与 Signed URL 安全交付
- LangGraph 多模态工作流、联网热点检索与 ReAct 业务工具调用
- LangGraph 业务工具节点，可通过 `bind_tools` 顺序调用本地 Python 工具，优先拉取 Tavily 实时类目热词情报并结合本地大纲工具后再生成最终草稿，未配置时安全回退 mock 数据
- 图片素材 OCR / 视觉理解 / 搜索上下文增强
- 结构化内容产物生成与前端渲染
- 工作台全局主题切换与主题偏好持久化
- Playwright 覆盖注册/登录、密码重置、刷新重试、线程创建/回放/重命名/删除、资料更新、设备管理、站内改密、Artifact 动作与素材上传流式链路

## 3. 技术栈

### 后端

- FastAPI
- Pydantic v2
- SQLAlchemy
- Alembic
- LangGraph
- LangChain Core
- OpenAI Compatible API / DashScope Compatible API
- SQLite

### 前端

- React 18
- Vite
- TypeScript
- Tailwind CSS v4
- Lucide React
- Playwright

## 4. 快速开始

### 4.1 后端环境

推荐使用 Python 3.11+：

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

### 4.2 前端环境

推荐使用 Node.js 18+：

```bash
cd frontend
npm install
```

首次运行 Playwright E2E 前安装浏览器：

```bash
cd frontend
npx playwright install chromium
```

### 4.3 环境变量

先复制模板：

```bash
copy .env.example .env
```

然后按实际环境补充以下配置：

- 大模型提供者配置
- `QWEN_*` 独立提供者与降级策略配置
- 视觉模型配置
- 可选联网搜索配置（如 `TAVILY_API_KEY`，同时为 LangGraph 搜索节点与市场趋势业务工具提供实时检索）
- 可选对象存储配置（如 `OMNIMEDIA_STORAGE_BACKEND`、`OSS_*`）
- JWT 配置
- 可选密码重置令牌时效配置（如 `JWT_PASSWORD_RESET_EXPIRE_MINUTES`）
- 数据库连接配置
- 本地联调使用的 `CORS_ALLOWED_ORIGINS`

注意：`.env` 包含敏感信息，不应提交到 Git 仓库。

如需启用阿里云 OSS，可至少补充以下变量：

```env
OMNIMEDIA_STORAGE_BACKEND=auto
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
OSS_ENDPOINT=
OSS_BUCKET_NAME=
OSS_REGION=
OSS_PUBLIC_BASE_URL=
OSS_SIGNED_URL_EXPIRE_SECONDS=3600
OSS_SIGNED_URL_MIN_EXPIRE_SECONDS=60
OSS_SIGNED_URL_MAX_EXPIRE_SECONDS=86400
OSS_TMP_UPLOAD_EXPIRE_DAYS=3
OSS_THREAD_UPLOAD_TRANSITION_DAYS=30
OSS_THREAD_UPLOAD_TRANSITION_STORAGE_CLASS=IA
OSS_AUTO_SETUP_LIFECYCLE=false
```

说明：

- `auto`：当 OSS 配置完整时优先使用 OSS，否则自动回退到本地 `/uploads`
- `local`：强制使用本地存储
- `oss`：强制使用阿里云 OSS，缺少配置时会直接报错
- `OSS_SIGNED_URL_EXPIRE_SECONDS`：控制前端读取 OSS 素材时签名 URL 的有效期，默认 `3600` 秒
- `OSS_SIGNED_URL_MIN_EXPIRE_SECONDS` / `OSS_SIGNED_URL_MAX_EXPIRE_SECONDS`：限制签名 URL 有效期的最小和最大边界，默认 `60` 秒到 `86400` 秒
- `OSS_TMP_UPLOAD_EXPIRE_DAYS`：控制 `uploads/tmp/` 下未绑定会话的临时素材保留天数，默认 `3` 天
- `OSS_THREAD_UPLOAD_TRANSITION_DAYS`：控制正常线程素材触发降冷的天数阈值，默认 `30` 天
- `OSS_THREAD_UPLOAD_TRANSITION_STORAGE_CLASS`：控制生命周期规则切换的目标存储类型，默认 `IA`
- `OSS_AUTO_SETUP_LIFECYCLE`：设为 `true` 时，后端启动和每日调度会自动调用 OSS 生命周期规则下发逻辑

补充说明：

- 未绑定 `thread_id` 的 OSS 素材会先写入 `uploads/tmp/{user_id}/{filename}`，在会话首条消息落库并绑定 Thread 后提升到 `uploads/{user_id}/{filename}`
- 后端数据库优先保存规范化后的存储路径，真正返回给前端时再动态生成可过期的 Signed URL，避免素材长期暴露为公网直链
- 如需查看当前登录用户的上传留存指标，可调用 `GET /api/v1/media/retention`
- 如需把 Bucket 生命周期规则真正下发到云端，可开启 `OSS_AUTO_SETUP_LIFECYCLE=true`，或在运维初始化阶段手动调用 `AliyunOSSClient.setup_bucket_lifecycle()`

### 4.4 数据库迁移

```bash
alembic upgrade head
```

### 4.5 启动项目

后端：

```bash
uvicorn app.main:app --reload
```

前端：

```bash
cd frontend
npm run dev
```

## 5. 访问地址

- 前端工作台：`http://127.0.0.1:5173`
- 同网段设备访问：`http://<你的局域网 IP>:5173`
- 后端服务：`http://127.0.0.1:8000`
- 后端文档：`http://127.0.0.1:8000/docs`

Vite 开发服务器已绑定 `0.0.0.0`，方便同网段设备直接访问。后端 CORS 白名单可通过 `CORS_ALLOWED_ORIGINS` 扩展。

当前上传链路支持两种后端：

- 本地 `/uploads`：适合纯本地开发和快速联调
- 阿里云 OSS：适合多实例部署、集中存储与生产环境素材管理
- 阿里云 OSS 响应给前端的素材链接现已改为按需签发的 Signed URL，默认 1 小时过期
- OSS 未绑定素材默认进入 `uploads/tmp/` 临时前缀，绑定到会话后再提升到长期保存前缀
- 可结合 OSS 生命周期规则对 `uploads/tmp/` 做自动过期清理，并对历史线程素材做低频/归档降冷；开启 `OSS_AUTO_SETUP_LIFECYCLE` 后会在启动和每日调度中自动下发规则

## 6. 主题系统

- `Light`：高对比、清爽明亮，适合白天快速操作
- `Dark`：深色背景，适合夜间审稿和长时间盯屏

当前实现特点：

- 使用 `frontend/src/styles/theme.css` 定义语义化颜色变量
- 使用 `frontend/src/app/ThemeContext.tsx` 管理主题状态
- 首次进入优先读取本地主题偏好，否则回退系统 `prefers-color-scheme`
- 切换时将主题 class 挂载到 `html` 根节点，并带有平滑过渡动画
- 用户气泡与 AI 气泡使用独立的语义化颜色变量，在两套主题下保持清晰层次和阅读对比度

## 7. 常用命令

安装后端依赖：

```bash
pip install -r requirements.txt
```

执行后端测试：

```bash
python -m pytest -q
```
Current backend regression baseline: `114 passed`.

- Artifact delivery now supports per-block clipboard copy with success feedback and full Markdown export downloads from both the workspace header and the right-side artifact panel.
- Streamed `tool_call` progress now appears in the chat workspace as a collapsible "AI thinking" panel, so users can see attachment parsing, search, and review steps while long-running jobs are still in flight.

默认测试收集范围已通过 `pytest.ini` 限定为 `tests/`，不会误扫 `uploads/` 下的临时目录。
当前后端回归基线为 `114 passed`。

执行前端构建：

```bash
cd frontend
npm run build
```

执行前端 E2E 自动化测试：

```bash
cd frontend
npx playwright test
```

当前前端 E2E 回归基线为 `21 passed`。

打开 Playwright 可视化测试面板：

```bash
cd frontend
npx playwright test --ui
```

## 8. 文档说明

仓库当前采用双文档结构：

- `README.md`
  - 面向中文读者的快速上手、运行说明与项目概览
- `DEVELOPMENT.md`
  - 面向开发与维护的工程基线、接口约束、实现状态与变更规则

## 9. 草稿箱与工作台视图

当前工作台已经具备轻量级的业务视图切换能力，左侧边栏的“我的草稿”会进入独立的草稿箱页面，而点击具体会话会返回聊天视图。

- 草稿数据来自后端 `GET /api/v1/media/artifacts`
- 每条草稿都聚合自持久化的 `ArtifactRecord`
- 草稿卡片支持搜索、平台筛选、全文预览，以及“在会话中打开”
- 草稿箱现已支持单条删除、多选批量删除与一键清空，适合日常高频整理废稿和中间产物
- 重新打开草稿时，前端会跳回原始 `thread_id` 并加载对应历史会话

这一步让 MediaPilot 不再只是单一聊天页，而是开始具备“内容资产管理工作台”的基础骨架。

后续每次完成功能、接口、持久化、流程、测试基线或重要 UI 变更时，都必须同步更新 `README.md` 与 `DEVELOPMENT.md` 中相关章节，确保仓库文档与代码保持一致。
## 10. 模板库

- 模板数据来自后端 `GET /api/v1/media/templates`
- 当前内置了 `100+` 个覆盖美妆护肤、美食文旅、职场金融、数码科技、电商/闲鱼、教育/干货、房产/家居、汽车/出行、母婴/宠物、情感/心理等 `10` 大行业的系统预置模板
- 模板中心现已回归“本地优先”模式，主界面默认隐藏云端 `Skills` 入口，用户可以直接通过搜索框与行业分类快速筛选本地模板
- 点击模板卡片上的“一键使用”后，工作台会自动切回聊天区并弹出新建会话窗口
- 被选模板的 `title` 与 `system_prompt` 会自动填入新建会话表单，减少重复输入成本
- 模板记录现已支持 `knowledge_base_scope`，可以提前声明后续 RAG / 私有知识库的关联范围
- 使用模板开启新会话时，`knowledge_base_scope` 会随线程一起持久化，并在 LangGraph 最终生成前自动检索对应知识上下文
- 聊天区最新产物支持“存为模板”，会把当前 `system_prompt`、产物标题和摘要直接预填到模板创建弹窗
- 后端仍保留 `GET /api/v1/media/skills/search` 作为后续扩展能力，但当前默认交互以高质量本地模板库为主

## 11. 选题池

- 选题数据来自后端 `GET /api/v1/media/topics`
- 选题池已支持完整 CRUD：新建灵感、编辑内容、状态流转和删除废弃选题
- 页面采用三列轻量级看板：`灵感备选 -> 撰写中 -> 已发布`
- 每张选题卡片都可以通过左右流转按钮推进状态，也可以在 `idea` / `drafting` 阶段点击“一键生成草稿”
- 首次点击“一键生成草稿”时，系统会为该选题绑定一个专属 `thread_id`；后续主按钮会变成“继续撰写”，直接回到原会话上下文
- “一键生成草稿”会自动切回聊天区、弹出新建会话窗口，并把选题标题和专属系统 Prompt 预填到表单中
- 当选题被带入聊天工作流时，后台会同步把状态推进到 `drafting`，形成从灵感记录到内容生成的闭环

## 12. 知识库

- 左侧边栏现已提供独立的“知识库”工作台，可查看当前用户名下的所有 Scope
- 后端新增 `GET /api/v1/media/knowledge/scopes`、`POST /api/v1/media/knowledge/upload`、`DELETE /api/v1/media/knowledge/scopes/{scope}` 三个鉴权接口
- 当前上传入口支持 `.txt`、`.md`、`.markdown`，并会自动处理 `utf-8-sig`、`utf-8`、`gb18030` 编码
- 文本会在入库前自动切块，然后按 `user_id + scope + source` 维度持久化，避免不同用户之间的知识串库
- `knowledge_base_scope` 仍然可以从模板一路透传到线程；当线程命中对应 Scope 时，LangGraph 会在最终生成前自动检索并注入相关上下文
- 当前实现优先使用 Chroma 持久化向量集合，同时保留本地 JSON fallback，便于本地开发和低依赖环境运行
