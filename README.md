# MediaPilot Agent 项目说明

更新日期：`2026-05-01`

MediaPilot Agent（仓库名 `omnimedia-agent`）是一个面向新媒体内容运营的智能工作台，当前重点服务小红书、抖音等内容生产场景。它不是单纯的聊天页面，而是把选题、素材、知识库、模板、草稿、图片生成和会话协作放在同一个工作台里。

## 1. 核心能力

- 后端基于 `FastAPI`、`Pydantic v2`、`SQLAlchemy`、`Alembic`，提供鉴权、会话、上传、知识库、模板、选题、仪表盘和模型注册接口。
- 前端基于 `React 18`、`Vite`、`TypeScript`、`Tailwind CSS v4`，提供完整中文工作台。
- 支持注册、登录、刷新令牌、退出登录、忘记密码、站内改密、设备会话查看与定向下线。
- 支持基于 `JTI` 的访问令牌黑名单，以及按密码变更时间统一失效旧访问令牌。
- 支持线程化会话、历史回放、重命名、删除、线程级系统提示词和知识库范围绑定。
- 支持素材上传、头像上传、本地存储和阿里云 `OSS` 双后端，`OSS` 素材按需生成签名访问链接。
- 支持图片、文档、表格、视频等素材解析：图片视觉理解，文档文本抽取，视频转写，知识库切块入库。
- 支持 `.txt`、`.md`、`.markdown`、`.pdf`、`.docx`、`.csv`、`.xlsx` 知识库上传。
- 支持多租户知识库空间、来源文件管理、切块预览、空间改名、来源删除和空间删除。
- 支持知识库检索增强生成，回答中可使用 `[1]` 这类引用标记，前端会渲染为可悬停查看来源的上标。
- 支持模板库，内置 `100+` 个行业模板，覆盖美妆护肤、美食文旅、职场金融、数码科技、电商/闲鱼、教育/干货、房产/家居、汽车/出行、母婴/宠物、情感/心理等方向。
- 支持选题池看板，状态包括 `idea`、`drafting`、`published`，可从选题一键生成或继续撰写草稿。
- 支持草稿箱聚合，把历史会话中的结构化产物整理成可搜索、可预览、可批量删除的内容资产。
- 支持内容产物复制、富文本剪贴板写入、完整 `Markdown` 导出。
- 支持 `LangGraph` 多模态工作流、联网搜索、业务工具调用和安全降级。
- 支持独立 `QwenLLMProvider`，默认模型链路为 `qwen-max -> qwen-plus -> qwen-turbo`。
- 支持后端驱动的模型注册表，前端可按 `provider:model` 选择实际后端模型。
- 支持内容生成产物携带 `generated_images`，前端可在聊天气泡和右侧产物面板中展示生成图。
- 图片生成支持 `dashscope`、`openai`、`disabled` 三种后端模式；`openai` 兼容模式可解析 `url` 和 `b64_json`，失败时可回退到 `DashScope`。
- 支持亮色和深色主题，用户偏好会保存到本地。
- 后端单元测试和前端 `Playwright` 浏览器测试覆盖主要回归链路。

## 2. 技术栈

后端：

- `Python 3.11+`
- `FastAPI`
- `Pydantic v2`
- `SQLAlchemy`
- `Alembic`
- `LangGraph`
- `LangChain Core`
- `OpenAI` 兼容接口
- 阿里云 `DashScope` 兼容接口
- `SQLite`
- `ChromaDB`
- `APScheduler`
- 阿里云 `OSS`

前端：

- `React 18`
- `Vite`
- `TypeScript`
- `Tailwind CSS v4`
- `Lucide React`
- `Playwright`

## 3. 快速开始

### 3.1 后端环境

推荐使用 `Python 3.11+`：

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

### 3.2 前端环境

推荐使用 `Node.js 18+`：

```bash
cd frontend
npm install
```

首次运行浏览器自动化测试前安装浏览器：

```bash
cd frontend
npx playwright install chromium
```

### 3.3 环境变量

复制配置模板：

```bash
copy .env.example .env
```

常用配置分组如下：

- 大模型配置：`LLM_*`、`QWEN_*`
- 视觉与图片生成配置：`IMAGE_GENERATION_*`、`OPENAI_IMAGE_*`
- 搜索工具配置：`TAVILY_API_KEY`
- 对象存储配置：`OMNIMEDIA_STORAGE_BACKEND`、`OSS_*`
- 鉴权配置：`JWT_*`
- 跨域配置：`CORS_ALLOWED_ORIGINS`
- 数据库配置：`DATABASE_URL`

`.env` 包含密钥和私有地址，不要提交到仓库。

## 4. 启动与访问

执行数据库迁移：

```bash
alembic upgrade head
```

启动后端：

```bash
uvicorn app.main:app --reload
```

启动前端：

```bash
cd frontend
npm run dev
```

常用访问地址：

- 前端工作台：`http://127.0.0.1:5173`
- 同网段设备访问：`http://<你的局域网 IP>:5173`
- 后端服务：`http://127.0.0.1:8000`
- 后端接口文档：`http://127.0.0.1:8000/docs`

前端开发服务器已绑定 `0.0.0.0`，方便同一局域网设备访问。后端跨域白名单可通过 `CORS_ALLOWED_ORIGINS` 扩展。

## 5. 常用命令

安装后端依赖：

```bash
pip install -r requirements.txt
```

执行后端测试：

```bash
python -m pytest -q
```

当前后端回归基线：`117 passed`。

执行前端构建：

```bash
cd frontend
npm run build
```

执行前端浏览器测试：

```bash
cd frontend
npx playwright test
```

当前前端浏览器回归基线：`21 passed`。

打开可视化测试面板：

```bash
cd frontend
npx playwright test --ui
```

## 6. 存储与素材

上传链路支持两种存储后端：

- 本地 `/uploads`：适合本地开发和快速联调。
- 阿里云 `OSS`：适合多实例部署、集中存储和生产环境素材管理。

关键行为：

- `OMNIMEDIA_STORAGE_BACKEND=auto` 时，`OSS` 配置完整就优先使用云存储，否则回退到本地。
- `OMNIMEDIA_STORAGE_BACKEND=local` 时，强制使用本地存储。
- `OMNIMEDIA_STORAGE_BACKEND=oss` 时，强制使用阿里云 `OSS`，缺少配置会直接报错。
- 未绑定线程的素材会先进入 `uploads/tmp/` 临时前缀。
- 素材绑定线程后会提升到长期保存前缀。
- `OSS` 素材返回前端时会按需签发访问链接，默认有效期为 `3600` 秒。
- 可通过 `GET /api/v1/media/retention` 查看当前用户的上传留存指标。
- 开启 `OSS_AUTO_SETUP_LIFECYCLE=true` 后，后端会在启动和每日调度中尝试下发生命周期规则。

## 7. 知识库

知识库用于把私有资料注入内容生成流程：

- 左侧边栏提供独立“知识库”工作台。
- 上传接口为 `POST /api/v1/media/knowledge/upload`。
- 支持文本、`PDF`、`Word`、表格文件入库。
- 表格会按行转换为检索友好的键值文本后再切块。
- 数据按 `user_id + scope + source` 隔离，避免不同用户串库。
- 同一空间内同名来源再次上传时，会先删除旧切块再写入新内容。
- 空间改名会同步更新当前用户的线程和模板绑定。
- 线程或模板携带 `knowledge_base_scope` 时，生成前会检索对应空间并注入上下文。
- 使用知识库内容生成的回答会被要求添加引用标记，并在末尾附参考资料。

当前知识库优先使用 `ChromaDB` 持久化向量集合，同时保留本地文件降级路径，方便低依赖环境运行。

## 8. 模板、选题与草稿

模板库：

- 接口入口为 `GET /api/v1/media/templates`。
- 支持系统预置模板和用户自定义模板。
- 支持搜索、行业筛选、创建、删除、批量清理和一键使用。
- 模板可以绑定 `knowledge_base_scope`，新建线程时会一并继承。
- 聊天产物可保存为模板，便于沉淀高频工作流。

选题池：

- 接口入口为 `GET /api/v1/media/topics`。
- 支持新增、编辑、删除和状态流转。
- 看板状态为 `idea -> drafting -> published`。
- 选题可绑定专属 `thread_id`，首次生成草稿后可继续回到同一会话。

草稿箱：

- 接口入口为 `GET /api/v1/media/artifacts`。
- 草稿来自持久化的 `ArtifactRecord`。
- 支持搜索、平台筛选、预览、回到原会话、单条删除、批量删除和清空。

## 9. 图片生成

内容生成产物可以携带后端生成的图片：

- 产物字段为 `generated_images`。
- `LangGraph` 会在文本审核后、产物格式化前尝试生成图片。
- 图片生成失败不会中断正文产物交付。
- `IMAGE_GENERATION_BACKEND=disabled` 表示关闭图片生成。
- `IMAGE_GENERATION_BACKEND=dashscope` 表示使用阿里云图片生成链路。
- `IMAGE_GENERATION_BACKEND=openai` 表示使用兼容 `/images/generations` 的图片接口。
- `openai` 兼容链路默认请求 `b64_json`，也兼容标准 `data[].url`。
- 生成图会尽量重新保存到当前存储后端，避免依赖上游临时链接。
- 如果主图片网关失败且 `DashScope` 凭据可用，服务会自动尝试回退。
- 历史会话和草稿返回时会重新解析存储引用，避免旧签名链接过期后图片丢失。

## 10. 主题系统

工作台支持亮色和深色主题：

- 颜色变量定义在 `frontend/src/styles/theme.css`。
- 主题状态由 `frontend/src/app/ThemeContext.tsx` 管理。
- 首次进入优先读取本地偏好，否则回退系统偏好。
- 切换时会把主题类名挂载到 `html` 根节点。
- 用户气泡、助手气泡、面板和按钮使用语义化颜色变量，保证两套主题下都有清晰层次。

## 11. 文档结构

仓库采用双文档结构：

- `README.md`：中文项目概览、快速上手、运行说明和主要能力说明。
- `DEVELOPMENT.md`：中文工程基线、接口约束、数据约束、测试基线和变更规则。

后续涉及功能、接口、持久化、流程、测试基线或重要交互变更时，需要同步更新这两个文档。
