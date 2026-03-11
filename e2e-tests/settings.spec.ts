import { test, expect } from '@playwright/test';

test.describe('Settings Pages', () => {
  test('navigate to settings overview', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('text=Settings')).toBeVisible();
  });

  test('domains page loads', async ({ page }) => {
    await page.goto('/domains');
    await expect(page.locator('text=Domain')).toBeVisible();
  });

  test('scoping templates page loads', async ({ page }) => {
    await page.goto('/settings/scoping-templates');
    await page.waitForTimeout(500);
    // Page should render without errors
    await expect(page.locator('h1, h2, [class*="title"]').first()).toBeVisible();
  });

  test('dispatch rules page loads', async ({ page }) => {
    await page.goto('/settings/dispatch-rules');
    await page.waitForTimeout(500);
    await expect(page.locator('h1, h2, [class*="title"]').first()).toBeVisible();
  });

  test('audit log page loads', async ({ page }) => {
    await page.goto('/settings/audit-log');
    await page.waitForTimeout(500);
    await expect(page.locator('h1, h2, [class*="title"]').first()).toBeVisible();
  });
});
