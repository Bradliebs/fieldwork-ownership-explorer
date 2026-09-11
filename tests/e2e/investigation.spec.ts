import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

for (const width of [1440, 390]) {
  test(`save and reopen a Bristol investigation and print its report at ${width}`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const failures: string[] = [];
    page.on('pageerror', error => failures.push(error.message));
    await page.goto('/');
    await page.locator('.parcel-row').first().click();
    const parcelId = await page.locator('.detail-title .mono').innerText();
    await page.getByRole('button', { name: 'Start investigation', exact: true }).click();
    const name = `Harbourside ${width} investigation`;
    await page.getByLabel('Investigation name', { exact: true }).fill(name);
    await page.getByLabel('Investigation question').fill('Which title evidence is still required?');
    await page.getByLabel('Analyst notes').fill('No verified title relationship. <script>window.bad=true</script>');
    await expect(page.getByRole('button', { name: 'Report', exact: true })).toBeDisabled();
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Explore', exact: true }).click();
    await expect(page.getByLabel('Investigation name', { exact: true })).toHaveValue(name);
    await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Investigation saved. Revision 0');
    await expect(page.getByTestId('map')).toHaveAttribute('data-ready', 'true');
    await expect.poll(async () => {
      const image = PNG.sync.read(await page.locator('canvas').screenshot());
      let coloured = 0;
      for (let offset = 0; offset < image.data.length; offset += 4) {
        if (image.data[offset + 1] - image.data[offset] > 20) coloured++;
      }
      return coloured;
    }).toBeGreaterThan(100);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`investigation-${width}.png`), fullPage: true });
    await page.reload();
    await page.getByRole('button', { name: 'Investigations', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await expect(page.getByLabel('Analyst notes')).toHaveValue('No verified title relationship. <script>window.bad=true</script>');
    await expect(page.locator('.investigation-heading')).toContainText(parcelId);
    await page.getByLabel('Analyst notes').fill('Site visit required. Ownership remains unknown.');
    await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Revision 1');
    const reportPromise = context.waitForEvent('page');
    await page.getByRole('button', { name: 'Report', exact: true }).click();
    const report = await reportPromise;
    await report.waitForLoadState();
    await report.setViewportSize({ width, height: 900 });
    await expect(report.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(report.locator('body')).toContainText('Saved revision 1');
    await expect(report.locator('body')).toContainText(parcelId);
    await expect(report.locator('body')).toContainText('Unknown. No ownership evidence loaded.');
    await expect(report.getByRole('img')).toBeVisible();
    expect(await report.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await report.emulateMedia({ media: 'print' });
    await expect(report.getByRole('button', { name: 'Print / Save as PDF' })).toBeHidden();
    await report.screenshot({ path: info.outputPath(`report-${width}.png`), fullPage: true });
    await report.pdf({ path: info.outputPath(`report-${width}.pdf`), format: 'A4' });
    await report.close();
    expect(failures).toEqual([]);
  });
}

test('conflicting investigation edit preserves draft and can reopen saved version', async ({ page, context }) => {
  await page.goto('/');
  await page.locator('.parcel-row').first().click();
  await page.getByRole('button', { name: 'Start investigation', exact: true }).click();
  await page.getByLabel('Investigation name', { exact: true }).fill('Conflict test');
  await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Revision 0');
  const other = await context.newPage();
  await other.goto('/');
  await other.getByRole('button', { name: 'Investigations', exact: true }).click();
  await other.getByRole('button', { name: /Conflict test/ }).click();
  await page.getByLabel('Analyst notes').fill('First edit');
  await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Revision 1');
  await other.getByLabel('Analyst notes').fill('Second unsaved edit');
  await other.getByRole('button', { name: 'Save investigation', exact: true }).click();
  await expect(other.getByRole('alert')).toContainText('The saved revision changed');
  await expect(other.getByLabel('Analyst notes')).toHaveValue('Second unsaved edit');
  other.once('dialog', dialog => dialog.accept());
  await other.getByRole('button', { name: 'Reopen saved version' }).click();
  await expect(other.getByLabel('Analyst notes')).toHaveValue('First edit');
  await other.close();
});

test('transient investigation creation retries safely without losing the draft', async ({ page }) => {
  const operationIds: string[] = [];
  await page.route('**/api/investigations', route => {
    if (route.request().method() !== 'POST') return route.continue();
    operationIds.push(route.request().postDataJSON().operationId);
    if (operationIds.length === 1) {
      return route.fulfill({ status: 503, contentType: 'text/plain', body: 'Storage unavailable' });
    }
    return route.continue();
  });

  await page.goto('/');
  await page.locator('.parcel-row').first().click();
  await page.getByRole('button', { name: 'Start investigation', exact: true }).click();
  await page.getByLabel('Investigation name', { exact: true }).fill('Retained field draft');
  await page.getByLabel('Analyst notes').fill('Keep this text when local storage is unavailable.');
  await page.getByRole('button', { name: 'Save investigation', exact: true }).click();

  await expect(page.getByRole('status')).toContainText('Investigation saved. Revision 0');
  await expect(page.getByLabel('Investigation name', { exact: true })).toHaveValue('Retained field draft');
  await expect(page.getByLabel('Analyst notes')).toHaveValue('Keep this text when local storage is unavailable.');
  expect(operationIds).toHaveLength(2);
  expect(operationIds[1]).toBe(operationIds[0]);
  await expect(page.getByRole('button', { name: /Retained field draft/ })).toHaveCount(1);
});

test('investigation creation supports keyboard activation and tab navigation', async ({ page }) => {
  await page.goto('/');
  await page.locator('.parcel-row').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Parcel evidence')).toBeVisible();

  await page.getByRole('button', { name: 'Start investigation', exact: true }).focus();
  await page.keyboard.press('Enter');
  const name = page.getByLabel('Investigation name', { exact: true });
  await name.focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Keyboard investigation');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Investigation question')).toBeFocused();
  await page.keyboard.type('Can the core workflow be completed without a pointer?');

  await page.getByRole('button', { name: 'Save investigation', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Investigation saved. Revision 0');
});

test('investigations remain distinct from the synthetic demo', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Workspace dataset').selectOption('demo');
  await page.locator('.parcel-row').first().click();
  await expect(page.getByRole('button', { name: 'Start investigation', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Investigations', exact: true }).click();
  await expect(page.locator('.demo-banner')).toContainText('Saved Bristol parcel snapshots');
  await expect(page.getByLabel('Workspace dataset')).toHaveValue('pilot');
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await expect(page.getByLabel('Workspace dataset')).toHaveValue('demo');
  await expect(page.locator('.demo-banner')).toContainText('Synthetic preview');
});