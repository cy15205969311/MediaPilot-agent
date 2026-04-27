# Frontend

独立前端工作台基于 `Vite + React + TypeScript + Tailwind CSS v4`。

## 启动

```bash
npm install
npm run dev
```

开发服务器默认运行在 `http://127.0.0.1:5173`，并通过 Vite 代理将 `/api` 与 `/health` 转发到 FastAPI 后端 `http://127.0.0.1:8000`。
