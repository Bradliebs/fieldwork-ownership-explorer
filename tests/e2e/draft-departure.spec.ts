import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  for (const previouslySaved of [false, true]) {
    test(`unsaved ${previouslySaved ? 'existing' : 'new'} investigation survives cancelled departure at ${width}`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await page.locator('.parcel-row').first().click();
      await page.getByRole('button', { name: 'Start investigation', exact: true }).click();
      const name = `Departure ${previouslySaved ? 'existing' : 'new'} ${width}`;
      await page.getByLabel('Investigation name', { exact: true }).fill(name);
      if (previouslySaved) {
        await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
        await expect(page.getByRole('status')).toContainText('Revision 0');
      }
      await page.getByLabel('Analyst notes').fill('Unsaved field observations');
      await page.getByLabel('Project name', { exact: true }).fill('Unsaved project');

      const reloadDialog = page.waitForEvent('dialog');
      const browserSession = await context.newCDPSession(page);
      await browserSession.send('Page.reload');
      const reloadWarning = await reloadDialog;
      expect(reloadWarning.type()).toBe('beforeunload');
      await reloadWarning.dismiss();
      await browserSession.detach();
      await expect(page.getByLabel('Analyst notes')).toHaveValue('Unsaved field observations');
      await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Unsaved project');

      const closeDialog = page.waitForEvent('dialog');
      await page.close({ runBeforeUnload: true });
      const closeWarning = await closeDialog;
      expect(closeWarning.type()).toBe('beforeunload');
      await closeWarning.dismiss();
      expect(page.isClosed()).toBe(false);
      await expect(page.getByLabel('Analyst notes')).toHaveValue('Unsaved field observations');
      await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Unsaved project');

      await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
      await expect(page.getByRole('status')).toContainText(`Revision ${previouslySaved ? 1 : 0}`);
      const unexpectedDialogs: string[] = [];
      page.on('dialog', async dialog => { unexpectedDialogs.push(dialog.type()); await dialog.dismiss(); });
      await page.reload();
      await page.getByRole('button', { name: 'Investigations', exact: true }).click();
      await page.getByRole('button', { name: new RegExp(name) }).click();
      await expect(page.getByLabel('Analyst notes')).toHaveValue('Unsaved field observations');
      await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Unsaved project');
      const closed = page.waitForEvent('close');
      await page.close({ runBeforeUnload: true });
      await closed;
      expect(unexpectedDialogs).toEqual([]);

      const reopened = await context.newPage();
      await reopened.goto('/');
      await reopened.getByRole('button', { name: 'Investigations', exact: true }).click();
      await reopened.getByRole('button', { name: new RegExp(name) }).click();
      await expect(reopened.getByLabel('Analyst notes')).toHaveValue('Unsaved field observations');
    });
  }
}

test('confirmed departure discards unsaved edits without changing the saved revision', async ({ page }) => {
  await page.goto('/');
  await page.locator('.parcel-row').first().click();
  await page.getByRole('button', { name: 'Start investigation', exact: true }).click();
  await page.getByLabel('Investigation name', { exact: true }).fill('Confirmed departure baseline');
  await page.getByLabel('Analyst notes').fill('Saved observations');
  await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Revision 0');
  await page.getByLabel('Analyst notes').fill('Deliberately discarded observations');
  const warningPromise = page.waitForEvent('dialog');
  const reload = page.reload();
  const warning = await warningPromise;
  expect(warning.type()).toBe('beforeunload');
  await warning.accept();
  await reload;
  await page.getByRole('button', { name: 'Investigations', exact: true }).click();
  await page.getByRole('button', { name: /Confirmed departure baseline/ }).click();
  await expect(page.getByLabel('Analyst notes')).toHaveValue('Saved observations');
  await expect(page.locator('.investigation-heading')).toContainText('SAVED REVISION 0');
});