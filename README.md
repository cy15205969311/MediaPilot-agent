# MediaPilot Agent 项目说明

## 1. 项目简介

MediaPilot Agent 是一个面向新媒体内容运营场景的智能工作台，当前聚焦于小红书与抖音内容生产流程。项目同时提供：

- 基于 FastAPI 的后端接口与流式对话能力
- 基于 React 18 + Vite 的前端工作台
- 素材上传、视觉分析与结构化内容生成
- 线程化会话、用户资料、设备会话与素材持久化
- Light / Dark 双主题切换

这套主题系统基于 CSS 变量和 `ThemeProvider` 实现，支持在工作台顶部一键切换 Light / Dark，并会将用户偏好保存到本地 `localStorage`。

## 2. 当前核心能力

- 用户注册、登录、刷新令牌、退出登录
- 线程会话创建、历史回放、重命名、删除
- 用户资料编辑，包括昵称、简介与头像上传
- 设备会话查看与定向下线
- 素材上传与持久化跟踪
- LangGraph 多模态工作流
- 图片素材 OCR / 视觉理解
- 结构化内容产物生成与前端渲染
- 工作台全局主题切换与主题偏好持久化

## 3. 技术栈

### 后端

- FastAPI
- Pydantic v2
- SQLAlchemy
- Alembic
- LangGraph
- OpenAI Compatible API / DashScope Compatible API
- SQLite

### 前端

- React 18
- Vite
- TypeScript
- Tailwind CSS v4
- Lucide React

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

### 4.3 环境变量

先复制模板：

```bash
copy .env.example .env
```

然后按实际环境补充以下配置：

- 大模型提供者配置
- 视觉模型配置
- JWT 配置
- 数据库连接配置
- 本地联调使用的 `CORS_ALLOWED_ORIGINS`

注意：`.env` 包含敏感信息，不应提交到 Git 仓库。

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

执行前端构建：

```bash
cd frontend
npm run build
```

## 8. 文档说明

仓库当前采用双文档结构：

- `README.md`
  - 面向中文读者的快速上手、运行说明与项目概览
- `DEVELOPMENT.md`
  - 面向开发与维护的工程基线、接口约束、实现状态与变更规则

后续每次完成功能、接口、持久化、流程或重要 UI 变更时，都应同步更新相关文档，确保仓库文档与代码保持一致。
