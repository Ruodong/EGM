/**
 * Playwright global teardown — clean test data after all E2E tests.
 */
async function globalTeardown() {
  const resp = await fetch('http://localhost:4001/api/dev/cleanup', { method: 'POST' });
  if (!resp.ok) {
    console.warn(`[global-teardown] Post-test cleanup failed: ${resp.status}`);
    return;
  }
  console.log('[global-teardown] Test data cleaned after E2E run');
}

export default globalTeardown;
