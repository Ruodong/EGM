import { test, expect } from '@playwright/test';

test.describe('Home Page', () => {
  test('loads with portal title and stats', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Enterprise Governance Portal' })).toBeVisible();
    await expect(page.locator('text=Total Requests')).toBeVisible();
    await expect(page.locator('text=In Review')).toBeVisible();
    await expect(page.locator('text=Completed')).toBeVisible();
  });

  test('shows quick action cards', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Create New Request')).toBeVisible();
    await expect(page.locator('text=View All Requests')).toBeVisible();
    await expect(page.locator('text=Governance Dashboard')).toBeVisible();
  });

  test('navigate to governance requests page', async ({ page }) => {
    await page.goto('/');
    await page.click('text=View All Requests');
    await expect(page).toHaveURL('/requests');
    await expect(page.getByRole('heading', { name: 'Governance Requests' })).toBeVisible();
  });
});
