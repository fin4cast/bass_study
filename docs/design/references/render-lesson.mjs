import { readFile, writeFile } from 'node:fs/promises';

// Собирает автономные VIS-10/VIS-11 r2 из фрагментов prepare-lesson-r2.mjs.
// Над экраном — панель рецензии с темой. r2 объединяет кандидатов r1: вкладки и виды переключаются внутри экрана.
const SCREENS = {
  'lesson-r2-vis10': {
    title: 'VIS-10 r2 — Занятие',
    lead: 'Вкладки «Сегодня / Библиотека / Основы» — сочетание кандидатов A+B+C r1',
    candidates: [],
  },
  'lesson-r2-vis11': {
    title: 'VIS-11 r2 — Экран игры',
    lead: 'EX-1 «Связка форм A→B, пентатоника Am» · виды «Гриф крупно / Таб + гриф / Таб крупно / По памяти»',
    candidates: [],
  },
};

for (const [stem, screen] of Object.entries(SCREENS)) {
  let fragment;
  try { fragment = await readFile(new URL(`./${stem}.fragment.html`, import.meta.url), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') { console.log(`Пропущен ${stem}: сначала prepare-lesson-r2.mjs.`); continue; } throw error; }
  const tabs = screen.candidates.map(([id, label]) => `<button type="button" data-review-candidate="${id}" aria-pressed="false">${label}</button>`).join('');
  const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${screen.title} · bass.study</title>
  <style>
    html,body{margin:0;background:light-dark(#e8ebe4,#141817);color:light-dark(#252d2b,#edf0e9);font:13px/1.4 'Segoe UI',Arial,sans-serif;}
    .review-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid light-dark(#c5cdc1,#4a564d);}
    .review-bar p{margin:0;font-size:12px;opacity:.8;}
    .review-group{display:flex;gap:6px;flex-wrap:wrap;}
    .review-group button{font:inherit;padding:5px 11px;border:1px solid light-dark(#c5cdc1,#4a564d);border-radius:6px;background:light-dark(#f7f8f3,#242d28);color:inherit;cursor:pointer;}
    .review-group button[aria-pressed=true]{background:light-dark(#28392e,#dde7da);color:light-dark(#f7f8f3,#242d28);}
    .review-stage{padding:0;}
    body.is-capture .review-bar{display:none;}
    body:not(.is-capture) #studio-lesson .lr-app{height:calc(100vh - 58px);border-radius:0;border-width:0;}
    body.is-capture #studio-lesson .lr-app{border-radius:0;border-width:0;}
  </style>
</head>
<body>
<div class="review-bar"><div><strong>${screen.title}</strong><p>${screen.lead} · на рассмотрении · звука и сохранения нет</p></div>${tabs ? `<div class="review-group" role="group" aria-label="Кандидат">${tabs}</div>` : ""}<div class="review-group" role="group" aria-label="Тема"><button type="button" data-review-theme="light">Светлая</button><button type="button" data-review-theme="dark">Тёмная</button></div></div>
<div class="review-stage">
${fragment}
</div>
<script>if (new URLSearchParams(location.search).has('capture')) document.body.classList.add('is-capture');</script>
</body>
</html>
`;
  await writeFile(new URL(`./${stem}.html`, import.meta.url), html);
  console.log(`Собран ${stem}.html — автономный просмотр без внешних ресурсов.`);
}
