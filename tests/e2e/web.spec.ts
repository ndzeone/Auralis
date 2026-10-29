import { expect, test } from '@playwright/test';

test('landing, theme persistence and mobile layout', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Переключить светлую или тёмную тему' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Скачать', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Windows 11', exact: true })).toBeVisible();
});

test('registration, HttpOnly session restore, email verification and login', async ({ page, request }) => {
  const username = `e2e${Date.now().toString(36)}`;
  const email = `${username}@example.test`;
  const password = 'Auralis-e2e-password-2026!';
  await page.goto('/');
  await page.getByRole('button', { name: 'Личный кабинет', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click();
  await dialog.getByLabel('Имя игрока', { exact: true }).fill(username);
  await dialog.getByLabel('Email', { exact: true }).fill(email);
  await dialog.getByLabel('Пароль', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByRole('button', { name: username, exact: true })).toBeVisible();
  const cookies = await page.context().cookies('http://localhost:3001/api/auth/refresh');
  expect(cookies.some(cookie => cookie.httpOnly && /refresh/i.test(cookie.name))).toBe(true);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => /token|password/i.test(key)))).toEqual([]);
  await page.reload();
  await expect(page.getByRole('button', { name: username, exact: true })).toBeVisible();
  // DEV_MAILBOX is available only in local development/test and explicitly enabled in CI.
  const mail = await request.get(`http://localhost:3001/api/dev/mailbox?email=${encodeURIComponent(email)}`);
  expect(mail.ok()).toBe(true);
  const mailbox = await mail.json() as { messages: { to: string; text: string }[] };
  const link = mailbox.messages.find(item => item.to === email)?.text.match(/https?:\/\/\S+/)?.[0];
  expect(link).toBeTruthy();
  await page.goto(link!);
  await expect(page.getByRole('status')).toContainText('Email подтверждён');
  await page.getByRole('button', { name: username, exact: true }).click();
  await expect(dialog.getByText('Email подтверждён', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Тема Forest', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'forest');
  await dialog.getByRole('button', { name: 'Выйти', exact: true }).click();
  await page.getByRole('button', { name: 'Личный кабинет', exact: true }).first().click();
  await dialog.getByLabel('Email или имя игрока', { exact: true }).fill(username);
  await dialog.getByLabel('Пароль', { exact: true }).fill('wrong-password');
  await dialog.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await dialog.getByLabel('Пароль', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('button', { name: username, exact: true })).toBeVisible();
});
