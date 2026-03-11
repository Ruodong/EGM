# EGM — Enterprise Governance Management

企业治理管理平台，管理治理请求的全生命周期：创建 → 范围界定 → 多领域评审 → 最终裁定。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 15 · React 19 · TypeScript · Tailwind CSS · TanStack Query |
| 后端 | Python · FastAPI · SQLAlchemy Async · Pydantic |
| 数据库 | PostgreSQL (asyncpg) |
| 认证 | Keycloak OIDC (生产) / DevAuth (开发) |
| 测试 | Pytest + httpx (API) · Playwright (E2E) |

## 快速开始

### 前置条件

- Node.js 18+
- Python 3.11+
- PostgreSQL 运行在 `localhost:5433`

### 初始化数据库

```bash
psql -p 5433 -U postgres -d egm_local -f scripts/schema.sql
psql -p 5433 -U postgres -d egm_local -f scripts/seed_data.sql
```

### 安装依赖

```bash
# 前端
npm install

# 后端
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 配置环境变量

创建 `backend/.env`：

```env
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5433/egm_local
DB_SCHEMA=egm
AUTH_DISABLED=true
```

### 启动开发服务

```bash
npm run dev          # 同时启动前端 (3001) + 后端 (4001)
npm run dev:backend  # 仅后端
npm run dev:frontend # 仅前端
```

访问 http://localhost:3001

## 项目结构

```
EGM/
├── backend/           Python FastAPI 后端服务
│   ├── app/
│   │   ├── main.py        应用入口，路由注册
│   │   ├── config.py      配置管理
│   │   ├── database.py    数据库连接
│   │   ├── auth/          认证与 RBAC 权限
│   │   ├── routers/       12 个 API 路由模块
│   │   └── utils/         分页、过滤工具
│   └── requirements.txt
├── frontend/          Next.js 前端应用
│   └── src/
│       ├── app/           App Router 页面
│       ├── components/    UI 组件
│       ├── lib/           API 客户端、认证
│       └── types/         TypeScript 类型
├── api-tests/         Pytest API 集成测试 (57 tests)
├── e2e-tests/         Playwright E2E 测试 (14 tests)
├── scripts/           数据库 DDL 和种子数据
└── docs/              架构文档
```

## API 概览

所有接口前缀为 `/api`，后端运行在 `http://localhost:4001`。

| 模块 | 路径 | 说明 |
|------|------|------|
| 健康检查 | `GET /api/health` | 服务状态 |
| 认证 | `/api/auth` | 用户信息、权限 |
| 治理请求 | `/api/governance-requests` | CRUD + 提交/裁定 |
| 问卷 | `/api/intake` | 模板管理 + 答案 + 评估 |
| 领域 | `/api/domains` | 领域注册表 |
| 评审 | `/api/domain-reviews` | 评审生命周期 |
| 分派 | `/api/dispatch` | 执行分派规则 |
| 分派规则 | `/api/dispatch-rules` | 规则 CRUD |
| 补件请求 | `/api/info-requests` | ISR 反馈环 |
| 仪表盘 | `/api/dashboard` | 统计数据 |
| 进度 | `/api/progress` | 请求级进度 |
| 审计日志 | `/api/audit-log` | 操作记录 |

API 文档：启动后端后访问 http://localhost:4001/docs (Swagger UI)

## 核心流程

```
创建请求 (Draft)
  → 填写范围界定问卷 (Scoping)
  → 填写通用问卷 (Common)
  → 提交 (Submitted)
  → 分派至领域评审 (In Review)
  → 各领域独立评审 (Pending → Assigned → In Progress → Complete)
  → [可选] 信息补充请求 (ISR 反馈环)
  → 最终裁定 (Completed: Approved / Rejected / ...)
```

## 测试

```bash
# API 集成测试 (需要后端运行)
cd backend && source venv/bin/activate
python -m pytest ../api-tests/ -v

# E2E 浏览器测试 (需要前后端都运行)
npx playwright test --reporter=list
```

## 文档

- [架构设计](docs/architecture.md) — 详细的系统架构、数据库设计、业务流程
