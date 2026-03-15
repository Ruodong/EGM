# Frontend — Next.js 15

- Port 3001, TypeScript + Tailwind CSS + Ant Design 5
- API client: `@/lib/api` (wraps fetch, auto-adds auth headers)
- Status colors/hex: `@/lib/constants.ts`
- Layout: `(sidebar)` route group for pages with sidebar, `governance/` for detail pages
- Tests: `npx playwright test e2e-tests/<spec>.spec.ts --reporter=list`
