/**
 * План «Сегодня» для сценариев экрана игры: на чистом профиле он пуст (занятие собирает программа, R-028),
 * поэтому сценарии, которым нужен план из трёх шагов, добавляют их из библиотеки тем же путём, что пользователь («+ в план»).
 */
export const SEED_PLAN = ['Одна нота по всему грифу', 'Октавы: +2 струны, +2 лада', 'Хроматика 1-2-3-4 в позиции'];

export async function seedPlan(page, titles = SEED_PLAN) {
  const home = page.locator('[data-lesson-screen="home"]');
  await home.getByRole('tab', { name: /^Сегодня/ }).click();
  if ((await home.locator('.ls-plan .ls-step-title').count()) > 0) return;
  await home.getByRole('tab', { name: /^Библиотека/ }).click();
  for (const title of titles) {
    const card = home.locator('.ls-lib-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    const toggle = card.locator('[data-act="toggle-plan"]');
    await toggle.click();
    await page.waitForFunction(element => element.getAttribute('aria-pressed') === 'true', await toggle.elementHandle());
  }
  await home.getByRole('tab', { name: /^Сегодня/ }).click();
}
