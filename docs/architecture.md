# EGM 架构设计文档

## 1. 系统概述

EGM (Enterprise Governance Management) 是一个企业治理管理平台，用于管理治理请求的全生命周期——从创建、范围界定 (Scoping)、多领域评审 (Domain Review)、到最终裁定 (Verdict)。

系统采用前后端分离架构：

| 层级 | 技术栈 | 端口 |
|------|--------|------|
| 前端 | Next.js 15 + React 19 + TypeScript | 3001 |
| 后端 | FastAPI + SQLAlchemy Async | 4001 |
| 数据库 | PostgreSQL (asyncpg) | 5433 |
| 认证 | Keycloak (生产) / DevAuth (开发) | — |

---

## 2. 项目目录结构

```
EGM/
├── backend/                 # FastAPI 后端服务
│   ├── app/
│   │   ├── main.py          # 应用入口，路由注册
│   │   ├── config.py        # 配置 (Pydantic Settings)
│   │   ├── database.py      # 数据库连接池
│   │   ├── auth/            # 认证与权限
│   │   │   ├── models.py    # AuthUser, Role 枚举
│   │   │   ├── providers.py # DevAuth / Keycloak 双模式
│   │   │   ├── rbac.py      # 角色-资源-操作 权限矩阵
│   │   │   ├── middleware.py # 请求级身份注入
│   │   │   └── deps.py      # get_current_user, require_permission
│   │   ├── routers/         # 13 个 API 路由模块
│   │   └── utils/           # 分页、过滤工具
│   ├── requirements.txt
│   └── .env
├── frontend/                # Next.js 前端
│   └── src/
│       ├── app/             # App Router 页面
│       │   ├── (sidebar)/   # 带侧边栏的布局组
│       │   └── governance/  # 请求详情工作流
│       ├── components/      # UI 组件
│       ├── lib/             # API 客户端、认证、常量
│       └── types/           # TypeScript 类型定义
├── api-tests/               # Pytest API 集成测试 (90 tests)
├── e2e-tests/               # Playwright E2E 浏览器测试 (28 tests)
├── scripts/
│   ├── schema.sql           # 数据库 DDL
│   └── seed_data.sql        # 初始数据
├── playwright.config.ts
└── package.json             # Monorepo 根配置
```

---

## 3. 后端架构

### 3.1 应用入口 (`main.py`)

FastAPI 实例注册两层中间件（顺序敏感）和 13 个路由模块：

```
CORSMiddleware (allow_origins=["*"])
    ↓
AuthMiddleware (注入 request.state.user)
    ↓
13 Routers (prefix=/api)
```

### 3.2 路由模块

| 路由 | 前缀 | 功能 |
|------|------|------|
| `health` | `/api/health` | 健康检查 |
| `auth` | `/api/auth` | 用户信息、权限列表、Token 交换 |
| `governance_requests` | `/api/governance-requests` | 治理请求 CRUD + 状态流转 |
| `projects` | `/api/projects` | EAM 项目列表查询 (用于请求关联) |
| `intake` | `/api/intake` | 问卷模板管理 + 答案收集 + 范围评估 |
| `domain_registry` | `/api/domains` | 领域注册表 CRUD |
| `domain_reviews` | `/api/domain-reviews` | 领域评审生命周期 |
| `dispatcher` | `/api/dispatch` | 执行分派规则，创建评审记录 |
| `dispatch_rules` | `/api/dispatch-rules` | 分派规则 CRUD (管理员) |
| `info_requests` | `/api/info-requests` | 信息补充请求 (ISR 反馈环) |
| `dashboard` | `/api/dashboard` | 统计仪表盘 |
| `progress` | `/api/progress` | 请求级进度聚合 |
| `audit_log` | `/api/audit-log` | 审计日志查询 |

### 3.3 数据库层

- **引擎**: SQLAlchemy `create_async_engine` + `asyncpg`
- **连接池**: `pool_size=10`, `max_overflow=20`
- **Schema 隔离**: 通过 `server_settings.search_path = "egm"` 设置
- **会话管理**: `AsyncSessionLocal` 工厂 + `get_db()` 依赖注入
- **SQL 风格**: 使用 `text()` 手写 SQL（非 ORM 模型），保持灵活性

### 3.4 认证与授权 (RBAC)

#### 双模式认证

| 模式 | 条件 | 行为 |
|------|------|------|
| 开发模式 | `AUTH_DISABLED=true` | 返回固定 `dev_admin` 用户，admin 角色 |
| 生产模式 | `AUTH_DISABLED=false` | Keycloak OIDC JWT (RS256) 验证 |

#### 角色体系

```
admin              → 全部权限 (*:*)
governance_lead    → 请求管理 + 评审分配 + 报表
domain_reviewer    → 领域评审 + 评审操作 + ISR
requestor          → 创建/管理自己的请求 + 填写问卷
viewer             → 只读访问
```

#### 权限检查链

```
HTTP Request
  → AuthMiddleware 解析 Token / DevAuth
  → request.state.user = AuthUser(id, name, email, role, permissions)
  → require_permission("resource", "scope") 路由依赖
  → check_permission(role, resource, scope) RBAC 矩阵校验
```

---

## 4. 前端架构

### 4.1 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Next.js 15.3 (App Router + Turbopack) |
| UI 库 | React 19 |
| 状态管理 | TanStack Query v5 (服务端缓存 + 数据获取) |
| 样式 | Tailwind CSS 3.4 + 自定义主题色 |
| 图标 | Lucide React |
| 语言 | TypeScript 5.7 |

### 4.2 页面路由结构

```
/                                    → 首页仪表盘 (快捷入口 + 统计卡片)
/(sidebar)/
  ├── requests                       → 治理请求列表 (筛选/搜索/分页)
  ├── reviews                        → 所有领域评审列表
  ├── domains                        → 领域注册表
  ├── actions                        → 评审操作
  ├── reports/
  │   ├── governance-dashboard       → 治理仪表盘 (状态/裁定/领域分布)
  │   ├── domain-metrics             → 领域指标
  │   └── lead-time                  → 周期分析
  ├── settings/
  │   ├── scoping-templates          → 范围界定问卷模板
  │   ├── questionnaire-templates    → 通用问卷模板
  │   ├── dispatch-rules             → 分派规则
  │   └── audit-log                  → 审计日志
  └── help                           → 帮助

/governance/
  ├── create                         → 创建新请求
  └── [requestId]/
      ├── (overview)                 → 请求概览
      ├── scoping                    → 范围界定问卷
      ├── common-questionnaire       → 通用问卷
      ├── reviews/[domainCode]       → 领域评审详情
      └── summary                    → 汇总
```

### 4.3 API 客户端

统一的 `api` 对象封装 `fetch`，自动附加 `Authorization` 头：

```typescript
// frontend/src/lib/api.ts
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

api.get<T>(endpoint, params?)   // GET + query string
api.post<T>(endpoint, data)     // POST + JSON body
api.put<T>(endpoint, data)      // PUT + JSON body
api.delete<T>(endpoint)         // DELETE
```

Next.js `rewrites` 将 `/api/*` 代理到后端 `http://localhost:4001/api/*`。

### 4.4 前端认证

```
AuthProvider (auth-context.tsx)
  ├── 开发模式: 直接调 /api/auth/me → 获取 dev_admin 用户
  └── 生产模式: Keycloak OIDC 登录流 → 后端交换 Token
      → Token 存 localStorage → 请求头自动附加 Bearer Token
```

### 4.5 设计主题

```
主色调: egm-teal (#13C2C2) — 品牌色、主按钮
辅助色: primary-blue (#4096FF) — 链接、选中态

状态色系:
  Draft        → #8C8C8C (灰)
  In Review    → #FA8C16 (橙)
  Info Requested → #EB2F96 (粉)
  Completed    → #52C41A (绿)
  Pending      → #D9D9D9 (浅灰)
```

---

## 5. 数据库设计

### 5.1 ER 关系图

```
governance_request (1) ──┬── (N) intake_response
                         ├── (N) domain_review ──┬── (N) domain_questionnaire_response
                         │                       ├── (N) review_action
                         │                       ├── (N) review_comment
                         │                       └── (N) info_supplement_request
                         ├── (N) shared_artifact
                         ├── (N) intake_change_log
                         └── (N) audit_log

intake_template (1) ──── (N) intake_response
domain_registry ──────── domain_code 关联 domain_review
dispatch_rule ─────────── domain_code 关联 domain_registry
```

### 5.2 核心表

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| `governance_request` | 治理请求主表 | `id` (UUID), `request_id` (GR-XXXXXX), `status`, `overall_verdict` |
| `intake_template` | 问卷题目定义 | `section_type` (scoping/common), `answer_type`, `triggers_domain[]` |
| `intake_response` | 问卷答案 | `request_id` (FK), `template_id` (FK), `answer` (JSONB) |
| `domain_registry` | 领域定义 | `domain_code` (UNIQUE), `integration_type` |
| `dispatch_rule` | 分派规则 | `domain_code`, `condition_type`, `condition_field/operator/value` |
| `domain_review` | 领域评审 | `request_id` (FK), `domain_code`, `status`, `reviewer`, `outcome` |
| `info_supplement_request` | 信息补充请求 | `request_id` (FK), `domain_review_id` (FK), `status` |
| `intake_change_log` | 问卷变更日志 | `old_answer`, `new_answer`, `change_reason` (FK → ISR) |
| `audit_log` | 审计日志 | `entity_type`, `entity_id`, `action`, `performed_by` |

### 5.3 ID 生成策略

治理请求使用 PostgreSQL 序列生成 `GR-XXXXXX` 格式的业务 ID：

```sql
CREATE SEQUENCE IF NOT EXISTS gr_seq START 1;
-- 使用: SELECT nextval('gr_seq') → 格式化为 GR-000001
```

优势：原子性、无竞态条件、支持并发创建。

---

## 6. 核心业务流程

### 6.1 治理请求生命周期

```
                      ┌─────────────────────────────────────────────┐
                      │            Governance Request                │
                      │              Lifecycle                       │
                      └─────────────────────────────────────────────┘

  ┌─────────┐    submit     ┌───────────┐   dispatch    ┌───────────┐
  │  Draft   │ ──────────→  │ Submitted  │ ──────────→  │ In Review  │
  └─────────┘               └───────────┘               └─────┬─────┘
                                                              │
                                                    ┌─────────┴─────────┐
                                                    │                   │
                                              ISR created          All reviews
                                                    │              complete
                                                    ↓                   │
                                            ┌──────────────┐           │
                                            │Info Requested │           │
                                            └──────┬───────┘           │
                                                   │ ISR resolved      │
                                                   ↓                   ↓
                                              ┌───────────┐    ┌───────────┐
                                              │ In Review  │    │ Completed  │
                                              └───────────┘    └───────────┘
                                                                     │
                                                               verdict recorded
                                                          (Approved / Rejected / ...)
```

### 6.2 范围界定与分派流程

```
1. 请求者填写 Scoping 问卷
   └─ POST /intake/responses (section_type=scoping 的题目)

2. 评估触发领域
   └─ POST /intake/evaluate/{requestId}
   └─ 根据答案 + 模板的 triggers_domain 字段确定涉及的领域

3. 执行分派
   └─ POST /dispatch/execute/{requestId}
   └─ 根据评估结果 (或显式 domainCodes) 创建 domain_review 记录
   └─ 请求状态 → "In Review"
```

### 6.3 领域评审生命周期

```
  Pending → Assigned → In Progress → Review Complete
                                  ↗
  Pending → Waived (跳过评审)
```

每个评审可以独立推进，最终结果 (outcome)：
- `Approved` — 通过
- `Approved with Conditions` — 有条件通过
- `Rejected` — 拒绝
- `Deferred` — 延期

### 6.4 ISR 信息补充反馈环

```
领域评审者发现需要补充信息
  └─ POST /info-requests (创建 ISR)
  └─ 治理请求状态 → "Info Requested"
  └─ 请求者补充/修改问卷答案
  └─ 变更记录到 intake_change_log
  └─ PUT /info-requests/{id}/resolve (关闭 ISR)
  └─ 治理请求状态恢复 → "In Review"
```

### 6.5 最终裁定守卫

`PUT /governance-requests/{id}/verdict` 的前置条件：
- 所有 domain_review 状态为 Complete 或 Waived
- 无未关闭的 ISR (Open/Acknowledged)
- 裁定值必须在允许范围内

---

## 7. API 设计规范

### 7.1 URL 约定

- 资源使用复数：`/governance-requests`, `/domain-reviews`
- 子操作使用动词后缀：`/{id}/submit`, `/{id}/verdict`
- 查询参数用于过滤/分页：`?status=Draft&page=1&pageSize=20`

### 7.2 通用响应格式

分页响应：
```json
{
  "data": [...],
  "total": 100,
  "page": 1,
  "pageSize": 20,
  "totalPages": 5
}
```

### 7.3 ID 解析

支持 UUID 和业务 ID 双模式：
```sql
WHERE request_id = :id OR id::text = :id
```
前端使用 `GR-000001` 格式的业务 ID 构建 URL，后端自动解析。

---

## 8. 测试策略

### 8.1 API 集成测试 (pytest + httpx)

```
api-tests/
├── conftest.py                    # 共享 fixtures
├── test_health.py                 # 1 test
├── test_auth.py                   # 5 tests
├── test_rbac.py                   # 13 tests
├── test_governance_requests.py    # 22 tests
├── test_projects.py               # 5 tests
├── test_intake.py                 # 11 tests
├── test_domains.py                # 5 tests
├── test_domain_reviews.py         # 9 tests
├── test_dispatch.py               # 8 tests
├── test_info_requests.py          # 6 tests
└── test_dashboard.py              # 5 tests
                            Total: 90 tests
```

使用同步 `httpx.Client` 直连后端 `http://localhost:4001/api`，覆盖全部 13 个路由的核心功能。

### 8.2 E2E 浏览器测试 (Playwright)

```
e2e-tests/
├── home.spec.ts                   # 3 tests — 首页加载、导航
├── governance-requests.spec.ts    # 8 tests — 列表、创建、详情、筛选、排序、导出
├── intake.spec.ts                 # 3 tests — 范围界定 + 问卷页面
├── role-switcher.spec.ts          # 4 tests — 角色切换 UI
├── dashboard.spec.ts              # 2 tests — 仪表盘、评审列表
├── settings.spec.ts               # 5 tests — 设置页面
└── reports.spec.ts                # 3 tests — 报表页面
                            Total: 28 tests
```

使用 Chromium 浏览器测试完整用户流程。

---

## 9. 部署与运行

### 9.1 开发环境

```bash
# 前置条件: PostgreSQL 运行在 localhost:5433
# 初始化数据库
psql -p 5433 -U postgres -d egm_local -f scripts/schema.sql
psql -p 5433 -U postgres -d egm_local -f scripts/seed_data.sql

# 启动开发服务
npm run dev          # 同时启动前端 + 后端
npm run dev:backend  # 仅后端 (localhost:4001)
npm run dev:frontend # 仅前端 (localhost:3001)

# 运行测试
cd backend && source venv/bin/activate && python -m pytest ../api-tests/ -v
npx playwright test
```

### 9.2 环境变量

**后端** (`backend/.env`):
```env
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5433/egm_local
DB_SCHEMA=egm
AUTH_DISABLED=true        # 开发模式
KEYCLOAK_SERVER_URL=      # 生产模式需配置
KEYCLOAK_REALM=myapp
KEYCLOAK_CLIENT_ID=
KEYCLOAK_CLIENT_SECRET=
```

**前端**:
- `NEXT_PUBLIC_API_URL` — API 基础路径 (默认 `/api`，通过 Next.js rewrites 代理)
- `NEXT_PUBLIC_KEYCLOAK_URL` — Keycloak 服务地址 (生产模式)

---

## 10. 架构决策记录

| 决策 | 理由 |
|------|------|
| 手写 SQL + `text()` 而非 ORM 模型 | 复杂查询场景更灵活，避免 ORM 映射开销 |
| PostgreSQL 序列生成业务 ID | 原子性保证无竞态，比 SELECT MAX + 1 安全 |
| JSONB 存储问卷答案 | 支持多种答案类型 (文本、数组、布尔) |
| Next.js rewrites 代理 API | 避免 CORS 问题，前端无需知道后端地址 |
| TanStack Query 管理服务端状态 | 自动缓存、失效、重试，无需额外客户端状态管理库 |
| RBAC 矩阵而非 ACL | 角色数量有限，矩阵方式简单直观 |
| 双模式认证 (Dev/Keycloak) | 开发效率与生产安全的平衡 |
