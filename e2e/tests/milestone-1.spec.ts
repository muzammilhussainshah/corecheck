import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { generate } from 'otplib';

const ADMIN = 'http://localhost:3200';
const WEB = 'http://localhost:3100';

interface StaffAccount {
  email: string;
  password: string;
  secret: string;
}

/** A fresh owner with MFA enrolled, created by the API's helper script. */
const createOwner = (): StaffAccount => {
  const output = execFileSync('npx', ['tsx', 'scripts/e2e-staff.ts'], {
    cwd: resolve(import.meta.dirname, '../../apps/api'),
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return JSON.parse(output.trim().split('\n').pop()!) as StaffAccount;
};

const typePin = async (page: Page, label: string, pin: string) => {
  await page.getByLabel(`${label} digit 1 of 6`, { exact: true }).click();
  await page.keyboard.type(pin);
};

const staffSignIn = async (page: Page, owner: StaffAccount) => {
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel('Email').fill(owner.email);
  await page.getByRole('textbox', { name: 'Password' }).fill(owner.password);
  await page.getByRole('button', { name: 'Continue' }).click();
  const portal = page.getByRole('heading', { name: 'Organisations' });
  const codePrompt = page.getByText('Enter the 6-digit code');
  // The code step appears only when the API runs with STAFF_MFA_REQUIRED=true.
  await expect(portal.or(codePrompt)).toBeVisible();
  if (await codePrompt.isVisible()) {
    await typePin(
      page,
      'Authenticator code',
      await generate({ secret: owner.secret }),
    );
    await page.getByRole('button', { name: 'Verify' }).click();
  }
  await expect(
    page.getByRole('heading', { name: 'Organisations' }),
  ).toBeVisible();
};

test('Milestone 1: provision an organisation, sign in with a temporary PIN, administer users, suspend', async ({
  browser,
}) => {
  const owner = createOwner();
  const orgName = `E2E Org ${Date.now()}`;

  // ---------------------------------------------------- internal admin portal
  const staff = await browser.newPage();
  await staffSignIn(staff, owner);
  await staff.getByRole('link', { name: 'New organisation' }).click();
  await staff.getByLabel('Organisation name').fill(orgName);
  await staff.getByLabel('Industry').fill('Construction');
  await staff.getByLabel('Address').fill('1 Test Street, Leeds');
  await staff
    .getByRole('textbox', { name: 'Name', exact: true })
    .fill('Pat Contact');
  await staff
    .getByRole('textbox', { name: 'Email', exact: true })
    .fill('pat@example.com');
  await staff.getByLabel('Telephone').fill('+44 20 7946 0000');
  await staff.getByLabel('First name').fill('Erin');
  await staff.getByLabel('Last name').fill('Endtoend');
  await staff.getByRole('button', { name: 'Create organisation' }).click();

  await expect(
    staff.getByRole('heading', { name: `${orgName} is ready` }),
  ).toBeVisible();
  const rows = staff.locator('table').first();
  const username = (
    await rows
      .locator('tr')
      .nth(0)
      .locator('td')
      .nth(1)
      .locator('p')
      .first()
      .innerText()
  ).trim();
  // The PIN is masked until revealed.
  await staff.getByRole('button', { name: 'Show PIN' }).click();
  const temporaryPin = (
    await rows
      .locator('tr')
      .nth(1)
      .locator('td')
      .nth(1)
      .locator('p')
      .first()
      .innerText()
  ).trim();
  expect(username).toMatch(/^erinendtoend\d{2,3}$/);
  expect(temporaryPin).toMatch(/^\d{6}$/);

  // ------------------------------------------------------ customer web app
  const web = await browser.newPage();
  await web.goto(`${WEB}/admin/users`);
  await expect(web).toHaveURL(/\/login/);
  await web.getByLabel('Username').fill(username);
  await typePin(web, 'PIN', temporaryPin);
  await web.getByRole('button', { name: 'Sign in' }).click();

  await expect(
    web.getByRole('heading', { name: 'Choose your PIN' }),
  ).toBeVisible();
  await typePin(web, 'Temporary PIN', temporaryPin);
  await typePin(web, 'New PIN', '258147');
  await typePin(web, 'Confirm new PIN', '258147');
  await web.getByRole('button', { name: 'Set my PIN' }).click();
  await expect(web.getByRole('heading', { name: /, Erin/ })).toBeVisible();

  await web.getByRole('link', { name: 'Users' }).first().click();
  await expect(web.getByRole('heading', { name: 'Users' })).toBeVisible();
  await expect(web.getByText('1 of 10 licensed seats in use')).toBeVisible();
  await web.getByRole('button', { name: 'Add New User' }).click();
  await expect(web.getByRole('heading', { name: 'New user' })).toBeVisible();
  await web.getByLabel('First name').fill('Olu');
  await web.getByLabel('Last name').fill('Operative');
  await web.getByRole('combobox', { name: 'Role' }).click();
  await web.getByRole('option', { name: 'Operative' }).click();
  await web.getByRole('button', { name: 'Create user' }).click();
  await expect(web.getByText('Shown only once')).toBeVisible();
  await web.getByRole('button', { name: 'Back to users' }).click();
  await expect(
    web.getByRole('cell', { name: /Olu Operative/ }).first(),
  ).toBeVisible();

  await web.getByRole('link', { name: 'Roles' }).click();
  for (const role of [
    'Operative',
    'Technician',
    'Supervisor',
    'Manager',
    'Admin',
  ]) {
    await expect(
      web.getByRole('cell', { name: new RegExp(`^${role}`) }).first(),
    ).toBeVisible();
  }

  await web.getByRole('link', { name: 'Security audit' }).click();
  await expect(web.getByText('User created').first()).toBeVisible();
  await expect(web.getByText('PIN changed').first()).toBeVisible();

  // --------------------------------- suspension ends the customer session
  await staff
    .getByRole('navigation', { name: 'Main menu' })
    .getByRole('link', { name: 'Organisations' })
    .click();
  await staff
    .getByPlaceholder('Search name, contact or industry')
    .fill(orgName);
  await staff.getByText(orgName).click();
  await expect(staff.getByRole('heading', { name: orgName })).toBeVisible();
  await staff.getByRole('button', { name: 'Suspend', exact: true }).click();
  await staff
    .getByLabel('Reason (recorded in the audit trail)')
    .fill('E2E test');
  await staff
    .getByRole('dialog')
    .getByRole('button', { name: 'Suspend' })
    .click();
  await expect(staff.getByText('Suspended').first()).toBeVisible();

  await web.getByRole('link', { name: 'Users' }).first().click();
  await expect(web).toHaveURL(/\/login\?reason=ORG_SUSPENDED/);
  await expect(web.getByText('is suspended')).toBeVisible();
});
