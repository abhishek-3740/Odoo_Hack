import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('landing workflow, team views and catalog navigation are accessible at every breakpoint', async ({ page }) => {
  const errors=[]; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading',{level:1})).toHaveText('Good deals deservea better flow.');
  await page.getByRole('button',{name:'Within policy',exact:true}).click();
  await expect(page.locator('.node-review')).toContainText('Skipped when within policy');
  await page.locator('.node-review').click();
  await expect(page.locator('.workflow-inspector')).toContainText('no exception approval is required');
  await page.getByRole('button',{name:'Needs review',exact:true}).click();
  await page.locator('.node-review').click();
  await expect(page.locator('.workflow-inspector')).toContainText('required sequential approval');
  await page.getByRole('button',{name:'Customers',exact:true}).click();
  await expect(page.locator('.role-content')).toContainText('A conversation, with everything in view.');
  for(const width of [320,768,1024,1440]) {
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1)).toBeTruthy();
    const audit = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    expect(audit.violations).toEqual([]);
    await page.screenshot({path:`test-results/landing-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:320,height:850});
  await page.getByRole('button',{name:'Open navigation'}).click();
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Catalogue',exact:true}).click();
  await expect(page).toHaveURL(/\/catalog$/);
  expect(errors).toEqual([]);
});
