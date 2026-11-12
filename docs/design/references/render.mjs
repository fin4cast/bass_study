import { readFile, writeFile } from 'node:fs/promises';

// Собирает автономный VIS-01 r5 из фрагмента, подготовленного prepare-r5.mjs.
const revision = process.argv[2] || 'r5';
if (revision !== 'r5') throw new Error('Ожидается r5: остальные ревизии грифа удалены из каталога.');
const stem = 'fretboard-r5';
const fragment = await readFile(new URL(`./${stem}.fragment.html`, import.meta.url), 'utf8');
const head = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>VIS-01 ${revision} — UX-референсы грифа bass.study</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; padding: 24px; font: 14px/1.5 'Segoe UI', Arial, sans-serif; background: light-dark(#e8ebe4, #141817); color: light-dark(#252d2b, #edf0e9); }
    .review-shell { max-width: 1440px; margin: auto; }
    .review-header { display: flex; justify-content: space-between; gap: 18px; align-items: center; flex-wrap: wrap; margin-bottom: 20px; }
    .review-header p { margin: 0; font-size: 12px; }
    .review-tabs { display: flex; gap: 8px; flex-wrap: wrap; }
    .review-tabs button { font: inherit; padding: 9px 14px; border: 1px solid light-dark(#c5cdc1, #4a564d); border-radius: 6px; background: light-dark(#f7f8f3, #242d28); color: inherit; cursor: pointer; }
    .review-tabs button[aria-pressed=true] { background: light-dark(#28392e, #dde7da); color: light-dark(#f7f8f3, #242d28); }
    .review-header select { font: inherit; padding: 6px; background: light-dark(#f7f8f3, #242d28); color: inherit; border: 1px solid light-dark(#c5cdc1, #4a564d); border-radius: 4px; }
    .review-footnote { font-size: 12px; margin: 17px 0; color: light-dark(#536355, #b7c5b7); }
    @media (max-width: 600px) { body { padding: 10px; } }
  </style>
</head>
<body>
<div class="review-shell">
  <div class="review-header">
    <div><strong>VIS-01 · Гриф · ${revision}</strong><p>Мастерская · выбранное направление «Связи на грифе» · экран на рассмотрении</p></div>


  </div>
`;
const tail = `
  <p class="review-footnote">Интерактивные UX-референсы, ${revision} · 08.11.2026. Данные занятия не сохраняются, звук и доступ к микрофону не используются. Выбрано направление A3; окончательное утверждение экрана ещё не получено.</p>
</div>
<script>
(() => {



})();
</script>
</body>
</html>
`;

await writeFile(new URL(`./${stem}.html`, import.meta.url), (head + fragment + tail).replace(/[ \t]+$/gm, ''));
console.log(`Собран docs/design/references/${stem}.html — автономный просмотр без внешних ресурсов.`);
