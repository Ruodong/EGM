import { test, expect } from '@playwright/test';

test.describe('User Authorization', () => {
  test('settings page shows User Authorization card', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText('User Authorization')).toBeVisible();
  });

  test('page loads with heading and assign button', async ({ page }) => {
    await page.goto('/settings/user-authorization');
    await expect(page.getByRole('heading', { name: 'User Authorization' })).toBeVisible();
    await expect(page.getByTestId('assign-role-btn')).toBeVisible();
  });

  test('assign role form appears on button click', async ({ page }) => {
    await page.goto('/settings/user-authorization');
    await page.getByTestId('assign-role-btn').click();
    await expect(page.getByTestId('employee-search')).toBeVisible();
    await expect(page.getByTestId('role-select')).toBeVisible();
  });

  test('employee search shows results', async ({ page }) => {
    await page.goto('/settings/user-authorization');
    await page.getByTestId('assign-role-btn').click();
    const searchInput = page.getByTestId('employee-search');
    await searchInput.fill('Milos');
    // Wait for debounced search to trigger and dropdown to appear
    await page.waitForTimeout(500);
    // Should see at least one result in the dropdown
    await expect(page.locator('button:has-text("Milos")').first()).toBeVisible({ timeout: 5000 });
  });

  test('roles table is visible', async ({ page }) => {
    await page.goto('/settings/user-authorization');
    await expect(page.getByTestId('roles-table')).toBeVisible();
  });

  test('role search filter is visible', async ({ page }) => {
    await page.goto('/settings/user-authorization');
    await expect(page.getByTestId('role-search')).toBeVisible();
  });
});
