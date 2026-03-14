# Feature: Ant Design 前端框架迁移

**Status**: Implemented
**Date**: 2026-03-14
**Spec Version**: 1

## Impact Assessment

- **Impact Level**: L4 (全面影响 — 50+ 前端文件修改)
- **Risk**: High (全量 UI 重写, CSS-in-JS 与 Tailwind 共存, E2E 测试全部需更新)
- **Strategy**: 渐进式迁移, 分 5 个批次

## Summary

将 EGM 前端的视觉框架从 Tailwind CSS 自定义组件迁移到 Ant Design (antd) v5，统一 UI 组件库。包括按钮、表格、表单、导航、通知等所有 UI 组件的替换，以及图标库从 lucide-react 迁移到 @ant-design/icons。

## Affected Files

### Frontend — 基础设施
- `frontend/src/app/providers.tsx` — AntdRegistry + ConfigProvider 主题配置
- `frontend/src/styles/globals.css` — 移除 btn-primary/btn-default/btn-teal CSS 类

### Frontend — 共享组件
- `frontend/src/components/layout/Sidebar.tsx` — antd Layout.Sider + Menu
- `frontend/src/components/layout/Header.tsx` — antd Layout.Header + Dropdown
- `frontend/src/components/layout/PageLayout.tsx` — antd Layout
- `frontend/src/components/shared/DataTable.tsx` — antd Table (排序/分页)
- `frontend/src/components/shared/FilterBar.tsx` — antd Input.Search + Select + DatePicker
- `frontend/src/components/shared/MultiSelect.tsx` — antd Select mode="multiple"
- `frontend/src/components/ui/Toast.tsx` — antd message API

### Frontend — Lib
- `frontend/src/lib/constants.ts` — icon 类型改为 string, 移除 lucide 导入
- `frontend/src/lib/domain-icons.ts` — 27 个 lucide 图标迁移到 @ant-design/icons

### Frontend — 页面
- `frontend/src/app/page.tsx` — Home 页 antd Button + icons
- `frontend/src/app/(sidebar)/requests/page.tsx` — antd Title + Button + Tag
- `frontend/src/app/(sidebar)/domains/page.tsx` — antd Tag + Typography
- `frontend/src/app/(sidebar)/settings/*.tsx` — 全部 6 个设置页面
- `frontend/src/app/governance/[requestId]/page.tsx` — antd Button + icons
- `frontend/src/app/governance/[requestId]/scoping/page.tsx` — antd Button
- `frontend/src/app/governance/[requestId]/reviews/*.tsx` — antd Button + icons
- `frontend/src/app/governance/[requestId]/common-questionnaire/page.tsx` — antd Button
- `frontend/src/app/governance/[requestId]/summary/page.tsx` — antd Button
- `frontend/src/app/governance/create/page.tsx` — antd Button
- `frontend/src/app/governance/_components/DomainQuestionnaires.tsx` — antd icons

### E2E Tests
- `e2e-tests/governance-requests.spec.ts` — antd Select/Table 选择器适配
- `e2e-tests/role-switcher.spec.ts` — antd Dropdown/Menu 选择器适配

### Database
无数据库变更。

## API Endpoints

无 API 变更（纯前端迁移）。

## UI Behavior

- 所有按钮统一为 antd `<Button>` 组件
- 表格统一为 antd `<Table>` (内置排序指示器)
- 下拉筛选统一为 antd `<Select>` (portal 渲染)
- 侧边栏导航使用 antd `<Menu>` + `<Layout.Sider>`
- 通知使用 antd `message` API
- 图标统一为 @ant-design/icons

## Acceptance Criteria

- [x] AC-1: antd 5.x 安装并配置 AntdRegistry SSR 兼容
- [x] AC-2: 共享组件 (DataTable, FilterBar, MultiSelect, Toast, Sidebar, Header) 全部迁移到 antd
- [x] AC-3: 所有列表页面 (requests, domains, home) 使用 antd 组件
- [x] AC-4: 所有设置页面使用 antd 组件
- [x] AC-5: 所有 governance 子页面按钮迁移到 antd Button
- [x] AC-6: lucide-react 完全移除, 图标全部迁移到 @ant-design/icons
- [x] AC-7: E2E 测试适配 antd 组件选择器 (Select portal, Table sorter, Dropdown menu)
- [x] AC-8: 72/73 E2E 测试通过 (1 个 flaky 测试在隔离运行时通过)

## Test Coverage

### E2E Tests
- `e2e-tests/governance-requests.spec.ts` — antd Select dropdown, Table sorter, Button 交互
- `e2e-tests/role-switcher.spec.ts` — antd Dropdown menu item 选择, aside sidebar menu

## Test Map Entries

```
frontend/src/components/layout/ -> e2e-tests/role-switcher.spec.ts
frontend/src/components/shared/ -> e2e-tests/governance-requests.spec.ts
```

## Notes

- Tailwind CSS 保留用于布局间距 (flex, grid, padding, margin, gap)
- antd 用于所有 UI 组件 (Button, Table, Select, Menu, Layout 等)
- `.input-field` 和 `.select-field` CSS 类暂保留供 governance 表单页的原生 HTML 元素使用
- antd Select 的下拉列表通过 portal 渲染到 `document.body`, E2E 测试需要使用 `.ant-select-dropdown` 定位
- antd Sidebar 渲染为 `<aside>` 而非 `<nav>`, E2E 测试选择器已更新
