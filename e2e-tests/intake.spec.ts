import { test, expect } from '@playwright/test';

test.describe('Intake & Scoping', () => {
  test('scoping page loads for a request', async ({ page }) => {
    // Create a request via API
    const resp = await page.request.post('http://localhost:4001/api/governance-requests', {
      data: { title: 'Intake Test Request', description: 'E2E intake test' },
    });
    const gr = await resp.json();

    await page.goto(`/governance/${gr.requestId}/scoping`);
    // Should see scoping-related content or heading
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).not.toContainText('Application error');
  });

  test('common questionnaire page loads for a request', async ({ page }) => {
    const resp = await page.request.post('http://localhost:4001/api/governance-requests', {
      data: { title: 'Common Q Test', description: 'E2E test' },
    });
    const gr = await resp.json();

    await page.goto(`/governance/${gr.requestId}/common-questionnaire`);
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).not.toContainText('Application error');
  });

  test('reviews overview page loads for a request', async ({ page }) => {
    const resp = await page.request.post('http://localhost:4001/api/governance-requests', {
      data: { title: 'Reviews Overview Test', description: 'E2E test' },
    });
    const gr = await resp.json();

    await page.goto(`/governance/${gr.requestId}/reviews`);
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).not.toContainText('Application error');
  });
});
