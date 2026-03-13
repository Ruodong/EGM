/**
 * Playwright global setup — no-op.
 * Individual tests handle their own cleanup via POST /api/dev/delete.
 */
async function globalSetup() {
  console.log('[global-setup] Ready (per-test cleanup active)');
}

export default globalSetup;
