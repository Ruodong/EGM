import { test, expect } from '@playwright/test';

test.describe('Role Switcher', () => {
  test('default role is admin with full sidebar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Admin User')).toBeVisible();
    await expect(page.locator('text=(Admin)')).toBeVisible();
    // Admin sees Settings and Domains
    await expect(page.locator('nav >> text=Settings')).toBeVisible();
    await expect(page.locator('nav >> text=Domains')).toBeVisible();
  });

  test('switch to requestor hides admin menus', async ({ page }) => {
    await page.goto('/');
    // Open role dropdown
    await page.locator('text=Admin User').click();
    await expect(page.locator('text=Switch Role')).toBeVisible();

    // Click Requestor
    await page.getByRole('button', { name: 'Requestor' }).click();

    // Wait for role switch
    await expect(page.locator('text=(Requestor)')).toBeVisible();

    // Requestor should NOT see Settings or Domains
    await expect(page.locator('nav >> text=Settings')).not.toBeVisible();
    await expect(page.locator('nav >> text=Domains')).not.toBeVisible();
    // But should see Governance Requests
    await expect(page.locator('nav >> text=Governance Requests')).toBeVisible();
  });

  test('switch to reviewer shows limited menus', async ({ page }) => {
    await page.goto('/');
    // Open role dropdown
    await page.locator('text=Admin User').click();
    await page.getByRole('button', { name: 'Reviewer' }).click();

    await expect(page.locator('text=(Reviewer)')).toBeVisible();
    await expect(page.locator('nav >> text=Reviews')).toBeVisible();
    await expect(page.locator('nav >> text=Settings')).not.toBeVisible();
    await expect(page.locator('nav >> text=Domains')).not.toBeVisible();
  });

  test('switch back to admin restores full sidebar', async ({ page }) => {
    await page.goto('/');
    // Switch to requestor first
    await page.locator('text=Admin User').click();
    await page.getByRole('button', { name: 'Requestor' }).click();
    await expect(page.locator('text=(Requestor)')).toBeVisible();

    // Switch back to admin
    await page.locator('text=Requestor').first().click();
    await page.getByRole('button', { name: 'Admin' }).click();
    await expect(page.locator('text=(Admin)')).toBeVisible();
    await expect(page.locator('nav >> text=Settings')).toBeVisible();
    await expect(page.locator('nav >> text=Domains')).toBeVisible();
  });
});
