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
    // Admin sees Settings and Domains in the antd sidebar (rendered as <aside>)
    await expect(page.locator('aside >> text=Settings')).toBeVisible();
    await expect(page.locator('aside >> text=Domains')).toBeVisible();
  });

  test('switch to requestor hides admin menus', async ({ page }) => {
    await page.goto('/');
    // Open user switcher dropdown (antd Dropdown renders items in a portal)
    await page.locator('text=Admin User').click();
    // Wait for dropdown to appear
    const dropdown = page.locator('.ant-dropdown').last();
    await expect(dropdown).toBeVisible({ timeout: 5000 });

    // Click a requestor user by name in the antd dropdown menu
    await dropdown.locator('.ant-dropdown-menu-item').filter({ hasText: USERS.requestor.name }).click();

    // Wait for identity switch (use .first() since name may appear in multiple elements)
    await expect(page.locator(`text=${USERS.requestor.name}`).first()).toBeVisible();
    await expect(page.locator(`text=(${USERS.requestor.label})`)).toBeVisible();

    // Requestor should NOT see Settings
    await expect(page.locator('aside >> text=Settings')).not.toBeVisible();
    // Requestor CAN see Domains (has domain_registry:read permission)
    await expect(page.locator('aside >> text=Domains')).toBeVisible();
    // And should see Governance Requests
    await expect(page.locator('aside >> text=Governance Requests')).toBeVisible();
  });

  test('switch to reviewer shows limited menus', async ({ page }) => {
    await page.goto('/');
    // Open user switcher dropdown
    await page.locator('text=Admin User').click();
    const dropdown = page.locator('.ant-dropdown').last();
    await expect(dropdown).toBeVisible({ timeout: 5000 });

    // Click the domain reviewer user by name
    await dropdown.locator('.ant-dropdown-menu-item').filter({ hasText: USERS.domainReviewer.name }).click();

    await expect(page.locator(`text=(${USERS.domainReviewer.label})`)).toBeVisible();
    await expect(page.locator('aside >> text=Reviews')).toBeVisible();
    // Domain Reviewer CAN see Settings (Questionnaire Templates + Dispatch Rules children are visible)
    await expect(page.locator('aside >> text=Settings')).toBeVisible();
    // But should NOT see Domains (requires domain_registry:read)
    await expect(page.locator('aside >> text=Domains')).not.toBeVisible();
  });

  test('switch back to admin restores full sidebar', async ({ page }) => {
    await page.goto('/');
    // Switch to requestor first
    await page.locator('text=Admin User').click();
    const dropdown1 = page.locator('.ant-dropdown').last();
    await expect(dropdown1).toBeVisible({ timeout: 5000 });
    await dropdown1.locator('.ant-dropdown-menu-item').filter({ hasText: USERS.requestor.name }).click();
    await expect(page.locator(`text=(${USERS.requestor.label})`)).toBeVisible();

    // Switch back to admin (RuoDong Yang)
    await page.locator(`text=${USERS.requestor.name}`).first().click();
    const dropdown2 = page.locator('.ant-dropdown').last();
    await expect(dropdown2).toBeVisible({ timeout: 5000 });
    await dropdown2.locator('.ant-dropdown-menu-item').filter({ hasText: USERS.admin.name }).click();
    await expect(page.locator(`text=(${USERS.admin.label})`)).toBeVisible();
    await expect(page.locator('aside >> text=Settings')).toBeVisible();
    await expect(page.locator('aside >> text=Domains')).toBeVisible();
  });
});
