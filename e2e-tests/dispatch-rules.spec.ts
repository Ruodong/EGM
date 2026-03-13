import { test, expect } from '@playwright/test';

test.describe('Dispatch Rules', () => {
  test('page loads with rules table and matrix', async ({ page }) => {
    await page.goto('/settings/dispatch-rules');
    await expect(page.locator('h1:has-text("Dispatch Rules")')).toBeVisible();
    // Rules table should exist
    await expect(page.getByTestId('rules-table')).toBeVisible();
    // Matrix table should exist
    await expect(page.getByTestId('matrix-table')).toBeVisible();
  });

  test('seed rules are visible as level-1 rules', async ({ page }) => {
    await page.goto('/settings/dispatch-rules');
    const table = page.getByTestId('rules-table');
    await expect(table).toBeVisible();
    // All seed rules should be level-1 (parent-rule-*)
    await expect(page.getByTestId('parent-rule-INTERNAL')).toBeVisible();
    await expect(page.getByTestId('parent-rule-AI')).toBeVisible();
    await expect(page.getByTestId('parent-rule-PII')).toBeVisible();
    await expect(page.getByTestId('parent-rule-OPEN_SOURCE')).toBeVisible();
  });

  test('add rule form opens with parent dropdown and closes', async ({ page }) => {
    await page.goto('/settings/dispatch-rules');
    // Click Add Rule
    await page.getByTestId('add-rule-btn').click();
    await expect(page.getByTestId('rule-code-input')).toBeVisible();
    // Parent dropdown should be present
    await expect(page.getByTestId('parent-rule-select')).toBeVisible();
    // Cancel
    await page.locator('button:has-text("Cancel")').click();
    await expect(page.getByTestId('rule-code-input')).not.toBeVisible();
  });

  test('add child button opens form with parent pre-selected', async ({ page }) => {
    await page.goto('/settings/dispatch-rules');
    await expect(page.getByTestId('add-child-AI')).toBeVisible();
    await page.getByTestId('add-child-AI').click();
    // Form should open with parent pre-selected
    await expect(page.getByTestId('rule-code-input')).toBeVisible();
    const parentSelect = page.getByTestId('parent-rule-select');
    await expect(parentSelect).toHaveValue('AI');
    // Cancel
    await page.locator('button:has-text("Cancel")').click();
  });

  test('move up/down buttons are present', async ({ page }) => {
    await page.goto('/settings/dispatch-rules');
    // Move buttons should exist for seed rules
    await expect(page.getByTestId('move-up-INTERNAL')).toBeVisible();
    await expect(page.getByTestId('move-down-INTERNAL')).toBeVisible();
    await expect(page.getByTestId('move-up-OPEN_SOURCE')).toBeVisible();
    await expect(page.getByTestId('move-down-OPEN_SOURCE')).toBeVisible();
  });

  test('matrix shows in/out toggle buttons', async ({ page }) => {
    await page.goto('/settings/dispatch-rules');
    await expect(page.getByTestId('matrix-table')).toBeVisible();
    // AI → RAI should be 'in'
    const aiRaiBtn = page.getByTestId('matrix-AI-RAI');
    await expect(aiRaiBtn).toBeVisible();
    await expect(aiRaiBtn).toContainText('in');
    // AI → EA should be 'out'
    const aiEaBtn = page.getByTestId('matrix-AI-EA');
    await expect(aiEaBtn).toBeVisible();
    await expect(aiEaBtn).toContainText('out');
  });

  test('toggle matrix cell enables save button', async ({ page }) => {
    await page.goto('/settings/dispatch-rules');
    await expect(page.getByTestId('matrix-table')).toBeVisible();
    // Save button should be disabled initially
    const saveBtn = page.getByTestId('save-matrix-btn');
    await expect(saveBtn).toBeDisabled();
    // Click a cell to toggle
    await page.getByTestId('matrix-AI-EA').click();
    // Save button should now be enabled
    await expect(saveBtn).toBeEnabled();
  });

  test('settings hub has dispatch rules link', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('text=Dispatch Rules')).toBeVisible();
    // Click and navigate
    await page.locator('a:has-text("Dispatch Rules")').click();
    await expect(page.locator('h1:has-text("Dispatch Rules")')).toBeVisible();
  });

  // ── Operation tests (functional) ──────────────────────────

  test('create child rule under parent', async ({ page }) => {
    await page.goto('/settings/dispatch-rules');
    await expect(page.getByTestId('rules-table')).toBeVisible();

    // Click Add Child on INTERNAL
    await page.getByTestId('add-child-INTERNAL').click();
    await expect(page.getByTestId('rule-code-input')).toBeVisible();
    await expect(page.getByTestId('parent-rule-select')).toHaveValue('INTERNAL');

    // Fill and submit
    await page.getByTestId('rule-code-input').fill('E2E_CHILD_1');
    await page.getByTestId('rule-name-input').fill('E2E Child 1');
    await page.getByTestId('save-rule-btn').click();

    // Verify child appears
    await expect(page.getByTestId('child-rule-E2E_CHILD_1')).toBeVisible();
    // Parent should show child count (2 seed children + 1 E2E child = 3)
    await expect(page.getByTestId('parent-rule-INTERNAL')).toContainText('(3)');
  });

  test('create multiple children under same parent — regression', async ({ page }) => {
    await page.goto('/settings/dispatch-rules');
    await expect(page.getByTestId('rules-table')).toBeVisible();

    // Use OPEN_SOURCE as parent (avoids interfering with governance-requests tests
    // which expect AI/PII to have no children for direct YES/NO toggles)
    // Create first child
    await page.getByTestId('add-child-OPEN_SOURCE').click();
    await page.getByTestId('rule-code-input').fill('E2E_MULTI_A');
    await page.getByTestId('rule-name-input').fill('Multi A');
    await page.getByTestId('save-rule-btn').click();
    await expect(page.getByTestId('child-rule-E2E_MULTI_A')).toBeVisible();

    // Create second child
    await page.getByTestId('add-child-OPEN_SOURCE').click();
    await page.getByTestId('rule-code-input').fill('E2E_MULTI_B');
    await page.getByTestId('rule-name-input').fill('Multi B');
    await page.getByTestId('save-rule-btn').click();
    await expect(page.getByTestId('child-rule-E2E_MULTI_B')).toBeVisible();

    // Both children must coexist (the bug was second overwriting first)
    await expect(page.getByTestId('child-rule-E2E_MULTI_A')).toBeVisible();
    await expect(page.getByTestId('child-rule-E2E_MULTI_B')).toBeVisible();
    await expect(page.getByTestId('parent-rule-OPEN_SOURCE')).toContainText('(2)');
  });

  test('move rule reorders via API', async ({ page }) => {
    await page.goto('/settings/dispatch-rules');
    await expect(page.getByTestId('rules-table')).toBeVisible();

    // Get the current parent rule order
    const getParentOrder = async () => {
      const parentRows = await page.locator('[data-testid^="parent-rule-"]').all();
      const codes: string[] = [];
      for (const row of parentRows) {
        const testId = await row.getAttribute('data-testid');
        if (testId) codes.push(testId.replace('parent-rule-', ''));
      }
      return codes;
    };

    const before = await getParentOrder();
    expect(before.length).toBeGreaterThanOrEqual(4);

    // Find a rule that is NOT first (so move-up is enabled)
    // Use the second rule in the list
    const targetCode = before[1];
    const targetIdx = 1;

    // Click move-up on the second rule
    await page.getByTestId(`move-up-${targetCode}`).click();
    await page.waitForTimeout(500);

    const after = await getParentOrder();
    const newIdx = after.indexOf(targetCode);
    // The rule should have moved one position up (to index 0)
    expect(newIdx).toBe(targetIdx - 1);
  });

  test('toggle deactivates and hides rule', async ({ page }) => {
    await page.goto('/settings/dispatch-rules');
    await expect(page.getByTestId('rules-table')).toBeVisible();

    // Create a test child to toggle (use EXTERNAL to avoid interfering with
    // governance-requests tests that expect AI/PII without children)
    await page.getByTestId('add-child-EXTERNAL').click();
    await page.getByTestId('rule-code-input').fill('E2E_TOGGLE');
    await page.getByTestId('rule-name-input').fill('Toggle Test');
    await page.getByTestId('save-rule-btn').click();
    await expect(page.getByTestId('child-rule-E2E_TOGGLE')).toBeVisible();

    // Deactivate
    await page.getByTestId('deactivate-E2E_TOGGLE').click();

    // Should disappear from default view (inactive hidden)
    await expect(page.getByTestId('child-rule-E2E_TOGGLE')).not.toBeVisible();

    // Show inactive — should reappear
    await page.getByTestId('show-inactive-toggle').check();
    await expect(page.getByTestId('child-rule-E2E_TOGGLE')).toBeVisible();
  });

  test('seed child rules visible under INTERNAL', async ({ page }) => {
    await page.goto('/settings/dispatch-rules');
    await expect(page.getByTestId('rules-table')).toBeVisible();
    await expect(page.getByTestId('child-rule-INTERNAL_ONLY')).toBeVisible();
    await expect(page.getByTestId('child-rule-EXTERNAL_USING')).toBeVisible();
  });

  test('exclusion section visible in settings', async ({ page }) => {
    await page.goto('/settings/dispatch-rules');
    await expect(page.getByTestId('exclusions-section')).toBeVisible();
    // Save button should be disabled initially (no changes)
    await expect(page.getByTestId('save-exclusions-btn')).toBeDisabled();
  });

  test('seed exclusions are pre-checked', async ({ page }) => {
    await page.goto('/settings/dispatch-rules');
    await expect(page.getByTestId('exclusions-section')).toBeVisible();
    // INTERNAL_ONLY <-> EXTERNAL_USING should be checked
    const checkbox = page.getByTestId('excl-INTERNAL_ONLY-EXTERNAL_USING');
    await expect(checkbox).toBeChecked();
  });

  test('excluded rules disabled on create form', async ({ page }) => {
    await page.goto('/governance/create');
    // Select INTERNAL_ONLY
    await page.getByTestId('rule-toggle-INTERNAL_ONLY-yes').click();
    // EXTERNAL_USING YES button should now be disabled
    await expect(page.getByTestId('rule-toggle-EXTERNAL_USING-yes')).toBeDisabled();
  });

  test('add rule form has mandatory checkbox', async ({ page }) => {
    await page.goto('/settings/dispatch-rules');
    await page.getByTestId('add-rule-btn').click();
    await expect(page.getByTestId('rule-mandatory-toggle')).toBeVisible();
    // Should default to unchecked
    await expect(page.getByTestId('rule-mandatory-toggle')).not.toBeChecked();
    // Cancel
    await page.locator('button:has-text("Cancel")').click();
  });

  test('create mandatory rule shows badge in table', async ({ page }) => {
    await page.goto('/settings/dispatch-rules');
    await page.getByTestId('add-rule-btn').click();
    await page.getByTestId('rule-code-input').fill('E2E_MAND');
    await page.getByTestId('rule-name-input').fill('E2E Mandatory Rule');
    await page.getByTestId('rule-mandatory-toggle').check();
    await page.getByTestId('save-rule-btn').click();

    // Mandatory badge should appear in the table
    await expect(page.getByTestId('mandatory-label-E2E_MAND')).toBeVisible();
    await expect(page.getByTestId('mandatory-label-E2E_MAND')).toContainText('Mandatory');

    // Deactivate to not interfere with other tests
    await page.getByTestId('deactivate-E2E_MAND').click();
  });

  test('mandatory rule shows Required badge on create form', async ({ page }) => {
    // First make AI mandatory via API for this test
    const resp = await page.request.put('http://localhost:4001/api/dispatch-rules/AI', {
      headers: { 'X-Dev-Role': 'admin' },
      data: { isMandatory: true },
    });
    expect(resp.ok()).toBeTruthy();

    await page.goto('/governance/create');
    // AI should have a Required badge
    await expect(page.getByTestId('mandatory-badge-AI')).toBeVisible();
    await expect(page.getByTestId('mandatory-badge-AI')).toContainText('Required');

    // Restore AI to optional
    await page.request.put('http://localhost:4001/api/dispatch-rules/AI', {
      headers: { 'X-Dev-Role': 'admin' },
      data: { isMandatory: false },
    });
  });
});
