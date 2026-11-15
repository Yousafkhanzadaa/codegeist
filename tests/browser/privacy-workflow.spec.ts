import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runVerification } from '../../local/protocol.mjs';

test('an unfixed real bug has consistent reproduced status and requires renewed review', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'reproshare-prefixed-ui-'));
  try {
    await page.goto('/?demo=1');
    await page.getByLabel('Try a synthetic example').selectOption('es-toolkit-deburr');
    await writeFile(join(directory, 'source.json'), await page.getByLabel('Source JSON', { exact: true }).inputValue());
    await page.getByRole('button', { name: 'Check this regression input', exact: true }).click();
    await page.getByRole('radio').first().check();
    await page.getByRole('checkbox', { name: 'This is the condition I want' }).check();
    await page.getByRole('button', { name: 'Generate and verify' }).click();
    await page.getByRole('button', { name: 'Review the output' }).click();
    const pendingInputs = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download check inputs' }).click();
    await (await pendingInputs).saveAs(join(directory, 'verification-inputs.json'));
    const { fixed: ignored, ...oracle } = JSON.parse(await readFile(resolve('vendor/second-case/oracle.json'), 'utf8'));
    await writeFile(join(directory, 'unfixed-oracle.json'), JSON.stringify(oracle));
    const report = await runVerification({ packagePath: join(directory, 'verification-inputs.json'), sourcePath: join(directory, 'source.json'), oraclePath: join(directory, 'unfixed-oracle.json'), cwd: resolve('.'), allowCommand: true });
    expect(report.verdict, report.failures.join(', ')).toBe('verified');
    expect(report.evidenceLevel).toBe('failure-reproduced');
    await page.getByRole('checkbox', { name: 'I reviewed field names and structure.' }).check();
    await page.getByRole('checkbox', { name: 'I reviewed the fixture, report and test.' }).check();
    await page.getByLabel('Import local verification report').setInputFiles({ name: 'local-report.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(report)) });
    await expect(page.getByRole('heading', { name: 'Failure reproduced locally' })).toBeVisible();
    await expect(page.locator('.local-matrix thead')).toContainText('Fix pending');
    await expect(page.locator('.local-matrix tbody')).toContainText('Not checked');
    await expect(page.locator('.application-case-card')).toContainText('fix pending');
    await expect(page.locator('.application-case-card')).not.toContainText('Runner ready—run application check locally');
    await expect(page.getByRole('checkbox', { name: 'I reviewed field names and structure.' })).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Choose a destination' })).toBeDisabled();
    await page.getByRole('button', { name: 'Back to verification' }).click();
    await expect(page.getByRole('heading', { name: 'Failure reproduced locally' })).toBeVisible();
    await expect(page.locator('.proof-summary')).toContainText('fix pending');
    await expect(page.locator('.proof-summary')).not.toContainText('runner ready');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('source values stay masked during disclosure review and out of downloaded fixture after private reveal', async ({ page }) => {
  await page.goto('/?demo=1');
  await page.getByLabel('Try a synthetic example').selectOption('precision');
  const source = JSON.parse(await page.getByLabel('Source JSON', { exact: true }).inputValue());
  const originalStrings: string[] = [];
  function collect(value: unknown) {
    if (typeof value === 'string') originalStrings.push(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  }
  collect(source);
  await page.getByRole('button', { name: 'Find supported conditions' }).click();
  await page.getByRole('radio').first().check();
  await page.getByRole('checkbox', { name: 'This is the condition I want' }).check();
  await page.getByRole('button', { name: 'Generate and verify' }).click();
  await page.getByRole('button', { name: 'Review the output' }).click();
  const review = page.getByRole('region', { name: 'What will leave this issue?' });
  await page.locator('.disclosure-fields > summary').click();
  await expect(review).toContainText('Masked');
  for (const value of originalStrings) await expect(review).not.toContainText(value);
  await page.getByRole('checkbox', { name: 'Show original values privately in this view' }).check();
  for (const value of originalStrings) await expect(review).toContainText(value);
  const directory = await mkdtemp(join(tmpdir(), 'reproshare-private-review-'));
  try {
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await (await downloaded).saveAs(join(directory, 'fixture.json'));
    const fixture = await readFile(join(directory, 'fixture.json'), 'utf8');
    for (const value of originalStrings) expect(fixture).not.toContain(value);
  } finally { await rm(directory, { recursive: true, force: true }); }
  await page.getByLabel('Find a field or retained constant').fill('does-not-exist');
  await expect(review).toContainText('No fields match this filter.');
  await page.getByLabel('Find a field or retained constant').fill('');
  await page.getByRole('checkbox', { name: 'Show retained or reversible information only' }).check();
  await expect(review).toContainText('Information still visible');
});

test('requirements drafting copies structure without private values, while keyboard and zoom keep controls usable', async ({ page }) => {
  await page.goto('/?demo=1');
  await page.getByLabel('Source JSON', { exact: true }).fill(JSON.stringify({ records: [{ id: '9007199254740992', customerEmail: 'private-owner@example.test', enabled: true }, { id: '9007199254740993', customerEmail: 'another-private@example.test', enabled: false }] }));
  await page.getByRole('button', { name: 'Find supported conditions' }).click();
  await page.getByRole('radio').first().check();
  await page.locator('.input-requirements > summary').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Draft requirements from structure' }).click();
  await expect(page.locator('.requirements-draft')).toContainText('customerEmail');
  await expect(page.locator('.requirements-draft')).not.toContainText('private-owner');
  await expect(page.locator('.requirements-draft')).not.toContainText('9007199254740992');
  await page.getByRole('button', { name: 'Use this draft for editing' }).click();
  const contract = await page.getByLabel('Public input contract', { exact: true }).inputValue();
  expect(contract).toContain('customerEmail');
  expect(contract).not.toContain('private-owner');
  expect(contract).not.toContain('9007199254740992');
  await page.getByRole('checkbox', { name: 'This is the condition I want' }).check();
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await page.setViewportSize({ width: 800, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Generate and verify' }).focus();
  await expect(page.getByRole('button', { name: 'Generate and verify' })).toBeFocused();
});
