import './styles.css';
import { mountTraining } from './ui/training';
import {
  STRUCTURES,
  annotatePositions,
  createStructure,
  formatMidi,
  getPositions,
  type LabelMode,
  type StringId,
  type StructureId,
} from './music';

type AnnotatedPosition = ReturnType<typeof annotatePositions>[number];
const STRING_ORDER: StringId[] = ['G', 'D', 'A', 'E'];
const ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const ROOT_LABELS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const state = {
  root: 'A',
  structureId: 'minor-pentatonic' as StructureId,
  labelMode: 'notes' as LabelMode,
  strings: [...STRING_ORDER],
  fretMin: 0,
  fretMax: 12,
  selectedId: 'E:5' as string | null,
  activeId: 'E:5' as string | null,
};

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Не найден контейнер приложения #app.');

app.innerHTML = `
  <div class="app-shell">
    <header class="site-header">
      <a class="brand" href="#" aria-label="bass.study — к началу страницы"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>bass<span class="brand-dot">.</span>study</a>
      <span class="header-caption">Личный тренажёр бас-гитары</span>
      <span class="local-badge"><span aria-hidden="true"></span>Локально</span>
    </header>

    <main>
      <section class="intro" aria-labelledby="page-title">
        <div><p class="eyebrow">ГРИФ · НОТЫ · СТУПЕНИ</p><h1 id="page-title">Изучи гриф.<br><span>Найди связи.</span></h1></div>
        <div class="intro-copy"><p>Выбери тональность и структуру.<br>Нажми на позицию, чтобы узнать ноту<br class="desktop-break"> и увидеть, где она повторяется.</p><div class="instrument-chips"><span>4 струны</span><span>E–A–D–G</span></div></div>
      </section>

      <section class="workspace" aria-label="Изучение грифа">
        <div class="settings-panel">
          <div class="section-title"><span class="section-number">01</span><h2>Что изучаем</h2></div>
          <div class="musical-controls">
            <label class="field root-field" for="root-note"><span>Тоника</span><select id="root-note" aria-label="Тоника">${ROOTS.map((root, i) => `<option value="${root}"${root === state.root ? ' selected' : ''}>${ROOT_LABELS[i]}</option>`).join('')}</select></label>
            <label class="field structure-field" for="structure"><span>Структура</span><select id="structure" aria-label="Структура">${STRUCTURES.map(item => `<option value="${item.id}"${item.id === state.structureId ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label>
            <fieldset class="label-field"><legend>Подписи на грифе</legend><div class="segmented" aria-label="Подписи на грифе"><button type="button" data-label-mode="notes" aria-pressed="true">Ноты</button><button type="button" data-label-mode="degrees" aria-pressed="false">Ступени</button><button type="button" data-label-mode="hidden" aria-pressed="false">Без подписей</button></div></fieldset>
          </div>
          <div class="scope-controls">
            <fieldset class="string-field"><legend>Струны</legend><div class="string-switches">${STRING_ORDER.map(string => `<label class="string-switch"><input type="checkbox" value="${string}" aria-label="Струна ${string}" checked><span>${string}</span></label>`).join('')}</div></fieldset>
            <fieldset class="range-field"><legend>Лады <span class="range-hint">включая границы</span></legend><div class="range-inputs"><label><span class="sr-only">Первый лад</span><input id="fret-min" aria-label="Первый лад" type="number" min="0" max="24" step="1" value="0"></label><span class="range-dash" aria-hidden="true">—</span><label><span class="sr-only">Последний лад</span><input id="fret-max" aria-label="Последний лад" type="number" min="0" max="24" step="1" value="12"></label></div></fieldset>
            <div class="range-presets" aria-label="Быстрый диапазон"><button type="button" data-range="0,5">0–5</button><button type="button" data-range="0,12" aria-pressed="true">0–12</button><button type="button" data-range="12,24">12–24</button></div>
            <p class="range-description">Лад 0 — открытая струна.<br>Модель грифа: 0–24 лада.</p>
          </div>
          <p id="range-error" class="range-error" data-testid="range-error" role="alert" hidden></p>
        </div>

        <div class="structure-summary">
          <div><p class="eyebrow summary-eyebrow">ВЫБРАННАЯ СТРУКТУРА</p><h2 id="structure-heading"></h2></div>
          <div id="structure-notes" class="note-pills" data-testid="structure-notes" aria-label="Ноты выбранной структуры"></div>
          <div class="formula"><span>Формула</span><strong id="structure-formula" data-testid="structure-formula"></strong></div>
        </div>

        <div id="training-mount"></div>
        <div class="fretboard-section">
          <div class="board-header"><div class="section-title"><span class="section-number">02</span><h2>Исследуй позиции</h2></div><span id="position-count" class="position-count"></span></div>
          <div class="board-scroll" id="board-scroll"><div id="fretboard-container"></div></div>
          <div class="board-footer"><div class="legend"><span><i class="legend-root" aria-hidden="true"></i>Тоника</span><span><i class="legend-note" aria-hidden="true"></i>Нота структуры</span><span><i class="legend-selected" aria-hidden="true"></i>Выбранная позиция</span></div><p class="board-navigation">Стрелки — перемещение · Enter / пробел — выбрать</p></div>
        </div>
      </section>

      <section class="selection-section" aria-label="Выбранная нота и её связи"><div id="selection-detail" data-testid="selection-detail"></div><div id="connections" class="connections"></div></section>
      <p id="selection-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p>
      <footer class="page-footer"><span>Маленький участок. Понятная структура. Больше уверенности на грифе.</span><span>E1 · A1 · D2 · G2</span></footer>
    </main>
  </div>
`;

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const rootSelect = byId<HTMLSelectElement>('root-note');
const structureSelect = byId<HTMLSelectElement>('structure');
const minInput = byId<HTMLInputElement>('fret-min');
const maxInput = byId<HTMLInputElement>('fret-max');
const container = byId('fretboard-container');
let positions: readonly AnnotatedPosition[] = [];
let structure = createStructure(state.root, state.structureId);
let training: ReturnType<typeof mountTraining> | undefined;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function positionLabel(position: AnnotatedPosition): string {
  return `${formatMidi(position.midi, position.noteName)}, струна ${position.string}, ${position.fret === 0 ? 'открытая струна, лад 0' : `лад ${position.fret}`}${position.isRoot ? ', тоника' : position.inStructure ? `, ступень ${position.degree}` : ', вне выбранной структуры'}`;
}

function updateView(announce = false) {
  structure = createStructure(state.root, state.structureId);
  positions = annotatePositions(getPositions({ strings: state.strings, fretMin: state.fretMin, fretMax: state.fretMax }), structure);
  if (!positions.some(position => position.id === state.selectedId)) {
    state.selectedId = (positions.find(position => position.isRoot) ?? positions.find(position => position.inStructure) ?? positions[0])?.id ?? null;
  }
  if (!positions.some(position => position.id === state.activeId)) state.activeId = state.selectedId;

  byId('structure-heading').textContent = `${structure.root} · ${structure.name}`;
  byId('structure-formula').textContent = structure.formula;
  byId('structure-notes').innerHTML = structure.notes.map((note, index) => `<span class="note-pill${index === 0 ? ' is-root' : ''}" data-scale-note="${escapeHtml(note.name)}" data-degree="${escapeHtml(note.degree)}"><strong>${escapeHtml(note.name)}</strong><small>${escapeHtml(note.degree)}</small></span>`).join('');
  const included = positions.filter(position => position.inStructure).length;
  byId('position-count').textContent = `${included} в структуре / ${positions.length} позиций`;
  document.querySelectorAll<HTMLButtonElement>('[data-label-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.labelMode === state.labelMode)));
  document.querySelectorAll<HTMLButtonElement>('[data-range]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.range === `${state.fretMin},${state.fretMax}`)));
  renderBoard();
  renderSelection(announce);
  training?.refreshContext();
}

function renderBoard() {
  if (positions.length === 0) {
    container.innerHTML = '<div class="empty-state" data-testid="empty-state"><span class="empty-strings" aria-hidden="true">— — — —</span><h3>Выбери хотя бы одну струну</h3><p>Гриф появится здесь. Тональность и диапазон сохраняются.</p></div>';
    return;
  }
  const rows = STRING_ORDER.filter(string => state.strings.includes(string));
  const columnCount = state.fretMax - state.fretMin + 1;
  const cell = 72;
  const left = 82;
  const right = 24;
  const top = 58;
  const rowGap = 72;
  const width = left + columnCount * cell + right;
  const height = top + (rows.length - 1) * rowGap + 58;
  const x = (fret: number) => left + (fret - state.fretMin + 0.5) * cell;
  const y = (string: StringId) => top + rows.indexOf(string) * rowGap;
  const frets = Array.from({ length: columnCount }, (_, index) => index + state.fretMin);
  const selected = positions.find(position => position.id === state.selectedId);
  container.innerHTML = `<svg class="fretboard" data-testid="fretboard" viewBox="0 0 ${width} ${height}" style="min-width:${Math.max(740, width)}px" aria-labelledby="board-title board-description">
    <title id="board-title">Гриф четырёхструнного баса</title><desc id="board-description">Струны сверху вниз G, D, A, E. Выберите позицию мышью или перейдите стрелками и нажмите Enter. Лады от ${state.fretMin} до ${state.fretMax} включительно.</desc>
    <defs><linearGradient id="board-grain" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#303a39"/><stop offset="1" stop-color="#252f2e"/></linearGradient></defs>
    <rect class="board-surface" x="${left}" y="24" width="${columnCount * cell}" height="${height - 48}" rx="3" fill="url(#board-grain)"/>
    ${frets.map(fret => `<text class="fret-number" x="${x(fret)}" y="15" text-anchor="middle">${fret === 0 ? '0' : fret}</text><line class="fret-wire${fret === 0 ? ' nut-line' : ''}" x1="${left + (fret - state.fretMin + 1) * cell}" y1="24" x2="${left + (fret - state.fretMin + 1) * cell}" y2="${height - 24}"/>`).join('')}
    ${frets.filter(fret => [3, 5, 7, 9, 12, 15, 17, 19, 21, 24].includes(fret)).map(fret => fret % 12 === 0 ? `<circle class="fret-inlay" cx="${x(fret) - 5}" cy="${height - 34}" r="2.5"/><circle class="fret-inlay" cx="${x(fret) + 5}" cy="${height - 34}" r="2.5"/>` : `<circle class="fret-inlay" cx="${x(fret)}" cy="${height - 34}" r="2.5"/>`).join('')}
    ${rows.map(string => `<text class="string-name" x="27" y="${y(string) + 5}" text-anchor="middle">${string}</text><text class="string-caption" x="27" y="${y(string) + 22}" text-anchor="middle">${({ G: '1', D: '2', A: '3', E: '4' })[string]}</text><line class="bass-string string-${string}" x1="${left - 17}" y1="${y(string)}" x2="${width - right}" y2="${y(string)}"/>`).join('')}
    ${positions.map(position => {
      const text = state.labelMode === 'notes' ? position.noteName : position.degree ?? '';
      const samePitch = selected && selected.midi === position.midi && selected.id !== position.id;
      const isSelected = selected?.id === position.id;
      return `<g role="button" class="position${position.inStructure ? ' in-structure' : ' outside-structure'}${position.isRoot ? ' root-position' : ''}${isSelected ? ' selected-position' : ''}${samePitch ? ' same-pitch-position' : ''}" data-position="${position.id}" data-note-name="${escapeHtml(position.noteName)}" data-midi="${position.midi}" data-root="${position.isRoot}" data-in-structure="${position.inStructure}" transform="translate(${x(position.fret)},${y(position.string)})" tabindex="${position.id === state.activeId ? 0 : -1}" aria-label="${escapeHtml(positionLabel(position))}" aria-pressed="${isSelected}">
        <title>${escapeHtml(positionLabel(position))}</title>
        <rect class="position-hit" x="-34" y="-31" width="68" height="62" rx="5"/>
        <circle class="position-focus" r="29"/><circle class="position-selection" r="25"/>
        <circle class="note-marker" r="${position.inStructure ? 19 : 5}"/>
        ${position.isRoot ? '<circle class="root-ring" r="15"/>' : ''}
        ${state.labelMode !== 'hidden' && position.inStructure ? `<text data-position-label text-anchor="middle" dy=".35em">${escapeHtml(text)}</text>` : ''}
      </g>`;
    }).join('')}
  </svg>`;
}

function renderSelection(announce: boolean) {
  const selected = positions.find(position => position.id === state.selectedId);
  if (!selected) {
    byId('selection-detail').innerHTML = '<div class="selection-card selection-empty"><p class="eyebrow">ВЫБРАННАЯ ПОЗИЦИЯ</p><h2>Пока нет позиции</h2><p>Включи струну, чтобы продолжить исследование.</p></div>';
    byId('connections').innerHTML = '';
    if (announce) byId('selection-status').textContent = 'Нет доступных позиций. Выберите хотя бы одну струну.';
    return;
  }
  const fullName = formatMidi(selected.midi, selected.noteName);
  const samePitch = positions.filter(position => position.midi === selected.midi && position.id !== selected.id);
  const otherOctaves = positions.filter(position => position.pitchClass === selected.pitchClass && position.midi !== selected.midi);
  byId('selection-detail').innerHTML = `<div class="selection-card"><div class="selected-heading"><p class="eyebrow">ВЫБРАННАЯ ПОЗИЦИЯ</p><span class="selection-kind${selected.isRoot ? ' is-root' : selected.inStructure ? '' : ' outside'}">${selected.isRoot ? 'Тоника' : selected.inStructure ? `Ступень ${escapeHtml(selected.degree ?? '')}` : 'Вне структуры'}</span></div><div class="selected-note"><h2>${escapeHtml(fullName)}</h2><div><strong>Струна ${selected.string} · ${selected.fret === 0 ? 'открытая' : `лад ${selected.fret}`}</strong><span>${selected.inStructure ? `Входит в ${structure.root} · ${escapeHtml(structure.name.toLowerCase())}` : 'Не входит в выбранную структуру'}</span></div></div><dl class="note-facts"><div><dt>Звучащая высота</dt><dd>${escapeHtml(fullName)}</dd></div><div><dt>MIDI</dt><dd>${selected.midi}</dd></div><div><dt>Частота</dt><dd>${selected.frequency.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Гц</dd></div></dl></div>`;
  byId('connections').innerHTML = `<div class="connections-heading"><span class="section-number">03</span><h2>Та же нота — разные места</h2></div><p class="connections-intro">Связи в выбранном диапазоне. Одинаковая высота и другая октава — разные случаи.</p><div class="connection-group"><h3>Та же высота <span>${samePitch.length}</span></h3><div class="connection-buttons">${connectionButtons(samePitch, 'same') || '<p class="no-connections">Других позиций в этом диапазоне нет.</p>'}</div></div><div class="connection-group"><h3>Другие октавы <span>${otherOctaves.length}</span></h3><div class="connection-buttons">${connectionButtons(otherOctaves, 'octave') || '<p class="no-connections">Другие октавы вне выбранной области.</p>'}</div></div>`;
  if (announce) byId('selection-status').textContent = positionLabel(selected);
}

function connectionButtons(items: readonly AnnotatedPosition[], kind: string): string {
  return [...items].sort((a, b) => a.midi - b.midi || STRING_ORDER.indexOf(a.string) - STRING_ORDER.indexOf(b.string)).map(position => `<button class="connection-button" type="button" data-connect="${position.id}" data-connection-kind="${kind}"><strong>${escapeHtml(formatMidi(position.midi, position.noteName))}</strong><span>${position.string} · ${position.fret === 0 ? 'откр.' : `${position.fret} лад`}</span><span aria-hidden="true">↗</span></button>`).join('');
}

function focusPosition(id: string, scroll = false) {
  state.activeId = id;
  container.querySelectorAll<SVGGElement>('[data-position]').forEach(element => element.setAttribute('tabindex', element.dataset.position === id ? '0' : '-1'));
  const element = [...container.querySelectorAll<SVGGElement>('[data-position]')].find(item => item.dataset.position === id);
  element?.focus({ preventScroll: true });
  if (scroll) element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function selectPosition(id: string, focus = true) {
  if (!positions.some(position => position.id === id)) return;
  state.selectedId = id;
  state.activeId = id;
  renderBoard();
  renderSelection(true);
  if (focus) focusPosition(id, true);
}

rootSelect.addEventListener('change', () => { state.root = rootSelect.value; updateView(true); });
structureSelect.addEventListener('change', () => { state.structureId = structureSelect.value as StructureId; updateView(true); });
document.querySelectorAll<HTMLButtonElement>('[data-label-mode]').forEach(button => button.addEventListener('click', () => {
  state.labelMode = button.dataset.labelMode as LabelMode;
  updateView();
}));
document.querySelectorAll<HTMLInputElement>('.string-switch input').forEach(input => input.addEventListener('change', () => {
  state.strings = [...document.querySelectorAll<HTMLInputElement>('.string-switch input:checked')].map(item => item.value as StringId);
  updateView(true);
}));

function rangeIsValid() {
  const min = Number(minInput.value);
  const max = Number(maxInput.value);
  return minInput.value !== '' && maxInput.value !== '' && Number.isInteger(min) && Number.isInteger(max) && min >= 0 && max <= 24 && min <= max;
}

function applyRange() {
  const min = Number(minInput.value);
  const max = Number(maxInput.value);
  const valid = rangeIsValid();
  byId('range-error').hidden = valid;
  minInput.setAttribute('aria-invalid', String(!valid));
  maxInput.setAttribute('aria-invalid', String(!valid));
  if (!valid) {
    byId('range-error').textContent = 'Укажи целые лады от 0 до 24: первый не больше последнего. На грифе сохранён последний корректный диапазон.';
    training?.refreshContext();
    return;
  }
  state.fretMin = min;
  state.fretMax = max;
  updateView(true);
}
minInput.addEventListener('input', applyRange);
maxInput.addEventListener('input', applyRange);
document.querySelectorAll<HTMLButtonElement>('[data-range]').forEach(button => button.addEventListener('click', () => {
  const [min, max] = button.dataset.range!.split(',');
  minInput.value = min!;
  maxInput.value = max!;
  applyRange();
}));
container.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target.closest<SVGGElement>('[data-position]') : null;
  if (target?.dataset.position) selectPosition(target.dataset.position);
});
container.addEventListener('keydown', event => {
  const target = event.target instanceof Element ? event.target.closest<SVGGElement>('[data-position]') : null;
  const current = positions.find(position => position.id === target?.dataset.position);
  if (!current) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    selectPosition(current.id);
    return;
  }
  const rows = STRING_ORDER.filter(string => state.strings.includes(string));
  let nextString = current.string;
  let nextFret = current.fret;
  switch (event.key) {
    case 'ArrowLeft': nextFret = Math.max(state.fretMin, current.fret - 1); break;
    case 'ArrowRight': nextFret = Math.min(state.fretMax, current.fret + 1); break;
    case 'ArrowUp': nextString = rows[Math.max(0, rows.indexOf(current.string) - 1)]!; break;
    case 'ArrowDown': nextString = rows[Math.min(rows.length - 1, rows.indexOf(current.string) + 1)]!; break;
    case 'Home': nextFret = state.fretMin; break;
    case 'End': nextFret = state.fretMax; break;
    default: return;
  }
  event.preventDefault();
  focusPosition(`${nextString}:${nextFret}`, true);
});
byId('connections').addEventListener('click', event => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-connect]') : null;
  if (button?.dataset.connect) selectPosition(button.dataset.connect);
});

updateView();
training = mountTraining(byId('training-mount'), () => ({ positions: rangeIsValid() ? positions : [], structure }), {
  onModeChange(mode) {
    const quiz = mode === 'quiz';
    document.querySelector<HTMLElement>('.fretboard-section')!.hidden = quiz;
    document.querySelector<HTMLElement>('.selection-section')!.hidden = quiz;
    document.querySelector<HTMLElement>('.structure-summary')!.hidden = quiz;
    document.querySelector<HTMLElement>('.label-field')!.hidden = quiz;
  },
});
