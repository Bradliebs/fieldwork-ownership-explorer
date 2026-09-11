import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`saved revision comparison is read-only and keeps unsaved notes at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.locator('.parcel-row').first().click();
    await page.getByRole('button', { name: 'Start investigation', exact: true }).click();
    await page.getByLabel('Investigation name', { exact: true }).fill(`Revision viewer ${width}`);
    const original = '<script>window.historyExecuted=true</script> Original notes';
    await page.getByLabel('Analyst notes').fill(original);
    await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Revision 0');
    await page.getByLabel('Analyst notes').fill('Saved revised notes');
    await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Revision 1');
    await page.getByLabel('Analyst notes').fill('Unsaved current editor');
    await page.getByText('Compare saved revisions', { exact: true }).click();
    await expect(page.getByLabel('Revision changes')).toContainText(original);
    await expect(page.getByLabel('Revision changes')).toContainText('Saved revised notes');
    await expect(page.getByLabel('Revision changes')).not.toContainText('Unsaved current editor');
    await page.getByLabel('After revision').selectOption('0');
    await page.getByLabel('Before revision').selectOption('-1');
    await page.getByText('Full recorded revision 0', { exact: true }).click();
    await expect(page.locator('.revision-record')).toContainText(original);
    await expect(page.getByLabel('Analyst notes')).toHaveValue('Unsaved current editor');
    await expect(page.getByRole('button', { name: 'Report', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).historyExecuted)).toBeUndefined();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.revision-inspector').screenshot({ path: info.outputPath(`revisions-${width}.png`) });
  });
}