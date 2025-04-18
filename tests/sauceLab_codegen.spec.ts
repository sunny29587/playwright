import { test, expect } from '@playwright/test';

test('Sauce Lab Basic Login Logout', async ({ page }) => {
    // Goto sauce lab url
  await page.goto('https://www.saucedemo.com/');
    // enter user id and pwd
  await page.locator('[data-test="username"]').click();
  await page.locator('[data-test="username"]').fill('standard_user');
  await page.locator('[data-test="password"]').click();
  await page.locator('[data-test="password"]').fill('secret_sauce');
    //click login button
  await page.locator('[data-test="login-button"]').click();
    //open side menu and logout
  await page.getByRole('button', { name: 'Open Menu' }).click();
  await page.locator('[data-test="logout-sidebar-link"]').click();
});