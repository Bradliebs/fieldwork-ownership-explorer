import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  for (const lostResponse of [false, true]) {
    test(`creation ${lostResponse ? 'lost response' : 'rejected save'} preserves draft and avoids duplicates at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await page.locator('.parcel-row').first().click();
      await page.getByRole('button', { name: 'Start investigation', exact: true }).click();
      const name = `Create recovery ${lostResponse} ${width}`;
      await page.getByLabel('Investigation name', { exact: true }).fill(name);
      await page.getByLabel('Analyst notes').fill('Retain creation notes');
      await page.getByLabel('Project name', { exact: true }).fill('Recovery project');
      const operationIds: string[] = [];
      let failing = true;
      await page.route('**/api/investigations', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        operationIds.push(route.request().postDataJSON().operationId);
        if (!failing) return route.continue();
        if (lostResponse) {
          const response = await route.fetch();
          expect(response.status()).toBe(201);
          return route.abort('failed');
        }
        return route.fulfill({ status: 503, json: { error: 'Fixture storage unavailable' } });
      });
      await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      expect(operationIds).toHaveLength(2);
      await expect(page.getByLabel('Analyst notes')).toHaveValue('Retain creation notes');
      await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Recovery project');
      await expect(page.getByRole('button', { name: 'Report', exact: true })).toBeDisabled();
      const beforeRetry = await (await page.request.get('/api/investigations')).json();
      expect(beforeRetry.investigations.filter((item: { name: string }) => item.name === name)).toHaveLength(lostResponse ? 1 : 0);
      failing = false;
      await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('Revision 0');
      expect(operationIds).toHaveLength(3);
      expect(new Set(operationIds).size).toBe(1);
      const result = await (await page.request.get(`/api/investigations/${operationIds[0]}`)).json();
      expect(result.history).toHaveLength(1);
      expect(result.investigation.notes).toBe('Retain creation notes');
      const listing = await (await page.request.get('/api/investigations')).json();
      expect(listing.investigations.filter((item: { name: string }) => item.name === name)).toHaveLength(1);
    });

    test(`update ${lostResponse ? 'lost response' : 'rejected save'} preserves draft and avoids duplicate revisions at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await page.locator('.parcel-row').first().click();
      await page.getByRole('button', { name: 'Start investigation', exact: true }).click();
      await page.getByLabel('Investigation name', { exact: true }).fill(`Update recovery ${lostResponse} ${width}`);
      await page.getByLabel('Analyst notes').fill('Saved baseline');
      await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('Revision 0');
      await page.getByLabel('Analyst notes').fill('Retain updated notes');
      await page.getByLabel('Project name', { exact: true }).fill('Updated project');
      let attempts = 0;
      let endpoint = '';
      let failing = true;
      await page.route('**/api/investigations/*', async route => {
        if (route.request().method() !== 'PUT') return route.continue();
        attempts++;
        endpoint = route.request().url();
        if (!failing) return route.continue();
        if (lostResponse) {
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          return route.abort('failed');
        }
        return route.fulfill({ status: 503, json: { error: 'Fixture storage unavailable' } });
      });
      await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      expect(attempts).toBe(1);
      await expect(page.getByLabel('Analyst notes')).toHaveValue('Retain updated notes');
      await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Updated project');
      await expect(page.getByRole('button', { name: 'Report', exact: true })).toBeDisabled();
      const persisted = await (await page.request.get(endpoint)).json();
      expect(persisted.investigation.revision).toBe(lostResponse ? 1 : 0);
      expect(persisted.investigation.notes).toBe(lostResponse ? 'Retain updated notes' : 'Saved baseline');
      failing = false;
      await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
      if (lostResponse) {
        await expect(page.getByRole('alert')).toContainText('saved revision');
        await expect(page.getByRole('alert')).not.toContainText('Your draft has not been saved');
        await expect(page.getByLabel('Analyst notes')).toHaveValue('Retain updated notes');
        page.once('dialog', dialog => dialog.dismiss());
        await page.getByRole('button', { name: 'Reopen saved version' }).click();
        await expect(page.getByLabel('Analyst notes')).toHaveValue('Retain updated notes');
        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Reopen saved version' }).click();
      } else {
        await expect(page.getByRole('status')).toContainText('Revision 1');
      }
      await expect(page.getByRole('button', { name: 'Report', exact: true })).toBeEnabled();
      await expect(page.getByLabel('Analyst notes')).toHaveValue('Retain updated notes');
      await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Updated project');
      expect(attempts).toBe(2);
      const final = await (await page.request.get(endpoint)).json();
      expect(final.investigation.revision).toBe(1);
      expect(final.history).toHaveLength(2);
    });
  }
}