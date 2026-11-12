/**
 * Карточка понятия справочника — общая для страницы (A) и панели поверх экрана (B).
 * Разметка строится строкой, события обрабатывает контроллер хоста. Верный ответ «Проверь себя»
 * хранится только в данных модуля и не попадает в DOM до выбора варианта.
 */
import { escapeHtml } from '../html';
import { B_H_NOTE, LABEL_KINDS, OCTAVE_TABLE, conceptBoard, getConcept, type ConceptCheck, type ConceptRole } from '../../practice/concepts';
import type { ExerciseTemplateId } from '../../exercises';
import {
  LENS_LABELS, SECTION_NOTES, availableLens, boardSvg, conceptTextHtml, levelLabel, relatedExercises,
  type ReferenceConcept, type ReferenceLens,
} from './model';

export interface CardHandlers {
  readonly isMastered: (id: string) => boolean;
  readonly onMastered?: (id: string, value: boolean) => void;
  readonly onListen?: (concept: ReferenceConcept) => void;
  readonly onPlayTemplate?: (templateId: ExerciseTemplateId) => void;
  readonly onOpenSection?: (section: 'rhythm' | 'songs') => void;
}

const ROLE_SWATCH: Readonly<Record<ConceptRole, string>> = { root: 'is-root', target: 'is-target', plain: 'is-plain', shared: 'is-shared' };
const masterLabel = (on: boolean) => (on ? '✓ Освоено' : '○ Отметить: освоено');
const cardOf = (concept: ReferenceConcept) => (concept.full ?? concept.brief)!;

function formulaHtml(formula: string) {
  const steps = [...formula];
  return `<div class="rf-formula" style="grid-template-columns:${steps.map(step => (step === 'Т' ? '2fr' : '1fr')).join(' ')}" role="img" aria-label="${escapeHtml(`Формула ${steps.join('-')}: Т — тон, П — полутон`)}">${steps.map((step, index) => `<span class="${step === 'П' ? 'is-half' : ''}">${escapeHtml(step)}<small>${index + 1}–${index + 2}</small></span>`).join('')}</div>`;
}
function octaveTableHtml() {
  return `<div class="rf-table-wrap"><table class="rf-table"><caption>${escapeHtml(OCTAVE_TABLE.caption)}</caption>
    <thead><tr><th scope="col">Научная</th><th scope="col">По-русски</th><th scope="col">На басу E–A–D–G</th></tr></thead>
    <tbody>${OCTAVE_TABLE.rows.map(row => `<tr><th scope="row">${escapeHtml(row.scientific)}</th><td>${escapeHtml(row.russian)}</td><td>${row.examples.map(example => `${escapeHtml(example.russian)} — ${conceptTextHtml(`{p:${example.positionId.replace(':', '/')}|${example.label}}`)}${example.comment ? `, ${escapeHtml(example.comment)}` : ''}`).join('; ')}${row.note ? `. ${escapeHtml(row.note)}` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}
function labelKindsHtml() {
  const cls = { degree: 'rf-deg', roman: 'rf-roman', finger: 'rf-finger' } as const;
  return `<div class="rf-box rf-kinds"><h3>${escapeHtml(LABEL_KINDS.title)}</h3><div class="rf-labels">${LABEL_KINDS.items.map(item => `<span class="${cls[item.kind]}">${escapeHtml(item.sample)}</span><span>${escapeHtml(item.text)}</span>`).join('')}</div></div>`;
}
function bhNoteHtml() {
  return `<div class="rf-note"><strong>${escapeHtml(B_H_NOTE.title)}</strong>${conceptTextHtml(B_H_NOTE.text)}</div>`;
}

export function boardBlockHtml(concept: ReferenceConcept, lens: ReferenceLens | undefined) {
  const board = conceptBoard(concept);
  if (!board) return '';
  const active = availableLens(board, lens);
  const span = board.fretMax - board.fretMin + 1;
  return `<div class="rf-board" style="max-width:${44 + span * 64 + 16}px">${boardSvg(board, active, concept.title)}</div>`;
}

export function conceptCardHtml(concept: ReferenceConcept, options: { readonly scope: string; readonly lens?: ReferenceLens; readonly mastered: boolean; readonly handlers: Pick<CardHandlers, 'onListen' | 'onPlayTemplate' | 'onOpenSection'> }) {
  const card = cardOf(concept);
  const board = conceptBoard(concept);
  const play = concept.full?.play;
  const lens = board ? availableLens(board, options.lens) : undefined;
  const kind = concept.later ? 'позже · пример будущего уровня' : concept.full ? '' : 'короткая карточка';
  const headingId = `${options.scope}-title`;
  const tools = board && (board.lenses.length > 1 || play?.shape)
    ? `<div class="rf-board-tools">${play?.shape ? `<span class="rf-shape">◇ ${escapeHtml(play.shape)}</span>` : '<span></span>'}${board.lenses.length > 1 ? `<div class="rf-seg" role="group" aria-label="Линза грифа">${board.lenses.map(id => `<button type="button" data-lens="${id}" aria-pressed="${id === lens}">${escapeHtml(LENS_LABELS[id])}</button>`).join('')}</div>` : ''}</div>`
    : '';
  const legend = board ? `<div class="rf-legend">${board.legend.map(item => `<span><i class="${ROLE_SWATCH[item.role]}" aria-hidden="true"></i>${escapeHtml(item.label)}</span>`).join('')}${board.showFingers ? '<span><span class="rf-finger" aria-hidden="true">1</span> палец</span>' : ''}</div>` : '';
  const listen = play?.listen
    ? `<div class="rf-listen"><button type="button" class="secondary-button button-compact" aria-pressed="false" data-listen${options.handlers.onListen ? '' : ' disabled'}>♪ Послушать</button><small>прозвучит: ${escapeHtml(play.listen)}${options.handlers.onListen ? '' : ' · звук подключится позже'}</small><small class="rf-listen-status" data-listen-status aria-live="polite"></small></div>`
    : '';
  const extras = card.extras;
  const related = relatedExercises(card.related);
  const relatedHtml = [
    ...related.map(item => `<li><button type="button" data-template="${escapeHtml(item.id)}"${options.handlers.onPlayTemplate ? '' : ' disabled'}><b>${escapeHtml(item.title)}</b><small>каталог · ${escapeHtml(item.category)}</small><i aria-hidden="true">▶</i></button></li>`),
    ...card.sections.map(item => options.handlers.onOpenSection
      ? `<li><button type="button" data-section="${item.section}"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(SECTION_NOTES[item.section])}</small><i aria-hidden="true">→</i></button></li>`
      : `<li><span class="rf-rel-static"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(SECTION_NOTES[item.section])}</small></span></li>`),
  ].join('');
  return `<article class="rf-card" data-card="${escapeHtml(concept.id)}" aria-labelledby="${headingId}">
    <header class="rf-card-head"><div><span class="rf-eyebrow">${escapeHtml(levelLabel(concept.level))}${kind ? ` · <span class="rf-kind">${escapeHtml(kind)}</span>` : ''}</span><h2 id="${headingId}" tabindex="-1">${escapeHtml(concept.title)}</h2></div>
      <button type="button" class="rf-master" data-master aria-pressed="${options.mastered}" title="Отметка для себя: ничего не открывает и не закрывает">${masterLabel(options.mastered)}</button></header>
    <div class="rf-body">
      <div class="rf-col">
        <section class="rf-step"><h3><span class="rf-num" aria-hidden="true">1</span>Сыграй и послушай</h3><p>${conceptTextHtml(card.play.text)}</p>${tools}<div data-board-host>${boardBlockHtml(concept, lens)}</div>${legend}${listen}</section>
        <section class="rf-step"><h3><span class="rf-num" aria-hidden="true">2</span>Как это называется</h3><p>${conceptTextHtml(card.name)}</p>${card.formula ? formulaHtml(card.formula) : ''}${card.facts.length ? `<ul class="rf-facts">${card.facts.map(fact => `<li>${conceptTextHtml(fact)}</li>`).join('')}</ul>` : ''}${extras.includes('octave-table') ? octaveTableHtml() : ''}${extras.includes('label-kinds') ? labelKindsHtml() : ''}</section>
      </div>
      <div class="rf-col">
        <section class="rf-box rf-why"><h3>Зачем басисту</h3><p>${conceptTextHtml(card.why)}</p></section>
        ${extras.includes('b-h-note') ? bhNoteHtml() : ''}
        ${relatedHtml ? `<section class="rf-box"><h3>Связанные упражнения</h3><ul class="rf-rel">${relatedHtml}</ul></section>` : ''}
        <section class="rf-box rf-check" data-check><h3>Проверь себя · 1 мин</h3><p>${conceptTextHtml(card.check.question)}</p>
          <div class="rf-opts" role="group" aria-label="Варианты ответа">${card.check.options.map((option, index) => `<button type="button" class="rf-opt" data-option="${index}">${conceptTextHtml(option)}</button>`).join('')}</div>
          <p class="rf-verdict" aria-live="polite" data-verdict></p></section>
      </div>
    </div>
  </article>`;
}

/** Ответ на вопрос «Проверь себя»: верно ли и что показать. */
export function answerVerdict(check: ConceptCheck, index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= check.options.length) throw new RangeError('Нет такого варианта ответа.');
  const right = index === check.answer;
  return Object.freeze({ right, html: right ? `<b>Верно.</b> ${conceptTextHtml(check.explanation)}` : '<b>Не то — попробуй ещё.</b>' });
}

/**
 * Контроллер карточки в хосте: рисует понятие, помнит линзу каждого понятия и обрабатывает нажатия.
 * Возвращает `render(id)` и `dispose()`.
 */
export function createCardController(host: HTMLElement, scope: string, handlers: CardHandlers) {
  const lenses = new Map<string, ReferenceLens>();
  let current: ReferenceConcept | null = null;

  function render(id: string) {
    const concept = getConcept(id);
    if (!concept) throw new RangeError(`Нет понятия «${id}».`);
    current = concept;
    host.innerHTML = conceptCardHtml(concept, { scope, lens: lenses.get(id), mastered: handlers.isMastered(id), handlers });
    return concept;
  }
  function syncMastered() {
    if (!current) return;
    const button = host.querySelector<HTMLElement>('[data-master]');
    const on = handlers.isMastered(current.id);
    if (button) { button.setAttribute('aria-pressed', String(on)); button.textContent = masterLabel(on); }
  }
  function onClick(event: MouseEvent) {
    const target = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!target || target.disabled || !current || !host.contains(target)) return;
    const concept = current;
    if (target.dataset.lens) {
      const board = conceptBoard(concept);
      if (!board) return;
      const lens = availableLens(board, target.dataset.lens as ReferenceLens);
      lenses.set(concept.id, lens);
      host.querySelector('[data-board-host]')!.innerHTML = boardBlockHtml(concept, lens);
      host.querySelectorAll<HTMLElement>('[data-lens]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.lens === lens)));
      return;
    }
    if (target.hasAttribute('data-master')) {
      const value = !handlers.isMastered(concept.id);
      handlers.onMastered?.(concept.id, value);
      syncMastered();
      return;
    }
    if (target.dataset.option !== undefined) {
      const verdict = answerVerdict(cardOf(concept).check, Number(target.dataset.option));
      target.dataset.state = verdict.right ? 'right' : 'wrong';
      target.setAttribute('aria-pressed', 'true');
      const box = target.closest('[data-check]')!;
      if (verdict.right) box.querySelectorAll<HTMLButtonElement>('[data-option]').forEach(button => { if (button !== target) button.disabled = true; });
      box.querySelector('[data-verdict]')!.innerHTML = verdict.html;
      return;
    }
    if (target.hasAttribute('data-listen')) { handlers.onListen?.(concept); return; }
    if (target.dataset.template) { handlers.onPlayTemplate?.(target.dataset.template as ExerciseTemplateId); return; }
    if (target.dataset.section) handlers.onOpenSection?.(target.dataset.section as 'rhythm' | 'songs');
  }
  host.addEventListener('click', onClick);
  /** Состояние «Послушать» на текущей карточке: кнопка нажата, пока звук идёт; рядом — пояснение. */
  function setListening(playing: boolean, message: string) {
    const button = host.querySelector<HTMLElement>('[data-listen]');
    if (!button) return;
    button.setAttribute('aria-pressed', String(playing));
    const label = playing ? '■ Остановить' : '♪ Послушать';
    if (button.textContent !== label) button.textContent = label;
    const status = host.querySelector<HTMLElement>('[data-listen-status]');
    const text = playing ? 'звучит…' : message;
    if (status && status.textContent !== text) status.textContent = text;
  }
  return {
    render,
    syncMastered,
    setListening,
    get current() { return current; },
    focusTitle() { host.querySelector<HTMLElement>('.rf-card-head h2')?.focus(); },
    dispose() { host.removeEventListener('click', onClick); host.innerHTML = ''; current = null; },
  };
}
