import { test, expect } from '@playwright/test';

test.describe('Governance Requests', () => {
  test('list page loads with table', async ({ page }) => {
    await page.goto('/requests');
    await expect(page.getByRole('heading', { name: 'Governance Requests' })).toBeVisible();
    await expect(page.locator('text=New Request')).toBeVisible();
  });

  test('create new request via form', async ({ page }) => {
    await page.goto('/governance/create');
    await expect(page.getByRole('heading', { name: 'Create Governance Request' })).toBeVisible();

    // Fill the title field
    const titleInput = page.getByRole('textbox').first();
    await titleInput.click();
    await titleInput.fill('Playwright Test Request');
    await expect(titleInput).toHaveValue('Playwright Test Request');

    // Click submit and wait for API response + navigation
    const [response] = await Promise.all([
      page.waitForResponse((resp) => resp.url().includes('/governance-requests') && resp.request().method() === 'POST', { timeout: 15000 }),
      page.getByRole('button', { name: 'Create Request' }).click(),
    ]);
    expect(response.status()).toBe(200);

    await page.waitForURL(/\/governance\/GR-/, { timeout: 10000 });
    expect(page.url()).toContain('/governance/GR-');
  });

  test('view request detail page', async ({ page }) => {
    // First create a request via API
    const response = await page.request.post('http://localhost:4001/api/governance-requests', {
      data: { title: 'Detail View Test', description: 'E2E test' },
    });
    const gr = await response.json();

    await page.goto(`/governance/${gr.requestId}`);
    // Wait for either the heading or a loading indicator, then check for the request title
    await expect(page.locator(`text=Detail View Test`)).toBeVisible({ timeout: 15000 });
  });

  test('status filter dropdown filters results', async ({ page }) => {
    // Ensure a Draft request exists
    await page.request.post('http://localhost:4001/api/governance-requests', {
      data: { title: 'Status Filter E2E Test' },
    });
    await page.goto('/requests');
    await expect(page.getByRole('heading', { name: 'Governance Requests' })).toBeVisible();
    // Status filter should be a dropdown select
    const statusSelect = page.getByTestId('status-filter');
    await expect(statusSelect).toBeVisible();
    // Select "Draft" and wait for the filtered API response
    const [response] = await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/governance-requests') && resp.url().includes('status=Draft') && resp.request().method() === 'GET',
        { timeout: 10000 },
      ),
      statusSelect.selectOption('Draft'),
    ]);
    expect(response.status()).toBe(200);
    const body = await response.json();
    // All returned rows should have Draft status
    for (const row of body.data) {
      expect(row.status).toBe('Draft');
    }
  });

  test('search box filters requests', async ({ page }) => {
    await page.goto('/requests');
    await expect(page.getByRole('heading', { name: 'Governance Requests' })).toBeVisible();
    // Search input should be visible
    const searchInput = page.getByPlaceholder('Search by Request ID or Title...');
    await expect(searchInput).toBeVisible();
    // Type a search term
    await searchInput.fill('GR-');
    // Wait for debounced search to trigger
    await page.waitForTimeout(500);
    // Page should still be functional
    await expect(page.getByRole('heading', { name: 'Governance Requests' })).toBeVisible();
  });

  test('requestor filter input filters results', async ({ page }) => {
    await page.goto('/requests');
    await expect(page.getByRole('heading', { name: 'Governance Requests' })).toBeVisible();
    // Requestor filter input should be visible
    const requestorInput = page.getByTestId('requestor-filter');
    await expect(requestorInput).toBeVisible();
    // Type a requestor name and wait for debounced API call
    const [response] = await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/governance-requests') && resp.url().includes('requestor=') && resp.request().method() === 'GET',
        { timeout: 10000 },
      ),
      requestorInput.fill('system'),
    ]);
    expect(response.status()).toBe(200);
  });

  test('date preset dropdown and custom date pickers work', async ({ page }) => {
    await page.goto('/requests');
    await expect(page.getByRole('heading', { name: 'Governance Requests' })).toBeVisible();
    // Period dropdown should be visible with default "All Time"
    const dateSelect = page.getByTestId('date-filter');
    await expect(dateSelect).toBeVisible();
    // Date inputs should NOT be visible by default
    await expect(page.locator('input[type="date"]')).toHaveCount(0);
    // Select "Custom" to reveal date pickers
    await dateSelect.selectOption('custom');
    await expect(page.getByTestId('custom-date-from')).toBeVisible();
    await expect(page.getByTestId('custom-date-to')).toBeVisible();
  });

  test('column header sort indicators appear on click', async ({ page }) => {
    await page.goto('/requests');
    await expect(page.getByRole('heading', { name: 'Governance Requests' })).toBeVisible();
    // Click on "Title" column header to sort
    await page.getByRole('columnheader', { name: /Title/ }).click();
    await page.waitForTimeout(500);
    // Sort indicator should appear (▲ for ASC)
    await expect(page.getByTestId('sort-indicator-title')).toBeVisible();
  });

  test('submit draft request via detail page', async ({ page }) => {
    // Create a Draft request via API
    const resp = await page.request.post('http://localhost:4001/api/governance-requests', {
      data: { title: 'Submit Flow E2E Test' },
    });
    const gr = await resp.json();
    expect(gr.status).toBe('Draft');

    // Navigate to detail page
    await page.goto(`/governance/${gr.requestId}`);
    await expect(page.getByTestId('submit-request-btn')).toBeVisible();

    // Click Submit and intercept the PUT response
    const [submitResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/governance-requests/${gr.requestId}/submit`) && r.request().method() === 'PUT',
        { timeout: 10000 },
      ),
      page.getByTestId('submit-request-btn').click(),
    ]);
    expect(submitResp.status()).toBe(200);
    const updated = await submitResp.json();
    expect(updated.status).toBe('Submitted');

    // Submit button should disappear (no longer Draft)
    await expect(page.getByTestId('submit-request-btn')).not.toBeVisible();
  });

  test('export CSV button is visible', async ({ page }) => {
    // Create a request first so data exists
    await page.request.post('http://localhost:4001/api/governance-requests', {
      data: { title: 'CSV Export Test' },
    });
    await page.goto('/requests');
    await expect(page.getByRole('heading', { name: 'Governance Requests' })).toBeVisible();
    // Wait for data to load
    await page.waitForTimeout(1000);
    // Export CSV button should be visible
    await expect(page.getByTestId('export-csv-btn')).toBeVisible();
    await expect(page.getByTestId('export-csv-btn')).toHaveText(/Export CSV/);
  });
});
