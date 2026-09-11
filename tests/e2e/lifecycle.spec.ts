import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`archive and legal hold decisions require saved reopening at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.locator('.parcel-row').first().click();
    await page.getByRole('button', { name: 'Start investigation', exact: true }).click();
    const name = `Records case ${width}`;
    await page.getByLabel('Investigation name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Revision 0');
    await page.getByRole('button', { name: 'Records', exact: true }).click();
    await page.getByLabel('Record state', { exact: true }).selectOption('archived');
    await page.getByLabel('Legal hold', { exact: true }).check();
    await page.getByLabel('Hold reason', { exact: true }).fill('Pending title dispute');
    await page.getByLabel('Records reviewed by').fill('Local reviewer');
    await page.getByLabel('Records reviewed on').fill('2026-09-11');
    await page.getByLabel('Records decision reason').fill('Preserve evidence');
    await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Revision 1');
    await expect(page.getByLabel('Analyst notes')).toBeDisabled();
    await page.getByRole('button', { name: 'Case oversight', exact: true }).click();
    await page.getByLabel('Search cases').fill(name);
    await page.getByLabel('Review filter').selectOption('hold');
    await expect(page.locator('.oversight-cases')).toContainText('Archived / Legal hold');
    await page.getByRole('button', { name: 'Back to investigations' }).click();
    await page.getByRole('button', { name: 'Records', exact: true }).click();
    await page.getByLabel('Legal hold', { exact: true }).uncheck();
    await page.getByLabel('Record state', { exact: true }).selectOption('active');
    await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('release reason');
    await expect(page.getByLabel('Analyst notes')).toBeDisabled();
    await page.getByLabel('Hold release reason').fill('Dispute resolved');
    await page.getByLabel('Records decision reason').fill('Reopen for review');
    await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Revision 2');
    await expect(page.getByLabel('Analyst notes')).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.case-fields').screenshot({ path: info.outputPath(`records-${width}.png`) });
  });
}