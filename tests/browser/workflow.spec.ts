import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function generate(page: Page, profile = 'precision') {
  await page.goto('/?demo=1');
  await page.getByLabel('Try a synthetic example').selectOption(profile);
  await page.getByRole('button', { name: 'Find supported conditions' }).click();
  await page.getByRole('radio').first().check();
  await page.getByRole('checkbox', { name: 'This is the condition I want' }).check();
  await page.getByRole('button', { name: 'Generate and verify' }).click();
  await expect(page.getByRole('heading', { name: 'The condition survives replacement' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The condition survives replacement' })).toBeFocused();
  await expect(page.locator('.check-result')).toHaveText(['PASS', 'PASS', 'PASS', 'PASS', 'PASS']);
}

test('real precision fixture, executable download, review and simulated Jira share', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await generate(page);
  await expect(page.locator('.comparison-card strong')).toHaveText(['1', '2', '1', '2']);
  await page.screenshot({ path: '/private/tmp/reproshare-verification.png', fullPage: true });
  await page.getByRole('button', { name: 'Review the output' }).click();
  await expect(page.getByRole('button', { name: 'Choose a destination' })).toBeDisabled();
  const directory = await mkdtemp(join(tmpdir(), 'reproshare-browser-'));
  try {
    const fixtureDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await (await fixtureDownload).saveAs(join(directory, 'fixture.json'));
    const fixture = await readFile(join(directory, 'fixture.json'), 'utf8');
    expect(JSON.parse(fixture)).toBeTruthy();
    await page.getByRole('tab', { name: 'Test harness' }).click();
    const harnessDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await (await harnessDownload).saveAs(join(directory, 'repro.mjs'));
    const output = execFileSync(process.execPath, ['repro.mjs', 'fixture.json'], { cwd: directory, encoding: 'utf8' });
    expect(JSON.parse(output)).toMatchObject({ profile: 'precision', expected: 2, synthetic: 1, fixed: 2 });
  } finally { await rm(directory, { recursive: true, force: true }); }
  await page.getByRole('checkbox', { name: 'I reviewed field names and structure.' }).check();
  await page.getByRole('checkbox', { name: 'I reviewed the fixture, report and test.' }).check();
  await expect(page.getByRole('checkbox', { name: 'I reviewed the fixture, report and test.' })).toBeFocused();
  await page.getByRole('button', { name: 'Choose a destination' }).click();
  await page.getByLabel('Destination project').selectOption('preview-dev');
  await page.getByLabel('Issue type', { exact: false }).selectOption('preview-bug');
  await page.getByLabel('Component').selectOption('importer');
  await expect(page.getByRole('checkbox', { name: 'Include a reference' })).not.toBeChecked();
  await page.getByRole('button', { name: 'Review creation details' }).click();
  await expect(page.getByRole('region', { name: 'Confirm issue creation' })).toContainText('Omitted');
  await expect(page.getByRole('heading', { name: 'Confirm the destination and content' })).toBeFocused();
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review creation details' })).toBeFocused();
  await page.getByRole('button', { name: 'Review creation details' }).click();
  await expect(page.getByRole('heading', { name: 'Confirm the destination and content' })).toBeFocused();
  await page.getByRole('button', { name: 'Complete preview' }).click();
  await expect(page.getByRole('heading', { name: 'No live issue created' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Preview complete', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});

for (const [profile, counts] of [
  ['unicode', ['1', '2', '1', '2']],
  ['duplicates', ['3', '3', '3', '2']],
] as const) {
  test(`${profile} uses the actual engine and reports honest comparisons`, async ({ page }) => {
    await generate(page, profile);
    await expect(page.locator('.comparison-card strong')).toHaveText([...counts]);
  });
}

test('rejects duplicate JSON keys and invalidates review after source changes', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 600 });
  await page.goto('/?demo=1');
  await page.getByLabel('Source JSON', { exact: true }).fill('{"id":"a","id":"b"}');
  await page.getByRole('button', { name: 'Find supported conditions' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Find supported conditions' })).toBeInViewport();
  await expect(page.getByRole('heading', { name: 'Prepare a reproducer' })).not.toBeInViewport();
  await page.getByRole('button', { name: 'Find supported conditions' }).click();
  await expect(page.getByRole('alert')).toContainText(/duplicate/i);
  await expect(page.getByRole('alert')).toBeFocused();
  await expect(page.getByRole('alert')).toBeInViewport();
  await generate(page);
  await page.getByRole('navigation', { name: 'Fixture preparation steps' }).getByRole('button', { name: /Source.*Choose an input/ }).click();
  await page.getByLabel('Source JSON', { exact: true }).fill('{"ordinary":"data"}');
  await expect(page.getByLabel('Source JSON', { exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: /Review.*Inspect the fixture/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Share.*Create a dev issue/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Find supported conditions' }).click();
  await expect(page.getByRole('heading', { name: 'No supported condition found' })).toBeVisible();
});

test('mobile workflow fits without horizontal page overflow in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await generate(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/private/tmp/reproshare-mobile-dark.png', fullPage: true });
});
