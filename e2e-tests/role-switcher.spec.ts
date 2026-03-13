import { test, expect } from '@playwright/test';

// Real users from the user_role + employee_info tables (dev seed data)
const USERS = {
  admin:           { name: 'RuoDong Yang',     label: 'Admin',     itcode: 'yangrd'     },
  govLead:         { name: 'Matt Swafford',     label: 'Gov Lead',  itcode: 'cswafford'  },
  domainReviewer:  { name: 'Cherry YL2 Luo',   label: 'Reviewer',  itcode: 'luoyl2'     },
  requestor:       { name: 'Ruijie RJ15 Wang',  label: 'Requestor', itcode: 'wangrj15'   },
};

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
    // Open user switcher dropdown
    await page.locator('text=Admin User').click();
    await expect(page.locator('text=Switch User')).toBeVisible();

    // Click a requestor user by name
    await page.getByRole('button', { name: new RegExp(USERS.requestor.name) }).click();

    // Wait for identity switch
    await expect(page.locator(`text=${USERS.requestor.name}`)).toBeVisible();
    await expect(page.locator(`text=(${USERS.requestor.label})`)).toBeVisible();

    // Requestor should NOT see Settings or Domains
    await expect(page.locator('nav >> text=Settings')).not.toBeVisible();
    await expect(page.locator('nav >> text=Domains')).not.toBeVisible();
    // But should see Governance Requests
    await expect(page.locator('nav >> text=Governance Requests')).toBeVisible();
  });

  test('switch to reviewer shows limited menus', async ({ page }) => {
    await page.goto('/');
    // Open user switcher dropdown
    await page.locator('text=Admin User').click();
    await expect(page.locator('text=Switch User')).toBeVisible();

    // Click the domain reviewer user by name
    await page.getByRole('button', { name: new RegExp(USERS.domainReviewer.name) }).click();

    await expect(page.locator(`text=(${USERS.domainReviewer.label})`)).toBeVisible();
    await expect(page.locator('nav >> text=Reviews')).toBeVisible();
    // Domain Reviewer CAN see Settings (Questionnaire Templates + Dispatch Rules children are visible)
    await expect(page.locator('nav >> text=Settings')).toBeVisible();
    // But should NOT see Domains (requires domain_registry:read)
    await expect(page.locator('nav >> text=Domains')).not.toBeVisible();
  });

  test('switch back to admin restores full sidebar', async ({ page }) => {
    await page.goto('/');
    // Switch to requestor first
    await page.locator('text=Admin User').click();
    await page.getByRole('button', { name: new RegExp(USERS.requestor.name) }).click();
    await expect(page.locator(`text=(${USERS.requestor.label})`)).toBeVisible();

    // Switch back to admin (RuoDong Yang)
    await page.locator(`text=${USERS.requestor.name}`).first().click();
    await page.getByRole('button', { name: new RegExp(USERS.admin.name) }).click();
    await expect(page.locator(`text=(${USERS.admin.label})`)).toBeVisible();
    await expect(page.locator('nav >> text=Settings')).toBeVisible();
    await expect(page.locator('nav >> text=Domains')).toBeVisible();
  });
});
