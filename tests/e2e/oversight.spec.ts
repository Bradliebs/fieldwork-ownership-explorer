import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`case oversight filters and navigation preserve unsaved work at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.locator('.parcel-row').first().click();
    await page.getByRole('button', { name: 'Start investigation', exact: true }).click();
    const name = `Retention review ${width}`;
    await page.getByLabel('Investigation name', { exact: true }).fill(name);
    await page.getByLabel('Retention review date').fill('2020-01-01');
    await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Revision 0');
    await page.getByLabel('Analyst notes').fill('Current unsaved notes');
    await page.getByRole('button', { name: 'Case oversight', exact: true }).click();
    const overview = page.getByRole('region', { name: 'Case oversight' });
    await overview.getByLabel('Search cases').fill(name);
    await overview.getByLabel('Review filter').selectOption('retention');
    await expect(overview.locator('.oversight-cases')).toContainText(name);
    await expect(overview.locator('.oversight-cases')).toContainText('No requests recorded');
    await expect(overview.locator('.oversight-cases')).toContainText('due / 2020-01-01');
    await overview.getByLabel('Review filter').selectOption('expiring');
    await expect(overview).toContainText('No saved cases match this filter');
    await overview.getByLabel('Review filter').selectOption('missing');
    await expect(overview.locator('.oversight-cases')).toContainText(name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await overview.screenshot({ path: info.outputPath(`oversight-${width}.png`) });
    await overview.getByRole('button', { name: 'Back to investigations' }).click();
    await expect(page.getByLabel('Analyst notes')).toHaveValue('Current unsaved notes');
    await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Revision 1');
    await page.getByRole('button', { name: 'Case oversight', exact: true }).click();
    await overview.getByRole('button', { name: `Open oversight case ${name}`, exact: true }).click();
    await expect(page.getByLabel('Analyst notes')).toHaveValue('Current unsaved notes');
    await expect(page.getByLabel('Investigation name', { exact: true })).toHaveValue(name);
  });
}