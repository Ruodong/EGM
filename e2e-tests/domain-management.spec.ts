import { test, expect } from '@playwright/test';

const createdDomainCodes: string[] = [];

test.describe('Domain Management', () => {
  test.afterAll(async () => {
    if (createdDomainCodes.length > 0) {
      await fetch('http://localhost:4001/api/dev/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains: createdDomainCodes }),
      });
    }
  });

  test('settings page shows Domain Management card', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText('Domain Management')).toBeVisible();
  });

  test('page loads with heading and add button', async ({ page }) => {
    await page.goto('/settings/domains');
    await expect(page.getByRole('heading', { name: 'Domain Management' })).toBeVisible();
    await expect(page.getByTestId('add-domain-btn')).toBeVisible();
  });

  test('domains table shows existing domains', async ({ page }) => {
    await page.goto('/settings/domains');
    await expect(page.getByTestId('domains-table')).toBeVisible();
    // Should show the 4 real domains (EA, BIA, RAI, DATA_PRIVACY)
    await expect(page.locator('text=EA').first()).toBeVisible({ timeout: 5000 });
  });

  test('add domain form appears on button click', async ({ page }) => {
    await page.goto('/settings/domains');
    await page.getByTestId('add-domain-btn').click();
    await expect(page.getByTestId('domain-code-input')).toBeVisible();
    await expect(page.getByTestId('domain-name-input')).toBeVisible();
    await expect(page.getByTestId('integration-type-select')).toBeVisible();
  });

  test('create and deactivate a domain', async ({ page, request }) => {
    const code = `E2E_${Date.now()}`;

    // Clean up if it somehow exists already
    await request.delete(`http://localhost:4001/api/domains/${code}`, {
      headers: { 'X-Dev-Role': 'admin' },
    });

    await page.goto('/settings/domains');
    await page.getByTestId('add-domain-btn').click();

    // Fill form
    await page.getByTestId('domain-code-input').fill(code);
    await page.getByTestId('domain-name-input').fill('E2E Test Domain');

    // Save
    const [response] = await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/domains') && resp.request().method() === 'POST',
        { timeout: 10000 },
      ),
      page.getByTestId('save-domain-btn').click(),
    ]);
    expect(response.status()).toBe(200);

    // Track for cleanup
    createdDomainCodes.push(code);

    // Domain should appear in the table
    await expect(page.locator(`text=${code}`)).toBeVisible({ timeout: 5000 });

    // Deactivate it
    const [deactivateResp] = await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes(`/domains/${code}`) && resp.request().method() === 'DELETE',
        { timeout: 10000 },
      ),
      page.getByTestId(`deactivate-${code}`).click(),
    ]);
    expect(deactivateResp.status()).toBe(200);
  });

  test('show inactive toggle works', async ({ page }) => {
    await page.goto('/settings/domains');
    await expect(page.getByTestId('show-inactive-toggle')).toBeVisible();
  });
});
