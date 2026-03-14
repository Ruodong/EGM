import { test, expect } from '@playwright/test';

test.describe('Reports Pages', () => {
  test('domain metrics page loads', async ({ page }) => {
    await page.goto('/reports/domain-metrics');
    await page.waitForTimeout(1000);
    await expect(page.getByRole('heading', { name: 'Domain Metrics' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Application error');
  });

  test('lead time page loads with stats', async ({ page }) => {
    await page.goto('/reports/lead-time');
    await expect(page.getByRole('heading', { name: 'Lead Time Analysis' })).toBeVisible();
    await expect(page.locator('text=Total Requests')).toBeVisible();
  });

  test('actions page loads', async ({ page }) => {
    await page.goto('/actions');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).not.toContainText('Application error');
  });
});
