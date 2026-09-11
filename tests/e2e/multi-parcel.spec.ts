import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

for (const width of [1440, 390]) {
  test(`site parcels survive draft recovery and appear with explicit scope at ${width}`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const failures: string[] = [];
    page.on('pageerror', error => failures.push(error.message));
    await page.goto('/');
    await page.locator('.parcel-row').first().click();
    const firstId = await page.locator('.detail-title .mono').innerText();
    await page.getByRole('checkbox', { name: `Include ${firstId} in site investigation` }).check();
    await page.getByRole('button', { name: 'Close parcel details' }).click();
    await page.locator('.parcel-row').nth(1).click();
    const secondId = await page.locator('.detail-title .mono').innerText();
    await page.getByRole('button', { name: 'Start investigation', exact: true }).click();
    const name = `Site scope ${width}`;
    await page.getByLabel('Investigation name', { exact: true }).fill(name);
    await expect(page.getByRole('region', { name: 'Case parcels' })).toContainText('2 case parcels');
    await expect(page.locator('.checkpoint-status')).toContainText('Draft checkpoint saved');
    page.once('dialog', dialog => dialog.accept());
    await page.reload();
    await page.getByRole('button', { name: 'Investigations', exact: true }).click();
    await page.getByRole('button', { name: `Restore draft ${name}`, exact: true }).click();
    await expect(page.getByRole('region', { name: 'Case parcels' })).toContainText(firstId);
    await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Revision 0');
    await page.getByRole('navigation', { name: 'Case sections' }).getByRole('button', { name: 'Titles', exact: true }).click();
    await page.getByRole('button', { name: 'Add title' }).click();
    await page.getByLabel('Title number', { exact: true }).fill('AV123');
    await page.getByRole('group', { name: 'Title parcel scope', exact: true }).getByRole('checkbox', { name: firstId }).check();
    await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Revision 1');
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download saved case GIS' }).click();
    const download = await downloaded;
    const database = new DatabaseSync((await download.path())!, { readOnly: true });
    try {
      expect(database.prepare('SELECT count(*) AS total FROM parcels').get()!.total).toBe(2);
      expect(database.prepare('SELECT parcel_id FROM title_scope').get()!.parcel_id).toBe(firstId);
    } finally { database.close(); }
    await page.getByLabel('GIS format').selectOption('geojson');
    const jsonDownloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download saved case GIS' }).click();
    const jsonDownload = await jsonDownloaded;
    expect(JSON.parse(readFileSync((await jsonDownload.path())!, 'utf8')).features).toHaveLength(2);
    await expect(page.getByTestId('map')).toHaveAttribute('data-ready', 'true');
    await expect.poll(async () => {
      const image = PNG.sync.read(await page.locator('canvas').screenshot());
      let coloured = 0;
      for (let offset = 0; offset < image.data.length; offset += 4) if (image.data[offset + 1] - image.data[offset] > 20) coloured++;
      return coloured;
    }).toBeGreaterThan(100);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`site-${width}.png`), fullPage: true });
    const opened = context.waitForEvent('page');
    await page.getByRole('button', { name: 'Report', exact: true }).click();
    const report = await opened;
    await report.waitForLoadState();
    await expect(report.locator('svg path')).toHaveCount(2);
    await expect(report.locator('body')).toContainText(firstId);
    await expect(report.locator('body')).toContainText(secondId);
    await report.setViewportSize({ width, height: 900 });
    expect(await report.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await report.screenshot({ path: info.outputPath(`site-report-${width}.png`), fullPage: true });
    await report.close();
    await page.reload();
    await page.getByRole('button', { name: 'Investigations', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await expect(page.getByRole('region', { name: 'Case parcels' })).toContainText(secondId);
    expect(failures).toEqual([]);
  });
}