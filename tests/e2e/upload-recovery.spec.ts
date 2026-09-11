import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';

for (const width of [1440, 390]) {
  for (const lostResponse of [false, true]) {
    test(`upload ${lostResponse ? 'lost response' : 'rejected write'} recovers without duplicate evidence at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await page.locator('.parcel-row').first().click();
      await page.getByRole('button', { name: 'Start investigation', exact: true }).click();
      const name = `Upload recovery ${lostResponse} ${width}`;
      await page.getByLabel('Investigation name', { exact: true }).fill(name);
      await page.getByLabel('Analyst notes').fill('Preserve saved case notes');
      await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('Revision 0');
      await page.getByRole('navigation', { name: 'Case sections' }).getByRole('button', { name: 'Documents', exact: true }).click();
      const content = Buffer.from('Fictional field evidence\nNo personal data.\n');
      const file = { name: 'field-evidence.txt', mimeType: 'text/plain', buffer: content };
      const upload = page.getByLabel('Evidence document', { exact: true });
      let failing = true;
      let attempts = 0;
      let endpoint = '';
      await page.route('**/api/investigations/*/documents', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        attempts++;
        endpoint = route.request().url();
        if (!failing) return route.continue();
        if (lostResponse) {
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          return route.abort('failed');
        }
        return route.fulfill({ status: 503, json: { error: 'Fixture evidence storage unavailable' } });
      });
      await upload.setInputFiles(file);
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(upload).toBeEnabled();
      expect(attempts).toBe(1);
      await expect(page.locator('.case-document')).toHaveCount(0);
      await expect(page.getByRole('status').filter({ hasText: 'Document saved' })).toHaveCount(0);
      await expect(page.getByLabel('Analyst notes')).toHaveValue('Preserve saved case notes');
      const caseEndpoint = endpoint.slice(0, -'/documents'.length);
      const beforeRetry = await (await page.request.get(caseEndpoint)).json();
      expect(beforeRetry.investigation.documents).toHaveLength(lostResponse ? 1 : 0);
      expect(beforeRetry.investigation.revision).toBe(lostResponse ? 1 : 0);
      expect(beforeRetry.history).toHaveLength(lostResponse ? 2 : 1);
      failing = false;
      await upload.setInputFiles(file);
      if (lostResponse) {
        await expect(page.getByRole('alert')).toContainText('Reopen the saved version before attaching evidence');
        await expect(page.locator('.case-document')).toHaveCount(0);
        const afterRetry = await (await page.request.get(caseEndpoint)).json();
        expect(afterRetry.investigation.documents).toHaveLength(1);
        expect(afterRetry.investigation.revision).toBe(1);
        await page.getByRole('button', { name: 'Reopen saved version' }).click();
      } else {
        await expect(page.getByRole('status')).toContainText('Document saved. Revision 1');
      }
      expect(attempts).toBe(2);
      await expect(page.locator('.case-document')).toHaveCount(1);
      await expect(page.locator('.case-document')).toContainText(file.name);
      await expect(page.getByLabel('Analyst notes')).toHaveValue('Preserve saved case notes');
      const result = await (await page.request.get(caseEndpoint)).json();
      expect(result.history).toHaveLength(2);
      expect(result.investigation.revision).toBe(1);
      expect(result.investigation.documents).toHaveLength(1);
      const document = result.investigation.documents[0];
      expect(document.sha256).toBe(createHash('sha256').update(content).digest('hex'));
      const download = await page.request.get(`${endpoint}/${document.id}`);
      expect(download.status()).toBe(200);
      expect(await download.body()).toEqual(content);
      await page.reload();
      await page.getByRole('button', { name: 'Investigations', exact: true }).click();
      await page.getByRole('button', { name: new RegExp(name) }).click();
      await page.getByRole('navigation', { name: 'Case sections' }).getByRole('button', { name: 'Documents', exact: true }).click();
      await expect(page.locator('.case-document')).toHaveCount(1);
      await expect(page.locator('.case-document')).toContainText(document.sha256);
    });
  }
}