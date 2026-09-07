import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import type { SalesRelease } from '../../packages/contracts/src/sales.ts';

const release = JSON.parse(readFileSync(new URL('../../public/pilot/sales.json', import.meta.url), 'utf8')) as SalesRelease;
for (const width of [1440, 390]) {
  test(`official sale evidence remains separate from ownership at ${width}`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page.getByTestId('map')).toHaveAttribute('data-ready', 'true');
    await page.getByLabel('Recorded sales only').check();
    await expect(page.locator('.parcel-row')).toHaveCount(4);
    for (const record of release.records) {
      if (width === 390 && await page.getByRole('button', { name: 'Close parcel details' }).isVisible()) {
        await page.getByRole('button', { name: 'Close parcel details' }).click();
      }
      await page.locator('.parcel-row').filter({ hasText: `INSPIRE-${record.inspireIds[0]}` }).click();
      const evidence = page.getByRole('region', { name: 'Recorded sales' });
      await expect(evidence).toContainText(record.transactionId);
      await expect(evidence).toContainText(record.date);
      await expect(evidence).toContainText(new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(record.price));
      await expect(page.getByRole('heading', { name: 'Ownership unknown' })).toBeVisible();
    }
    const record = release.records.at(-1)!;
    await page.getByRole('region', { name: 'Recorded sales' }).scrollIntoViewIfNeeded();
    await expect.poll(async () => {
      const image = PNG.sync.read(await page.locator('canvas').screenshot());
      let coloured = 0;
      for (let offset = 0; offset < image.data.length; offset += 4) {
        if (image.data[offset + 1] - image.data[offset] > 20) coloured++;
      }
      return coloured;
    }).toBeGreaterThan(100);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`parcel-sales-${width}.png`), fullPage: true });
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export parcel GeoJSON', exact: true }).click();
    const download = await downloadPromise;
    const geojson = JSON.parse(readFileSync((await download.path())!, 'utf8'));
    expect(geojson.features[0].properties.saleEvidence.records).toEqual([record]);
    expect(geojson.features[0].properties.status).toBe('unknown');
    expect(geojson.features[0].properties.links).toEqual([]);
    await page.getByRole('button', { name: 'Start investigation', exact: true }).click();
    const name = `Sales evidence ${width}`;
    await page.getByLabel('Investigation name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Revision 0');
    await page.reload();
    await page.getByRole('button', { name: 'Investigations', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await page.locator('.case-sales > summary').click();
    await expect(page.getByRole('region', { name: 'Recorded sales' })).toContainText(record.transactionId);
    const reportPromise = context.waitForEvent('page');
    await page.getByRole('button', { name: 'Report', exact: true }).click();
    const report = await reportPromise;
    await report.waitForLoadState();
    await report.setViewportSize({ width, height: 900 });
    await expect(report.locator('body')).toContainText(record.transactionId);
    await expect(report.locator('body')).toContainText('Unknown. No ownership evidence loaded.');
    await expect(report.locator('body')).toContainText(release.sources[0].sha256);
    expect(await report.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await report.emulateMedia({ media: 'print' });
    await report.screenshot({ path: info.outputPath(`sale-report-${width}.png`), fullPage: true });
    await report.pdf({ path: info.outputPath(`sale-report-${width}.pdf`), format: 'A4' });
    await report.close();
    await page.getByRole('button', { name: 'Explore', exact: true }).click();
    await page.getByLabel('Workspace dataset').selectOption('demo');
    await expect(page.getByLabel('Recorded sales only')).toHaveCount(0);
    await page.locator('.parcel-row').first().click();
    await expect(page.getByRole('region', { name: 'Recorded sales' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}