import { readFile, writeFile } from 'node:fs/promises';

const revision = process.argv[2] || 'r1';
if (!['r1', 'r2', 'r3', 'r4', 'r5'].includes(revision)) throw new Error('Ожидается r1, r2, r3, r4 или r5.');
const isR4 = revision === 'r4';
const isR5 = revision === 'r5';
const isSingle = isR4 || isR5;
const isR2 = revision === 'r2' || revision === 'r3';
const stem = isR2 || isSingle ? `fretboard-${revision}` : 'fretboard';
const names = isSingle ? ['Связи на грифе'] : isR2 ? ['Точный гриф', 'Инструментальный', 'Связи на грифе'] : ['Мастерская', 'Пошаговое изучение', 'Атлас связей'];
const ids = isSingle ? ['A3'] : isR2 ? ['A1', 'A2', 'A3'] : ['A', 'B', 'C'];
const rootId = isR5 ? 'studio-fretboard-r5' : isR4 ? 'studio-fretboard' : revision === 'r3' ? 'fretboard-readable-study' : isR2 ? 'fretboard-material-study' : 'fretboard-ux-references';
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
    <div><strong>VIS-01 · Гриф · ${revision}</strong><p>${isSingle ? 'Мастерская · выбранное направление «Связи на грифе» · экран на рассмотрении' : `${isR2 ? 'Мастерская · три исполнения грифа' : 'Три UX-кандидата'} · ни один не утверждён`}</p></div>
    ${names.length > 1 ? `<nav class="review-tabs" aria-label="Кандидаты UX">
      ${names.map((name, i) => `<button type="button" data-ref-choice="${i}" aria-pressed="${i === 0}">${name}</button>`).join('\n      ')}
    </nav>` : ''}
    ${isR5 ? '' : '<label>Тема <select id="review-theme"><option value="light dark">Системная</option><option value="light">Светлая</option><option value="dark">Тёмная</option></select></label>'}
  </div>
`;
const tail = `
  <p class="review-footnote">Интерактивные UX-референсы, ${revision} · 08.11.2026. Данные занятия не сохраняются, звук и доступ к микрофону не используются. ${isSingle ? 'Выбрано направление A3; окончательное утверждение экрана ещё не получено.' : 'Выбор вкладки не означает утверждения.'}</p>
</div>
<script>
(() => {
  ${isSingle ? '' : `const variants = Array.from(document.querySelectorAll('#${rootId} > section[data-variant]'));
  const ids = ${JSON.stringify(ids)};
  const buttons = Array.from(document.querySelectorAll('[data-ref-choice]'));
  const show = index => {
    variants.forEach((variant, i) => { variant.hidden = i !== index; });
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
  };
  buttons.forEach((button, i) => button.addEventListener('click', () => {
    show(i);
    history.replaceState(null, '', '#VIS-01-' + ids[i]);
  }));`}
  ${isR5 ? '' : `document.getElementById('review-theme').addEventListener('change', event => {
    document.documentElement.style.colorScheme = event.target.value;
  });`}
  ${isSingle ? '' : `const initial = ids.map(id => '#VIS-01-' + id).indexOf(location.hash);
  show(Math.max(0, initial));`}
})();
</script>
</body>
</html>
`;

await writeFile(new URL(`./${stem}.html`, import.meta.url), (head + fragment + tail).replace(/[ \t]+$/gm, ''));
console.log(`Собран docs/design/references/${stem}.html — автономный просмотр без внешних ресурсов.`);
