import { renderPageHeader, renderPageSettingsButton } from '../app/page-frame';
import { STRUCTURES, formatMidi, type AnnotatedPosition, type MusicalStructure, type StringId, type StructureId } from '../music';
import { getBoxCatalogue, getBoxInstance, type BoxInstance, type BoxSelection } from '../music/boxes';
import { escapeHtml } from './html';

/** Разметка и подписи раздела «Гриф» (атлас); состояние и обработчики — в `ui/foundation.ts`. */

export const STRING_ORDER: StringId[] = ['G', 'D', 'A', 'E'];
const ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const ROOT_LABELS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export function boxLabel(box: BoxInstance): string {
  return box.selection.shapeId.startsWith('penta-') ? `Форма ${box.selection.shapeId.slice(-1).toUpperCase()} · ${box.window.fretMin}–${box.window.fretMax}` : `${box.label} · ${box.selection.anchorString}`;
}

export function boxOptionsMarkup(boxes: readonly BoxInstance[], selected: BoxSelection | null): string {
  return '<option value="">Свободный диапазон</option>' + boxes.map((box, index) => `<option value="${index}"${JSON.stringify(box.selection) === JSON.stringify(selected) ? ' selected' : ''}>${escapeHtml(boxLabel(box))}</option>`).join('');
}

export function structureNotesMarkup(structure: MusicalStructure): string {
  return structure.notes.map((note, index) => `<span class="note-pill${index === 0 ? ' is-root' : ''}" data-scale-note="${escapeHtml(note.name)}" data-degree="${escapeHtml(note.degree)}"><strong>${escapeHtml(note.name)}</strong><small>${escapeHtml(note.degree)}</small></span>`).join('');
}

export function positionLabel(position: AnnotatedPosition): string {
  return `${formatMidi(position.midi, position.noteName)}, струна ${position.string}, ${position.fret === 0 ? 'открытая струна, лад 0' : `лад ${position.fret}`}${position.isRoot ? ', тоника' : position.inStructure ? `, ступень ${position.degree}` : ', вне выбранной структуры'}`;
}

/** Форма того же вида в новой тональности или структуре, ближайшая к прежнему положению на грифе. */
export function nearestBoxSelection(previous: BoxSelection, root: string, structureId: StructureId, newStructure: boolean): BoxSelection | null {
  const catalogue = getBoxCatalogue(root, structureId);
  const shape = structureId.endsWith('pentatonic') ? (!newStructure && previous.shapeId.startsWith('penta-') ? previous.shapeId : structureId === 'major-pentatonic' ? 'penta-b' : 'penta-a') : previous.shapeId.startsWith('compact-') ? previous.shapeId : 'compact-e';
  const previousWindow = getBoxInstance(previous).window.fretMin;
  const candidates = catalogue.filter(box => box.selection.shapeId === shape).sort((a, b) => Math.abs(a.window.fretMin - previousWindow) - Math.abs(b.window.fretMin - previousWindow) || a.window.fretMin - b.window.fretMin);
  return candidates[0]?.selection ?? catalogue[0]?.selection ?? null;
}

export function foundationMarkup(root: string, structureId: StructureId, settingsOpen: boolean): string {
  return `      <section class="workspace${settingsOpen ? '' : ' panel-closed'}" aria-label="Изучение грифа">
          ${renderPageHeader('foundation', {
            id: 'structure-heading', className: 'workspace-header', descriptionId: 'study-context', descriptionText: 'Свободный диапазон',
            actions: `<div class="atlas-actions" role="group" aria-label="Занятие по этой форме"><button type="button" id="atlas-play" class="primary-button button-compact" aria-describedby="atlas-bridge-note">Сыграть эту форму</button><button type="button" id="atlas-check" class="secondary-button button-compact" aria-describedby="atlas-bridge-note">Проверь себя по этой форме</button>${renderPageSettingsButton('toggle-study-settings', 'study-settings', settingsOpen)}</div>`,
          })}
          <div class="workspace-main">
            <div class="board-toolbar"><span id="board-range" class="board-caption"></span><span id="atlas-bridge-note" class="atlas-note"></span><span id="position-count" class="sr-only"></span><fieldset class="label-field"><legend class="sr-only">Подписи на грифе</legend><div class="segmented" aria-label="Подписи на грифе"><button type="button" data-label-mode="notes" aria-pressed="true">Ноты</button><button type="button" data-label-mode="degrees" aria-pressed="false">Ступени</button><button type="button" data-label-mode="hidden" aria-pressed="false">Без подписей</button></div></fieldset></div>
            <div class="fretboard-section">
              <div class="board-scroll" id="board-scroll"><div id="fretboard-container"></div></div>
              <div class="board-footer"><div class="legend"><span><i class="legend-root" aria-hidden="true"></i>Тоника</span><span><i class="legend-note" aria-hidden="true"></i><span id="material-legend">Ноты формы</span></span><span id="interval-legend"><i class="legend-interval" aria-hidden="true"></i>Интервал</span></div></div>
              <div id="octave-legend"></div>
            </div>
            <section class="selection-section" aria-label="Выбранная нота и её связи"><div id="selection-detail" data-testid="selection-detail"></div><div id="interval-detail"></div></section>
            <details id="study-more" class="learning-help study-more"><summary class="section-disclosure">Состав, позиции и помощь</summary>
            <div class="structure-summary"><div id="structure-notes" class="note-pills" data-testid="structure-notes" aria-label="Ноты выбранной структуры"></div><div class="formula"><span class="sr-only">Формула</span><strong id="structure-formula" data-testid="structure-formula"></strong></div></div>
            <div id="connections" class="connections"></div>
            <p class="board-navigation">Стрелки — перемещение фокуса · Enter / пробел — выбрать · Home / End — края диапазона</p>
            </details>
          </div>
          <aside class="settings-panel settings-panel-framed" id="study-settings" aria-label="Параметры изучения">
            <div class="section-title"><h2>Что изучаем</h2><button type="button" id="close-study-settings" class="text-button button-compact">Свернуть</button></div>
            <div class="musical-controls">
              <label class="field root-field" for="root-note"><span class="form-label">Тоника</span><select class="form-control" id="root-note" aria-label="Тоника">${ROOTS.map((value, i) => `<option value="${value}"${value === root ? ' selected' : ''}>${ROOT_LABELS[i]}</option>`).join('')}</select></label>
              <label class="field structure-field" for="structure"><span class="form-label">Структура</span><select class="form-control" id="structure" aria-label="Структура">${STRUCTURES.map(item => `<option value="${item.id}"${item.id === structureId ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label>
            </div>
            <div id="box-controls"><label class="field"><span class="form-label">Учебная форма</span><select class="form-control" id="box-select" aria-label="Учебная форма"></select></label><details id="display-settings" class="display-controls"><summary class="section-disclosure">Отображение</summary><label class="switch-row"><span>Номера пальцев<small id="fingers-hint" hidden>Для учебной формы</small></span><input class="control-switch" type="checkbox" role="switch" id="show-fingers"></label><label class="switch-row"><span>Октавные участки</span><input class="control-switch" type="checkbox" role="switch" id="show-octaves" checked></label><label class="switch-row"><span>Интервал от тоники</span><input class="control-switch" type="checkbox" role="switch" id="show-interval" checked></label><p class="settings-hint">Линия соединяет тонику и выбранную ноту.</p></details><label class="field" id="neighbor-field" hidden><span class="form-label">Направление</span><select class="form-control" id="box-neighbor" aria-label="Соседняя форма"><option value="next">Следующая</option><option value="previous">Предыдущая</option></select></label><p id="box-neighbor-name"></p><label id="neighbor-switch-row" class="switch-row"><span>Показать пересечение</span><input class="control-switch" type="checkbox" role="switch" id="show-neighbor"></label><p id="box-notice" role="status"></p><button type="button" id="show-whole-form" class="text-button" hidden>Показать форму целиком ↗</button></div>
            <details id="area-settings"><summary class="section-disclosure">Область грифа</summary>
            <div class="scope-controls">
              <fieldset class="range-field"><legend>Лады <span class="range-hint">включая границы</span></legend><div class="range-inputs"><label><span class="sr-only">Первый лад</span><input class="form-control" id="fret-min" aria-label="Первый лад" type="number" min="0" max="24" step="1" value="0"></label><span class="range-dash" aria-hidden="true">—</span><label><span class="sr-only">Последний лад</span><input class="form-control" id="fret-max" aria-label="Последний лад" type="number" min="0" max="24" step="1" value="12"></label></div></fieldset>
              <div class="range-presets" aria-label="Быстрый диапазон"><button type="button" data-range="0,5">0–5</button><button type="button" data-range="0,12" aria-pressed="true">0–12</button><button type="button" data-range="12,24">12–24</button></div>
              <fieldset class="string-field"><legend>Ноты на струнах</legend><div class="string-switches">${STRING_ORDER.map(string => `<label class="string-switch"><input type="checkbox" value="${string}" aria-label="Струна ${string}" checked><span>${string}</span></label>`).join('')}</div></fieldset>
              <p class="range-description">Выключенная струна остаётся пустой. Ручной выбор струн включает свободную область. Лад 0 — открытая струна.</p>
            </div>
            </details>
            <p id="range-error" class="range-error status-error" data-testid="range-error" role="alert" hidden></p>
            <details class="learning-help"><summary class="section-disclosure">Ступени, пальцы и формы</summary><p id="box-material-caption" class="settings-hint"></p><p>Ступень — место звука относительно тоники: 1 — тоника, 3 — терция, 5 — квинта. ♭ понижает ступень на полутон. Квадрат — рекомендуемый палец, круг — нота или ступень.</p><p>Нота с цифрой обозначает звучащую октаву: C2 и C3 — разные высоты. В басовой записи нота написана на октаву выше звучания. Трезвучие содержит три разных звука; повтор тоники не добавляет четвёртый класс ноты.</p><p>Формы — учебный каталог bass.study, а не универсальная нумерация или единственная аппликатура. Материал выбранной формы сохраняется целиком; область показа не ограничивает упражнение и проверку по форме.</p></details>
          </aside>
        </section>

  <p id="selection-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p>`;
}
