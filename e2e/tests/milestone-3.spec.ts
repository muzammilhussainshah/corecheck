import { expect, type Page, test } from '@playwright/test';

const WEB = 'http://localhost:3100';
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('0000000d49484452000000010000000108060000001f15c489', 'hex'),
  Buffer.from('0000000049454e44ae426082', 'hex'),
]);

const signIn = async (page: Page) => {
  await page.goto(`${WEB}/login`);
  await page
    .getByLabel('Username')
    .fill(process.env.E2E_USERNAME ?? 'alexadmin43');
  await page.getByLabel('PIN digit 1 of 6', { exact: true }).click();
  await page.keyboard.type(process.env.E2E_PIN ?? '135792');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => url.pathname === '/');
};

/** The card of one question on the check screen. */
const question = (page: Page, text: string) =>
  page.locator('.mantine-Card-root').filter({ hasText: text }).first();

const choose = async (page: Page, label: RegExp, option: RegExp | string) => {
  await page.getByRole('combobox', { name: label }).first().click();
  await page.getByRole('option', { name: option }).first().click();
};

/**
 * Needs the demo data (`npm run seed:demo -w @corecheck/api`): the Daily
 * pre-use check (hydraulics raise a Major Defect and take plant Offline, with
 * a follow-up) and the Defect repair verification template.
 */
test('Milestone 3: check fails, raises a Defect, verification under separation of duties, closure and return to service', async ({
  page,
}) => {
  await signIn(page);

  // A check assigned outside any schedule (SCH-004).
  await page.goto(`${WEB}/checks?new=1`);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Assign a check')).toBeVisible();
  await dialog.getByRole('combobox', { name: /^Plant/ }).click();
  await page.getByRole('option', { name: /^PLT-000001 / }).click();
  await choose(page, /^Template/, /Daily pre-use check/);
  await choose(page, /^User/, /Alex/);
  await dialog.getByRole('button', { name: 'Assign check' }).click();
  await page.waitForURL(/\/checks\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Due').first()).toBeVisible();

  // Mandatory questions are named when submitting too early (CHK-AC-01).
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByText('Answer: Tyres and tracks in good condition')).toBeVisible();

  // Failing the hydraulics asks the follow-up (TMP-009).
  await expect(page.getByText('Where is the leak?')).toHaveCount(0);
  await question(page, 'Tyres and tracks').getByText('Pass', { exact: true }).click();
  await question(page, 'Hydraulic hoses').getByText('Fail', { exact: true }).click();
  await expect(page.getByText('Where is the leak?')).toBeVisible();
  await question(page, 'Hydraulic hoses')
    .getByRole('textbox', { name: /Comment/ })
    .fill('Boom ram hose weeping');
  await question(page, 'Hydraulic hoses')
    .locator('input[type=file]')
    .setInputFiles({ name: 'hose.png', mimeType: 'image/png', buffer: PNG });
  await expect(question(page, 'Hydraulic hoses').getByText('hose.png')).toBeVisible();
  await question(page, 'Where is the leak?').getByRole('textbox').fill('Boom ram');
  await question(page, 'Fuel level').getByText('Half', { exact: true }).click();
  // The demo template reads the Hours meter when the organisation has one.
  if (await question(page, 'Hour meter').count())
    await question(page, 'Hour meter').getByRole('textbox').fill('99000');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();

  // Completed; the trigger raised a Major Defect and took the plant Offline.
  await expect(page.getByText('Completed').first()).toBeVisible();
  const defectLink = page
    .getByRole('heading', { name: 'Defects raised' })
    .locator('..')
    .getByRole('link', { name: /^DEF-\d{6}$/ });
  await expect(defectLink).toBeVisible();
  await defectLink.click();
  await page.waitForURL(/\/defects\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Major', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText('Boom ram hose weeping').first()).toBeVisible();

  // Work, then the verification (DFW-001..004).
  await expect(page.getByRole('button', { name: 'Close Defect' })).toBeDisabled();
  await page.getByRole('button', { name: 'Move to In Progress' }).click();
  await page.getByRole('textbox', { name: /^Corrective action/ }).fill('Replaced boom ram hose');
  await page.getByRole('button', { name: 'Save work' }).click();
  await expect(page.getByText(/Last recorded by/)).toBeVisible();
  await choose(page, /Verification template/, /Defect repair verification/);
  await page.getByRole('button', { name: 'Start verification' }).click();
  await page.getByRole('link', { name: /CHK-\d{6} Defect repair verification/ }).click();
  await page.waitForURL(/\/checks\/[0-9a-f-]{36}$/);
  await question(page, 'Repair completed').getByText('Pass', { exact: true }).click();
  await question(page, 'Plant safe to return').getByText('Yes', { exact: true }).click();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByText('Submitted/Awaiting Review').first()).toBeVisible();

  // The person who verified may not approve it; an authorised override is
  // possible, with a reason, and is kept (DFW-006, DFW-009).
  await expect(page.getByText(/another person must approve it/)).toBeVisible();
  await page.getByText('Override separation of duties').click();
  await page.getByRole('textbox', { name: /Reason for the override/ }).fill('Demo: no second approver on site');
  await page.getByRole('button', { name: 'Override and approve' }).click();
  await expect(page.getByText('Approved with a separation-of-duties override')).toBeVisible();

  // Close the Defect: the plant stays out of service until returned (DEF-AC-04).
  await page.getByRole('link', { name: /^DEF-\d{6}$/ }).first().click();
  await page.waitForURL(/\/defects\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Close Defect' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close Defect' }).click();
  await expect(page.getByText('Closed').first()).toBeVisible();
  await expect(page.getByText('The plant is still Restricted/Offline')).toBeVisible();

  await page.getByRole('link', { name: 'plant', exact: true }).click();
  await page.waitForURL(/\/plant\/[0-9a-f-]{36}/);
  await expect(page.getByText('Restricted/Offline').first()).toBeVisible();
  await page.getByRole('button', { name: 'Return to service' }).click();
  const returning = page.getByRole('dialog');
  await returning.getByRole('button', { name: 'Return to service' }).click();
  // Other open Defects from earlier runs keep it Offline: an Admin may
  // override with a reason (DFW-009).
  const override = returning.getByRole('button', { name: 'Override and return' });
  if (await override.isVisible().catch(() => false)) {
    await returning.getByRole('textbox', { name: /Reason for the override/ }).fill('E2E: earlier test Defects');
    await override.click();
    // ...and documents not in order need a review date too (DOC-008).
    const reviewBy = returning.getByRole('textbox', { name: /Review by/ });
    const needsReview = await reviewBy
      .waitFor({ timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (needsReview) {
      await reviewBy.fill(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
      await page.keyboard.press('Tab');
      await override.click();
    }
  }
  await expect(page.getByText('Approved/Online').first()).toBeVisible();

  // The journey is on the plant's history.
  await page.getByRole('tab', { name: 'History' }).click();
  for (const event of [
    'Check submitted',
    'Defect raised',
    'Plant restricted',
    'Defect closed',
    'Plant returned to service',
  ])
    await expect(page.getByRole('cell', { name: event }).first()).toBeVisible();
});

test('Milestone 3: import check templates as Drafts, and open dashboard figures as filtered lists', async ({
  page,
}) => {
  await signIn(page);

  // Template import: preview, then Drafts only (FRD 19.4).
  const name = `E2E import ${Date.now()}`;
  const csv = [
    'Template Name,Purpose,Question,Answer Type,Defect Severity,Follow-up Of Question,Asked When',
    `${name},Operational,Guards fitted,Pass / fail,Major,,`,
    `${name},Operational,Which guard is missing?,Text,,1,Fails`,
  ].join('\n');
  await page.goto(`${WEB}/admin/templates/import`);
  await page.locator('input[type=file]').setInputFiles({
    name: 'templates.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await page.getByRole('button', { name: 'Upload and check' }).click();
  await page.waitForURL(/\/admin\/templates\/import\/[0-9a-f-]{36}$/);
  await expect(page.getByText(name).first()).toBeVisible();
  await page.getByRole('button', { name: /Create 1 Draft template/ }).click();
  await page.getByRole('link', { name: 'Review and publish' }).click();
  await page.waitForURL(/\/admin\/templates\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Draft v1')).toBeVisible();
  await expect(page.getByText('Published v1')).toHaveCount(0);

  // Dashboard figures open their list already filtered (DSH-AC-01).
  await page.goto(`${WEB}/`);
  await expect(page.getByText('Due checks')).toBeVisible();
  await page.getByRole('link', { name: /Due this week/ }).click();
  await page.waitForURL(/\/checks\?view=due/);
  await expect(page.getByRole('button', { name: /Clear filter: Due this week/ })).toBeVisible();
  await page.goto(`${WEB}/`);
  await page.getByRole('link', { name: /Critical/ }).first().click();
  await page.waitForURL(/\/defects\?status=active&severity=critical/);
  await expect(page.getByRole('combobox', { name: 'Severity' })).toHaveValue('Critical');
});
