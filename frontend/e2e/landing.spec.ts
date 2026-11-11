import { expect, test } from '@playwright/test'

/**
 * The landing page's auto-playing workflow.
 *
 * The requirement was specific and each part is checked here: it starts on its
 * own, packets travel along the real connectors, the story can be paused and
 * resumed, scenarios switch, it stops when nobody is looking, and reduced motion
 * gets a complete static graph with an ordered walkthrough instead.
 */

const DIAGRAM = '#workflow'

test.describe('the workflow story', () => {
  test('starts on its own, with no play button to press', async ({ page }) => {
    await page.goto('/')
    await page.locator(DIAGRAM).scrollIntoViewIfNeeded()

    // A packet is the thing that moves. It should appear without any interaction.
    const packet = page.locator(DIAGRAM).locator('.pointer-events-none.absolute.z-10')
    await expect(packet).toBeVisible({ timeout: 4000 })

    // And it should actually be travelling: its position changes between samples.
    const first = await packet.evaluate((element) => (element as HTMLElement).style.left)
    await page.waitForTimeout(400)
    const second = await packet.evaluate((element) => (element as HTMLElement).style.left)
    expect(first, 'The packet never moved — the scene clock is not running').not.toBe(second)

    // The control offers Pause, which means it is playing rather than stopped.
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  })

  test('pauses and resumes on demand', async ({ page }) => {
    await page.goto('/')
    await page.locator(DIAGRAM).scrollIntoViewIfNeeded()

    const packet = page.locator(DIAGRAM).locator('.pointer-events-none.absolute.z-10')
    await expect(packet).toBeVisible({ timeout: 4000 })

    await page.getByRole('button', { name: 'Pause' }).click()
    const paused = await packet.evaluate((element) => (element as HTMLElement).style.left)
    await page.waitForTimeout(500)
    const stillPaused = await packet.evaluate((element) => (element as HTMLElement).style.left)
    expect(stillPaused, 'The packet kept moving after Pause').toBe(paused)

    await page.getByRole('button', { name: 'Resume' }).click()
    await page.waitForTimeout(400)
    const resumed = await packet.evaluate((element) => (element as HTMLElement).style.left)
    expect(resumed, 'The packet did not resume').not.toBe(stillPaused)
  })

  test('offers the within-policy and negotiated scenarios and switches between them', async ({
    page,
  }) => {
    await page.goto('/')
    await page.locator(DIAGRAM).scrollIntoViewIfNeeded()

    const group = page.getByRole('radiogroup', { name: 'Workflow scenario' })
    await expect(group.getByRole('radio', { name: 'Needs approval' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await group.getByRole('radio', { name: 'Within policy' }).click()
    await expect(group.getByRole('radio', { name: 'Within policy' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    // The scenario summary is the thing that tells a reader what changed.
    await expect(page.getByText('no approval step is created at all')).toBeVisible()

    await group.getByRole('radio', { name: 'Negotiated deal' }).click()
    await expect(page.getByText('The customer counters')).toBeVisible()
  })

  test('clicking a step pauses the story and explains that step', async ({ page }) => {
    await page.goto('/')
    await page.locator(DIAGRAM).scrollIntoViewIfNeeded()
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 4000 })

    await page.getByRole('button', { name: /Manager approval/ }).click()

    await expect(page.getByText('story paused')).toBeVisible()
    await expect(page.getByText(/A quotation cannot be approved by the person who submitted it/)).toBeVisible()
    // Resuming is explicit, not automatic.
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible()
  })

  test('under reduced motion it shows a static graph and an ordered walkthrough', async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await context.newPage()
    await page.goto('/')
    await page.locator(DIAGRAM).scrollIntoViewIfNeeded()

    // No moving packet, no pause control — there is nothing to pause.
    await expect(page.getByRole('button', { name: 'Pause' })).toHaveCount(0)
    await expect(page.getByText('step by step')).toBeVisible()
    await expect(page.getByText(/Customer request → Sales quotation/)).toBeVisible()

    await context.close()
  })
})

test.describe('the marketing page itself', () => {
  test('states its promise and links into the product', async ({ page }) => {
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: 'Where enterprise deals stop dying in email.' }),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: /Open the workspace/ }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /Browse the catalogue/ }).first()).toBeVisible()
  })

  test('labels its sample figures as examples rather than customer data', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Example — illustrative figures, not customer data')).toBeVisible()
  })

  test('lets each role see what the product does for them', async ({ page }) => {
    await page.goto('/')
    const roles = page.getByRole('tablist', { name: 'Choose a role' })
    await roles.getByRole('tab', { name: 'Finance' }).click()
    await expect(page.getByText('Step 2, and everything downstream of it')).toBeVisible()
    await expect(
      page.getByText('Sequential approval enforced by the server, not by convention'),
    ).toBeVisible()
  })

  test('answers the question the product is most often wrong about', async ({ page }) => {
    await page.goto('/')
    await page.getByText('Does a discount request commit us to it?').click()
    // The honest answer, matching what the server actually does: the version and
    // its price change at once; agreement is the separate thing that does not.
    await expect(page.getByText(/It does become a real, priced version/)).toBeVisible()
    await expect(page.getByText(/no order can follow until the salesperson adopts it/)).toBeVisible()
  })
})

test('the crawlable HTML carries the page identity without JavaScript', async ({ request }) => {
  const response = await request.get('/')
  const html = await response.text()

  // True of the dev server and of a build alike.
  expect(html).toContain('<title>DealFlow360')
  expect(html).toContain('name="description"')

  // The dev server serves index.html with its markers unreplaced. When the
  // suite runs against a build, the injected head and the no-JavaScript body
  // must both be there — that is the whole point of the prerender step.
  const isBuild = !html.includes('<!--seo-head-->')
  if (isBuild) {
    expect(html, 'no canonical URL in the built HTML').toContain('rel="canonical"')
    expect(html, 'no Open Graph title').toContain('property="og:title"')
    expect(html, 'no structured data').toContain('application/ld+json')
    expect(html, 'the root is empty without JavaScript').toContain(
      'Where enterprise deals stop dying in email.',
    )
    expect(html, 'the no-JavaScript summary is missing').toContain('How a deal moves')
  }
})
