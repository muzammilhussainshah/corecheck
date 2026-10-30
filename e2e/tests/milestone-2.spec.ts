import { expect, test } from '@playwright/test';

const WEB = 'http://localhost:3100';
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

/**
 * Needs the demo data (`npm run seed:demo -w @corecheck/api`): the Mobile
 * crane type requires a LOLER certificate and Standard reception is
 * published with manual approval.
 */
test('Milestone 2: register plant, hold its certificate, pass reception, approve', async ({
  page,
}) => {
  const name = `E2E crane ${Date.now()}`;

  await page.goto(`${WEB}/login`);
  await page
    .getByLabel('Username')
    .fill(process.env.E2E_USERNAME ?? 'alexadmin43');
  await page.getByLabel('PIN digit 1 of 6', { exact: true }).click();
  await page.keyboard.type(process.env.E2E_PIN ?? '135792');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => url.pathname === '/');

  // Register: new plant starts as Pending Reception.
  await page.goto(`${WEB}/plant/new`);
  await page.getByRole('textbox', { name: /^Equipment name/ }).fill(name);
  await page.getByRole('combobox', { name: /^Plant type/ }).click();
  await page.getByRole('option', { name: 'Mobile crane' }).click();
  await page.getByText('Hired', { exact: true }).click();
  await page.getByRole('combobox', { name: /^Hire company/ }).click();
  await page.getByRole('option', { name: 'Pennine Plant Hire' }).click();
  await page.getByRole('combobox', { name: /^Site/ }).click();
  await page.getByRole('option', { name: 'Leeds Depot' }).click();
  await page.getByRole('button', { name: 'Register plant' }).click();
  await page.waitForURL(/\/plant\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Pending Reception').first()).toBeVisible();

  // Reception answered with no certificate: approval is blocked.
  await page.getByRole('tab', { name: 'Reception' }).click();
  await page.getByRole('combobox').first().click();
  await page.getByRole('option', { name: /Standard reception/ }).click();
  await page.getByRole('button', { name: 'Assign' }).click();
  await expect(page.getByText(/acceptable condition/)).toBeVisible();
  for (const answer of await page.getByText('Yes', { exact: true }).all())
    await answer.click({ force: true });
  await page.getByRole('button', { name: 'Submit reception' }).click();
  await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();

  // The mandatory certificate, uploaded and verified.
  await page.getByRole('tab', { name: 'Documents' }).click();
  await page.getByRole('button', { name: 'Upload document' }).first().click();
  const dialog = page.getByRole('dialog');
  const type = dialog.getByRole('combobox', { name: /^Document type/ });
  if (await type.isVisible()) {
    await type.click();
    await page.getByRole('option', { name: 'LOLER certificate' }).click();
  }
  const expires = new Date(Date.now() + 200 * 86_400_000);
  await dialog
    .getByRole('textbox', { name: /^Expiry date/ })
    .fill(expires.toISOString().slice(0, 10));
  await dialog.getByRole('textbox', { name: /^Reference/ }).click();
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'loler.pdf',
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  await dialog.getByRole('button', { name: 'Upload' }).click();
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByText('Valid').first()).toBeVisible();

  // With the document held, approval puts the plant online.
  await page.getByRole('tab', { name: 'Reception' }).click();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Approved/Online').first()).toBeVisible();

  // The journey is in the plant's history.
  await page.getByRole('tab', { name: 'History' }).click();
  for (const event of [
    'Plant registered',
    'Document uploaded',
    'Document verified',
    'Reception approved',
    'Plant approved',
  ])
    await expect(page.getByRole('cell', { name: event })).toBeVisible();
});
