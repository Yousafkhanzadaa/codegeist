import { expect, test } from '@playwright/test';

test('local preview labels AI as unavailable and report edits invalidate a prepared review', async ({ page }) => {
  await page.goto('/?demo=1');
  await page.getByLabel('Try a synthetic example').selectOption('precision');
  await page.getByLabel('Expected behavior').fill('Keep two different orders.');
  await page.getByLabel('Observed behavior').fill('The importer collapses them to one.');
  await expect(page.getByText('AI is unavailable in local preview.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Investigate with AI' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Send my report text, field paths and computed observations', exact: false })).toBeDisabled();
  await page.getByRole('button', { name: 'Find supported conditions' }).click();
  await page.getByRole('radio').first().check();
  await page.getByRole('checkbox', { name: 'This is the condition I want' }).check();
  await page.getByRole('button', { name: 'Generate and verify' }).click();
  await expect(page.getByRole('heading', { name: 'The condition survives replacement' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Fixture preparation steps' }).getByRole('button', { name: /Source.*Choose an input/ }).click();
  await page.getByLabel('Expected behavior').fill('The tax should total ten.');
  await expect(page.getByRole('navigation', { name: 'Fixture preparation steps' }).getByRole('button', { name: /Review.*Inspect the fixture/ })).toBeDisabled();
  await expect(page.getByRole('navigation', { name: 'Fixture preparation steps' }).getByRole('button', { name: /Share.*Create a dev issue/ })).toBeDisabled();
});
