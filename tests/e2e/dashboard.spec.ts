import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('loads no-key SPY results, preserves hash scenarios, and exposes accessible equivalents', async ({ page }) => {
  await page.goto('/#/')
  await expect(page.getByRole('heading', { name: 'Time in the market—or timing your way in?' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /finished ahead|finished in a tie/ })).toBeVisible()
  await page.getByRole('button', { name: '24' }).click()
  await page.getByRole('button', { name: 'Run comparison' }).click()
  await expect(page).toHaveURL(/purchases=24/)
  await page.reload()
  await expect(page.getByRole('button', { name: '24' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('img', { name: /Account values over time/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'How long could you be underwater?' })).toBeVisible()
  await expect(page.getByText('The hardest historical SPY entry was 2000-03-24')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Distribution of all break-even times' })).toBeVisible()
  await expect(page.getByRole('img', { name: /Histogram comparing break-even times/ })).toBeVisible()
  await expect(page.locator('.break-even-summary').getByText('27.4 days')).toBeVisible()
  await expect(page.locator('.break-even-summary').getByText('3.8 days')).toBeVisible()
  await page.getByText('View break-even distribution as a table').click()
  await expect(page.getByRole('table', { name: 'Break-even distribution data' })).toBeVisible()
  const viewport = page.viewportSize()
  const dashboardWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(dashboardWidth).toBeLessThanOrEqual(viewport!.width)
  await page.getByText('View chart data as a table').click()
  await expect(page.getByRole('region', { name: 'How each account grew' }).getByRole('table')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Every historical starting point' })).toBeVisible()
})

test('imports a valid CSV locally and disables share links', async ({ page }) => {
  await page.goto('/#/')
  await page.getByText('Analyze another ticker with a local CSV').click()
  await page.locator('input[type=file]').setInputFiles({
    name: 'sample.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('date,adjusted_close\n2015-01-02,100\n2025-01-02,200\n2025-01-03,201\n'),
  })
  await page.getByPlaceholder('e.g. VTI').fill('demo')
  await page.getByLabel('These are USD prices adjusted for dividends and splits.').check()
  await page.getByRole('button', { name: 'Use this dataset' }).click()
  await expect(page.getByText(/Testing DEMO/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy share link' })).toBeDisabled()
})

test('refreshes methodology, fits mobile width, and has no serious accessibility violations', async ({ page }) => {
  await page.goto('/#/methodology')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'The rules behind every result.' })).toBeVisible()
  const viewport = page.viewportSize()
  const width = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(width).toBeLessThanOrEqual(viewport!.width)
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([])
})
