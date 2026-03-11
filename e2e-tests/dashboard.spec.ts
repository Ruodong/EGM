import { test, expect } from '@playwright/test';

test.describe('Dashboard & Reports', () => {
  test('governance dashboard page loads', async ({ page }) => {
    await page.goto('/reports/governance-dashboard');
    await expect(page.getByRole('heading', { name: 'Governance Dashboard' })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Total Requests')).toBeVisible();
  });

  test('reviews list page loads', async ({ page }) => {
    await page.goto('/reviews');
    await expect(page.getByRole('heading', { name: 'All Domain Reviews' })).toBeVisible();
  });
});
