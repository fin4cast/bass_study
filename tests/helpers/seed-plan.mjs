/**
 * План «Сегодня» для сценариев экрана игры: новый день собирает программа (R-028), а сценариям нужен известный план из трёх
 * шагов. Помощник убирает собранные шаги («Изменить план») и добавляет нужные из библиотеки тем же путём, что пользователь («+ в план»).
 */
export const SEED_PLAN = ['Одна нота по всему грифу', 'Октавы: +2 струны, +2 лада', 'Хроматика 1-2-3-4 в позиции'];

export async function seedPlan(page, titles = SEED_PLAN) {
  const home = page.locator('[data-lesson-screen="home"]');
  await home.getByRole('tab', { name: /^Сегодня/ }).click();
  const current = await home.locator('.ls-plan .ls-step-title').allInnerTexts();
  if (current.length === titles.length && titles.every((title, index) => current[index] === title)) return;
  if (current.length) {
    await home.locator('[data-act="edit"]').click();
    for (let left = current.length; left > 0; left--) await home.locator('.ls-plan [data-act="remove"]').first().click();
  }
  await home.getByRole('tab', { name: /^Библиотека/ }).click();
  for (const title of titles) {
    const card = home.locator('.ls-lib-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    const toggle = card.locator('[data-act="toggle-plan"]');
    await toggle.click();
    await page.waitForFunction(element => element.getAttribute('aria-pressed') === 'true', await toggle.elementHandle());
  }
  await home.getByRole('tab', { name: /^Сегодня/ }).click();
}
