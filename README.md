# speak_English

英语口语练习 Web 应用：AI 对话 + 开源发音评测，目标是在 **2 核 / 4 GB** 单机上低成本运行。

规划依据见 `plan/产品规划.md`（需求与路线）、`plan/技术方案.md`（架构与接口设计）。

## 当前状态（2026-10-14）

Phase 1 代码骨架已落地，**但尚未运行验证**：本次开发环境缺 `pip` 与 `node/npm`，依赖未安装、服务未启动、前后端未联调。已做的检查仅为后端 `python3 -m compileall` 语法通过。

完整进度勾选与阻塞项见 `plan/产品规划.md` 第六、八节。

## 目录结构

```
plan/         规划文档（产品规划 / 技术方案 / 需求说明 / 数据库设计）
third-party/  第三方开源语音评测项目（Phase 2 压测选型，见该目录 README）
src/backend/  FastAPI + SQLAlchemy 2.0(async) + SQLite
src/frontend/ React 18 + TypeScript + Vite + Tailwind + Zustand
docker-compose.yml  frontend(nginx) + backend(uvicorn)
```

后端分层：`routers`（路由）→ `schemas`（校验）→ `services`（业务/AI/TTS/评测）→ `models`（ORM）。

## 快速开始

### 1. 准备环境

需要 **Python 3.12**（不是 3.11，也不是 3.14）与 Node.js 18+。

版本为什么卡死在 3.12：

- **3.14 不行**：`pydantic-core==2.27.2` / `uvloop` / `httptools` / `pyyaml` 都没有 cp314 wheel，只能源码编译（需 Rust），且 Phase 2 的 ESPnet 声明 `python_requires >=3.12,<3.14`，直接排除 3.14。
- **3.11 不行**：同上，被 ESPnet 的下界 `>=3.12` 拒绝。

Ubuntu 26.04 的 apt 源里只有 `python3.14`，装不到 3.12。推荐用 uv 在用户态拉一份独立 CPython（免 sudo）：

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh   # 装到 ~/.local，需重开 shell 生效
uv python install 3.12
```

### 2. 后端

```bash
cd src/backend
uv venv --python 3.12 .venv && source .venv/bin/activate   # 或任意 3.12 解释器
pip install -r requirements.txt
cp .env.example .env      # 必须填 LLM_API_KEY 和 JWT_SECRET_KEY
uvicorn app.main:app --reload --port 8000
```

启动时自动建表并播种管理员账号（`ADMIN_EMAIL` / `ADMIN_PASSWORD`，默认 `admin@speakenglish.local` / `Admin@123456`，**上线前务必改**）。

接口文档：http://localhost:8000/docs

### 3. 前端

```bash
cd src/frontend
npm install
npm run dev               # http://localhost:5173，/api 代理到 8000
```

### 4. 容器部署

```bash
cp src/backend/.env.example .env   # 根目录 .env 供 compose 读取密钥
docker compose up -d --build
```

## 关键设计约束

- **语音输入走浏览器**：Web Speech API 做 STT，不占服务器资源；不支持的浏览器降级为键盘输入。
- **语音输出双通道**：优先 edge-tts 生成 mp3，失败自动回退浏览器 `SpeechSynthesis`。
- **发音评测留桩**：`PRONUNCIATION_ENGINE=none` 时 `/api/pronunciation/score` 返回 503，`/api/pronunciation/content` 已可用（文本启发式）。引擎须先通过 2 核 4G 压测再填入。
- **低成本对话**：Qwen-Turbo，system prompt 限制回复 60 词内，历史只带最近 12 条，`max_tokens=200`。
- **SQLite 并发**：`sqlite+aiosqlite` + WAL + `busy_timeout=5000`；改表前需先接入 Alembic（当前用 `create_all`）。

## 安全提醒

- 密钥一律放 `.env`（已 gitignore），不要写进代码或文档。
- `private/` 目录已被 gitignore，但历史提交中的文件仍需单独处理：若里面曾存放真实密钥，请在服务商控制台**轮换**，仅删文件不影响已入库的历史副本。
