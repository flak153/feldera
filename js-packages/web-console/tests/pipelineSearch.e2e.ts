import { expect, test } from '@playwright/test'
import { client } from '$lib/services/manager/client.gen'
import { deletePipeline, putPipeline } from '$lib/services/pipelineManager'

const API_ORIGIN = (process.env.PLAYWRIGHT_API_ORIGIN ?? 'http://localhost:8080').replace(/\/$/, '')
client.setConfig({ baseUrl: API_ORIGIN })

const PREFIX = `test-search-${Date.now()}`
const PIPELINES = [`${PREFIX}-alpha`, `${PREFIX}-beta`, `${PREFIX}-gamma`] as const

async function cleanupPipelines() {
  for (const name of PIPELINES) {
    try {
      await deletePipeline(name)
    } catch {
      // Pipeline may not exist
    }
  }
}

/** Navigate to the home page and wait until all test pipelines have compiled and are ready to start. */
async function gotoAndWaitForPipelines(page: import('@playwright/test').Page) {
  await page.goto('/')
  // Wait for every test pipeline to reach "Ready To Start" (Stopped) status.
  // Cannot use networkidle because the pipeline list polls every 2 s.
  for (const name of PIPELINES) {
    const row = page.getByRole('row').filter({ has: page.getByRole('link', { name }) })
    await expect(row.getByText('Ready To Start')).toBeVisible({ timeout: 120_000 })
  }
}

test.describe('Pipeline search', () => {
  test.setTimeout(180_000)

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(120_000)
    await cleanupPipelines()
    for (const name of PIPELINES) {
      await putPipeline(name, {
        name,
        description: `E2E search test pipeline: ${name}`,
        program_code: 'create view test as (select 1)'
      })
    }
  })

  test.afterAll(async ({}, testInfo) => {
    testInfo.setTimeout(60_000)
    await cleanupPipelines()
  })

  test('filters pipelines by name substring', async ({ page }) => {
    await gotoAndWaitForPipelines(page)

    const searchInput = page.getByTestId('input-pipeline-search')
    await searchInput.fill('alpha')

    await expect(page.getByRole('link', { name: `${PREFIX}-alpha` })).toBeVisible()
    await expect(page.getByRole('link', { name: `${PREFIX}-beta` })).not.toBeVisible()
    await expect(page.getByRole('link', { name: `${PREFIX}-gamma` })).not.toBeVisible()
  })

  test('search is case-insensitive', async ({ page }) => {
    await gotoAndWaitForPipelines(page)

    const searchInput = page.getByTestId('input-pipeline-search')
    await searchInput.fill(PREFIX.toUpperCase())

    // All three pipelines share the prefix, so all should be visible
    for (const name of PIPELINES) {
      await expect(page.getByRole('link', { name })).toBeVisible()
    }
  })

  test('shows empty state when no pipelines match', async ({ page }) => {
    await gotoAndWaitForPipelines(page)

    const searchInput = page.getByTestId('input-pipeline-search')
    await searchInput.fill('nonexistent-pipeline-xyz-999')

    await expect(page.getByText('No pipelines found')).toBeVisible()
  })

  test('clearing search shows all pipelines again', async ({ page }) => {
    await gotoAndWaitForPipelines(page)

    const searchInput = page.getByTestId('input-pipeline-search')
    await searchInput.fill('alpha')
    await expect(page.getByRole('link', { name: `${PREFIX}-beta` })).not.toBeVisible()

    await searchInput.clear()

    for (const name of PIPELINES) {
      await expect(page.getByRole('link', { name })).toBeVisible()
    }
  })

  test('search works together with status filter', async ({ page }) => {
    await gotoAndWaitForPipelines(page)

    // All test pipelines should be in "Stopped" (Ready To Start) status
    const statusSelect = page.getByTestId('select-pipeline-status')
    await statusSelect.selectOption('Ready To Start')

    const searchInput = page.getByTestId('input-pipeline-search')
    await searchInput.fill('beta')

    await expect(page.getByRole('link', { name: `${PREFIX}-beta` })).toBeVisible()
    await expect(page.getByRole('link', { name: `${PREFIX}-alpha` })).not.toBeVisible()

    // Switching to a non-matching status should hide everything
    await statusSelect.selectOption('Running')
    await expect(page.getByRole('link', { name: `${PREFIX}-beta` })).not.toBeVisible()
  })
})
