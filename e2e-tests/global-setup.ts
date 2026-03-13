/**
 * Playwright global setup — clean test data before all E2E tests.
 */
async function globalSetup() {
  const resp = await fetch('http://localhost:4001/api/dev/cleanup', { method: 'POST' });
  if (!resp.ok) {
    throw new Error(`Pre-test cleanup failed: ${resp.status} ${await resp.text()}`);
  }
  console.log('[global-setup] Test data cleaned before E2E run');
}

export default globalSetup;
