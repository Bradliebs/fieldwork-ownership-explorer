import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';

test('map renders coloured parcels, search filters and review stays inferred after reload', async ({ page }, info) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('/');
  await page.getByLabel('Workspace dataset').selectOption('demo');
  await expect(page.getByTestId('map')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.parcel-row')).toHaveCount(12);
  await expect.poll(async () => {
    const image = PNG.sync.read(await page.locator('canvas').screenshot());
    let coloured = 0;
    for (let offset = 0; offset < image.data.length; offset += 4) {
      const red = image.data[offset], green = image.data[offset + 1], blue = image.data[offset + 2];
      if (Math.max(red, green, blue) - Math.min(red, green, blue) > 25) coloured++;
    }
    return coloured;
  }).toBeGreaterThan(2000);
  await page.getByLabel('Search parcels').fill('Workshop');
  await expect(page.locator('.parcel-row')).toHaveCount(1);
  await page.locator('.parcel-row').click();
  await expect(page.getByLabel('Parcel evidence')).toBeVisible();
  await expect(page.locator('.detail-title .badge')).toHaveText('candidate');
  await page.getByLabel('Reviewer', { exact: true }).fill('Browser tester');
  await page.getByLabel('Evidence notes').fill('Reviewed the fictional overlap; no title link established.');
  await page.getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(page.getByRole('status')).toContainText('Review saved');
  await expect(page.locator('.detail-title .badge')).toHaveText('candidate');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export synthetic GeoJSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('synthetic-ownership.geojson');
  await page.screenshot({ path: info.outputPath('desktop.png'), fullPage: true });
  await page.reload();
  await page.getByLabel('Workspace dataset').selectOption('demo');
  await page.getByLabel('Search parcels').fill('Workshop');
  await page.locator('.parcel-row').click();
  await expect(page.locator('.interest-record').first()).toContainText('reviewed');
  expect(failures).toEqual([]);
});

test('mobile fits, joint proprietors stay visible, filters and readiness work', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('Workspace dataset').selectOption('demo');
  await expect(page.getByTestId('map')).toHaveAttribute('data-ready', 'true');
  await page.getByLabel('Search parcels').fill('Station');
  await page.locator('.parcel-row').click();
  await expect(page.locator('.proprietor')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('mobile.png'), fullPage: true });
  await page.getByLabel('Close parcel details').click();
  await page.getByLabel('Clear search').click();
  await page.getByLabel('Match status', { exact: true }).selectOption('unknown');
  await expect(page.locator('.parcel-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Source register' })).toBeVisible();
  await expect(page.locator('.gate-list>div')).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`real Bristol pilot renders offline and exports unknown ownership at ${viewport.width}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const external: string[] = [], failures: string[] = [];
    page.on('pageerror', error => failures.push(error.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).hostname !== '127.0.0.1') { external.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    await page.goto('/');
    await expect(page.getByTestId('map')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('.parcel-row')).toHaveCount(100);
    await expect(page.locator('.results-heading')).toContainText('1456 parcels');
    await page.getByLabel('Interest', { exact: true }).selectOption('freehold');
    await expect(page.locator('.results-heading')).toContainText('1456 parcels');
    const canvas = page.locator('canvas');
    await expect.poll(async () => {
      const image = PNG.sync.read(await canvas.screenshot());
      let water = 0;
      for (let offset = 0; offset < image.data.length; offset += 4) {
        if (image.data[offset + 2] - image.data[offset] > 20 && image.data[offset + 1] > 160) water++;
      }
      return water;
    }).toBeGreaterThan(1000);
    await page.screenshot({ path: info.outputPath('pilot-overview.png'), fullPage: true });
    const before = PNG.sync.read(await canvas.screenshot());
    await page.getByLabel('Parcels', { exact: true }).uncheck();
    await expect.poll(async () => {
      const after = PNG.sync.read(await canvas.screenshot());
      let changed = 0;
      for (let offset = 0; offset < before.data.length; offset += 4) if (Math.abs(before.data[offset] - after.data[offset]) > 10) changed++;
      return changed;
    }).toBeGreaterThan(100);
    await page.getByLabel('Parcels', { exact: true }).check();
    await page.locator('.parcel-row').first().click();
    await expect(page.getByLabel('Parcel evidence')).toContainText('HM Land Registry INSPIRE');
    await expect(page.locator('.detail-title .badge')).toHaveText('unknown');
    await expect(page.getByRole('button', { name: 'Mark reviewed' })).toHaveCount(0);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export parcel GeoJSON' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('bristol-inspire.geojson');
    const exported = JSON.parse(readFileSync((await download.path())!, 'utf8'));
    expect(exported.synthetic).toBe(false);
    expect(exported.features).toHaveLength(1);
    expect(exported.features[0].properties.links).toEqual([]);
    expect(exported.features[0].properties.source.inspireId).toMatch(/^\d+$/);
    expect(exported.manifest.attribution).toContain('AC0000851063');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('pilot-selection.png'), fullPage: true });
    await page.getByLabel('Close parcel details').click();
    const canvasBounds = await canvas.boundingBox();
    expect(canvasBounds).not.toBeNull();
    let selectedByMap = false;
    for (const vertical of [0.45, 0.55, 0.35, 0.65]) {
      for (const horizontal of [0.45, 0.55, 0.35, 0.65]) {
        await canvas.click({ position: { x: canvasBounds!.width * horizontal, y: canvasBounds!.height * vertical } });
        if (await page.getByLabel('Parcel evidence').count()) { selectedByMap = true; break; }
      }
      if (selectedByMap) break;
    }
    expect(selectedByMap).toBe(true);
    await expect(page.locator('.detail-title .badge')).toHaveText('unknown');
    await page.getByLabel('Workspace dataset').selectOption('demo');
    await page.getByLabel('Search parcels').fill('Workshop');
    await page.locator('.parcel-row').click();
    await expect(page.locator('.detail-title .badge')).toHaveText('candidate');
    await page.getByLabel('Workspace dataset').selectOption('pilot');
    await expect(page.getByLabel('Parcel evidence')).toHaveCount(0);
    await expect(page.locator('.parcel-row')).toHaveCount(100);
    expect(external).toEqual([]);
    expect(failures).toEqual([]);
  });
}