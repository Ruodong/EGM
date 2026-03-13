/**
 * Playwright global teardown — no-op.
 * Individual tests handle their own cleanup via POST /api/dev/delete.
 */
async function globalTeardown() {
  console.log('[global-teardown] Done (per-test cleanup active)');
}

export default globalTeardown;
