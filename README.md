# MediaPilot Agent 项目说明

## 1. 项目简介

MediaPilot Agent 是一个面向新媒体内容生产场景的智能工作台，当前聚焦于小红书与抖音内容运营流程。项目同时提供：

- 基于 FastAPI 的后端接口与流式对话能力
- 基于 React + Vite 的前端工作台
- 多模态素材上传、视觉解析与结构化内容生成
- 线程化会话、用户资料、设备会话与素材持久化

本仓库适合用于本地开发、功能联调与后续工程扩展。

## 2. 当前核心能力

- 用户注册、登录、刷新令牌、退出登录
- 会话线程创建、历史回放、重命名、删除
- 用户资料编辑，包括昵称、简介与头像上传
- 素材上传与持久化跟踪
- LangGraph 多模态工作流
- 图片素材 OCR / 视觉理解
- 结构化内容产物生成与前端渲染
- 设备会话查看与定向下线

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

## 4. 目录说明

```text
omnimedia-agent/
|- app/                  后端应用代码
|- alembic/              数据库迁移
|- frontend/             前端工作台
|- tests/                自动化测试
|- uploads/              本地上传目录
|- .env.example          环境变量模板
|- DEVELOPMENT.md        工程开发基线文档
'- README.md             中文项目说明
```

## 5. 快速开始

### 5.1 后端环境

推荐使用 Python 3.12。

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

### 5.2 前端环境

推荐使用 Node.js 18+。

```bash
cd frontend
npm install
```

### 5.3 环境变量

先复制模板：

```bash
copy .env.example .env
```

然后按实际环境补充：

- 大模型提供者配置
- 视觉模型配置
- JWT 配置
- OSS 配置
- 数据库连接配置

注意：`.env` 包含敏感信息，不应提交到 Git 仓库。

### 5.4 数据库迁移

```bash
alembic upgrade head
```

### 5.5 启动项目

后端：

```bash
uvicorn app.main:app --reload
```

前端：

```bash
cd frontend
npm run dev
```

本地联调说明：

- 前端默认开发地址为 `http://localhost:5173` 或 `http://127.0.0.1:5173`
- 如果需要同一网段访问，请使用当前开发机的实际局域网 IP，例如：`http://你的局域网IP:5173`
- 后端默认开发地址为 `http://127.0.0.1:8000`
- 前端 Vite 开发服务器已配置为监听 `0.0.0.0`，便于同一网段设备访问
- 后端已在 `app/main.py` 中支持通过环境变量 `CORS_ALLOWED_ORIGINS` 配置本地开发用 CORS 白名单

示例：

```env
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://你的局域网IP:5173
```

## 6. 常用命令

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

## 7. 文档说明

本仓库当前采用双文档结构：

- `README.md`
  - 面向中文读者的快速上手、运行说明与项目概览
- `DEVELOPMENT.md`
  - 面向开发与维护的工程基线、接口约束、实现状态与变更规则

后续每次完成功能、接口、持久化、流程或重要 UI 变更时，均应同步更新相关文档，确保仓库文档与代码保持一致。
