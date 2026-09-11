import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  for (const existing of [false, true]) {
    test(`recover ${existing ? 'existing' : 'new'} draft after reload at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await page.locator('.parcel-row').first().click();
      await page.getByRole('button', { name: 'Start investigation', exact: true }).click();
      const name = `Recovery ${existing} ${width}`;
      await page.getByLabel('Investigation name', { exact: true }).fill(name);
      if (existing) {
        await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
        await expect(page.getByRole('status')).toContainText('Revision 0');
      }
      await page.getByLabel('Analyst notes').fill('Checkpointed observations');
      await page.getByLabel('Project name', { exact: true }).fill('Unfinished project');
      await expect(page.locator('.checkpoint-status')).toHaveText('Draft checkpoint saved locally');
      page.once('dialog', dialog => dialog.accept());
      await page.reload();
      await page.getByRole('button', { name: 'Investigations', exact: true }).click();
      await page.getByRole('button', { name: `Restore draft ${name}`, exact: true }).click();
      await expect(page.getByLabel('Analyst notes')).toHaveValue('Checkpointed observations');
      await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Unfinished project');
      await expect(page.getByRole('button', { name: 'Report', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
      await expect(page.getByRole('status')).toContainText(`Revision ${existing ? 1 : 0}`);
      await expect.poll(async () => (await (await page.request.get('/api/recovery-drafts')).json()).drafts.filter((item: { edit: { name: string } }) => item.edit.name === name).length).toBe(0);
      await page.reload();
      await page.getByRole('button', { name: 'Investigations', exact: true }).click();
      await expect(page.getByRole('button', { name: `Restore draft ${name}`, exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
      await expect(page.getByLabel('Analyst notes')).toHaveValue('Checkpointed observations');
    });
  }
}

test('checkpoint failure is visible and never reports a saved case', async ({ page }) => {
  await page.route('**/api/recovery-drafts/*', route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 503, json: { error: 'Checkpoint unavailable' } }) : route.continue());
  await page.goto('/');
  await page.locator('.parcel-row').first().click();
  await page.getByRole('button', { name: 'Start investigation', exact: true }).click();
  await page.getByLabel('Analyst notes').fill('Still in this window');
  await expect(page.locator('.checkpoint-status')).toContainText('Draft checkpoint failed');
  await expect(page.getByLabel('Analyst notes')).toHaveValue('Still in this window');
  await expect(page.getByRole('status').filter({ hasText: 'Investigation saved' })).toHaveCount(0);
});

test('closed-tab recovery preserves incomplete records and can be explicitly discarded', async ({ page, context }) => {
  await page.goto('/');
  await page.locator('.parcel-row').first().click();
  await page.getByRole('button', { name: 'Start investigation', exact: true }).click();
  await page.getByLabel('Investigation name', { exact: true }).fill('Incomplete recovery');
  await page.getByRole('navigation', { name: 'Case sections' }).getByRole('button', { name: 'Titles', exact: true }).click();
  await page.getByRole('button', { name: 'Add title', exact: true }).click();
  await page.getByRole('navigation', { name: 'Case sections' }).getByRole('button', { name: 'Parties', exact: true }).click();
  await page.getByRole('button', { name: 'Add party', exact: true }).click();
  await page.getByLabel('Contact email', { exact: true }).fill('unfinished@');
  await expect(page.locator('.checkpoint-status')).toHaveText('Draft checkpoint saved locally');
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('/');
  await reopened.getByRole('button', { name: 'Investigations', exact: true }).click();
  await reopened.getByRole('button', { name: 'Restore draft Incomplete recovery', exact: true }).click();
  await reopened.getByRole('navigation', { name: 'Case sections' }).getByRole('button', { name: 'Parties', exact: true }).click();
  await expect(reopened.getByLabel('Contact email', { exact: true })).toHaveValue('unfinished@');
  await reopened.getByRole('navigation', { name: 'Case sections' }).getByRole('button', { name: 'Titles', exact: true }).click();
  await expect(reopened.getByLabel('Title number', { exact: true })).toHaveValue('');
  reopened.once('dialog', dialog => dialog.accept());
  await reopened.reload();
  await reopened.getByRole('button', { name: 'Investigations', exact: true }).click();
  reopened.once('dialog', dialog => dialog.dismiss());
  await reopened.getByRole('button', { name: 'Discard draft Incomplete recovery', exact: true }).click();
  await expect(reopened.getByRole('button', { name: 'Restore draft Incomplete recovery', exact: true })).toBeVisible();
  reopened.once('dialog', dialog => dialog.accept());
  await reopened.getByRole('button', { name: 'Discard draft Incomplete recovery', exact: true }).click();
  await expect(reopened.getByRole('button', { name: 'Restore draft Incomplete recovery', exact: true })).toHaveCount(0);
});

test('recovered stale edits cannot overwrite a newer saved revision', async ({ page }) => {
  await page.goto('/');
  await page.locator('.parcel-row').first().click();
  await page.getByRole('button', { name: 'Start investigation', exact: true }).click();
  await page.getByLabel('Investigation name', { exact: true }).fill('Stale recovery');
  await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Revision 0');
  await page.getByLabel('Analyst notes').fill('Older unfinished notes');
  await expect(page.locator('.checkpoint-status')).toHaveText('Draft checkpoint saved locally');
  const draft = (await (await page.request.get('/api/recovery-drafts')).json()).drafts.find((item: { edit: { name: string } }) => item.edit.name === 'Stale recovery');
  const { token } = await (await page.request.get('/api/session')).json();
  const newer = await page.request.put(`/api/investigations/${draft.investigationId}`, { headers: { 'x-local-token': token }, data: { ...draft.edit, notes: 'Newer saved notes', revision: 0 } });
  expect(newer.ok()).toBe(true);
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await page.getByRole('button', { name: 'Investigations', exact: true }).click();
  await page.getByRole('button', { name: 'Restore draft Stale recovery', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('older revision');
  await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The saved revision changed');
  await expect(page.getByLabel('Analyst notes')).toHaveValue('Older unfinished notes');
  const saved = await (await page.request.get(`/api/investigations/${draft.investigationId}`)).json();
  expect(saved.investigation.notes).toBe('Newer saved notes');
  expect(saved.history).toHaveLength(2);
});