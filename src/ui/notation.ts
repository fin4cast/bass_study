import './notation.css';
import { formatMidi, type AnnotatedPosition } from '../music';
import { createNotationPlan, type NotationDuration, type NotationEvent, type NotationPlan } from '../notation';

export interface NotationFragment { readonly from: number; readonly to: number }
export interface NotationContext { readonly positions: readonly AnnotatedPosition[]; readonly duration: NotationDuration; readonly fragment?: NotationFragment | null }
export interface NotationPlayback {
  readonly state: string; readonly phase: 'count-in' | 'practice';
  readonly bar: number; readonly beat: number; readonly passIndex: number; readonly showPulse: boolean;
}
export type NotationAction = 'select' | 'show-position';
export interface NotationOptions { readonly onSelect?: (index: number, positionId: string, action: NotationAction) => void }
let instanceCounter = 0;
let fonts: Promise<typeof import('vexflow/bravura')> | null = null;
function localFonts() {
  if (!fonts) fonts = import('vexflow/bravura').then(async library => {
    // This entry registers embedded data-URI fonts. Never use loadFonts(), whose
    // default URLs are a CDN. Wait before measuring the score's glyphs.
    await Promise.all([document.fonts.load('16px Bravura'), document.fonts.load('16px Academico')]);
    await document.fonts.ready;
    return library;
  }).catch(error => { fonts = null; throw error; });
  return fonts;
}

/** The only cursor is supplied by the existing sequence player; this view never plays audio. */
export function mountNotation(container: HTMLElement, getContext: () => NotationContext, options: NotationOptions = {}) {
  const controller = new AbortController();
  const instance = ++instanceCounter;
  let disposed = false; let visible = false; let generation = 0; let plan: NotationPlan | null = null;
  let signature = ''; let activeIndex: number | null = null; let selectedIndex = 0;
  let focusView: 'staff' | 'tab' = 'staff';
  let groups: Array<{ staff: SVGElement; tab: SVGElement; x: number }> = [];
  let cursor: SVGRectElement | null = null;
  let fragment: NotationFragment | null = null;
  container.classList.add('notation-section');
  container.hidden = true;
  container.innerHTML = `<div class="notation-heading"><div><p class="eyebrow">ЧТЕНИЕ И ПОЗИЦИИ</p><h2>Ноты и табулатура</h2></div><span class="notation-count"></span></div><p class="notation-help">Бас записан на октаву выше звучания: открытая E звучит как E1 и записана E2. Таба показывает выбранную струну и лад.</p><p class="notation-fragment" data-testid="notation-fragment"></p><p class="notation-playback" data-testid="notation-playback"></p><p class="notation-status" role="status" aria-live="polite"></p><div class="notation-scroll" tabindex="0" role="region" aria-label="Ноты и табулатура с горизонтальной прокруткой"><div class="notation-surface"></div></div><p class="notation-selected"></p><p class="notation-keyboard-help">Мышь, ←/→, Home и End выбирают ноту, сохраняя управление здесь. Enter и пробел переводят к её позиции на грифе. Масштаб страницы можно увеличить до 200%.</p>`;
  const surface = container.querySelector<HTMLDivElement>('.notation-surface')!;
  const viewport = container.querySelector<HTMLElement>('.notation-scroll')!;
  const status = container.querySelector<HTMLElement>('.notation-status')!;
  const count = container.querySelector<HTMLElement>('.notation-count')!;
  const selected = container.querySelector<HTMLElement>('.notation-selected')!;

  function keepVisible(index: number) {
    const group = groups[index]?.staff;
    if (!group) return;
    const note = group.getBoundingClientRect(); const region = viewport.getBoundingClientRect();
    if (note.left < region.left + 24) viewport.scrollLeft -= region.left + 24 - note.left;
    else if (note.right > region.right - 24) viewport.scrollLeft += note.right - region.right + 24;
  }
  function selectedDescription(event: NotationEvent) {
    return `Нота ${event.index + 1}: записано ${event.writtenName}, звучит ${formatMidi(event.soundingMidi, event.spelling)}; струна ${event.tab.string}, лад ${event.tab.fret}.`;
  }
  function updateSelection() {
    groups.forEach((pair, index) => {
      for (const view of ['staff', 'tab'] as const) {
        pair[view].classList.toggle('is-selected', index === selectedIndex);
        pair[view].setAttribute('tabindex', index === selectedIndex && view === focusView ? '0' : '-1');
      }
    });
    selected.textContent = plan?.events[selectedIndex] ? selectedDescription(plan.events[selectedIndex]) : '';
  }
  function choose(index: number, view: 'staff' | 'tab', focus = false, action: NotationAction = 'select') {
    if (!plan?.events[index]) return;
    selectedIndex = index; focusView = view; updateSelection(); keepVisible(index);
    if (focus) groups[index]?.[view].focus();
    options.onSelect?.(index, plan.events[index].positionId, action);
  }
  function setFragment(next: NotationFragment | null) {
    fragment = next && Number.isInteger(next.from) && Number.isInteger(next.to) && next.from >= 1 && next.to >= next.from ? { ...next } : null;
    const from = fragment?.from ?? 1, to = fragment?.to ?? plan?.events.length ?? 0;
    groups.forEach((pair, index) => {
      for (const view of ['staff', 'tab'] as const) {
        pair[view].classList.toggle('outside-fragment', index + 1 < from || index + 1 > to);
        pair[view].classList.toggle('fragment-start', index + 1 === from);
        pair[view].classList.toggle('fragment-end', index + 1 === to);
        pair[view].dataset.fragmentBoundary = index + 1 === from ? index + 1 === to ? 'start-end' : 'start' : index + 1 === to ? 'end' : '';
      }
    });
    container.querySelector<HTMLElement>('.notation-fragment')!.textContent = to ? `Показана исходная последовательность. Фрагмент: ноты ${from}–${to}, обе границы включены. Курсор следует этому участку; счёт метронома продолжается через повторы.` : '';
  }
  function setPlaybackState(playback: NotationPlayback) {
    const output = container.querySelector<HTMLElement>('.notation-playback')!;
    const active = ['running', 'finishing', 'paused'].includes(playback.state);
    const text = !playback.showPulse ? 'Визуальные подсказки выключены.' : !active ? '' : playback.phase === 'count-in' ? 'Отсчёт перед фрагментом' : `${playback.state === 'paused' ? 'Пауза · ' : ''}Звучащий такт ${playback.bar + 1} · доля ${playback.beat} · повтор ${playback.passIndex + 1}`;
    if (output.textContent !== text) output.textContent = text;
    if (!playback.showPulse) setActiveIndex(null);
  }
  function setActiveIndex(index: number | null) {
    if (disposed) return;
    if (!visible) { activeIndex = index !== null && Number.isInteger(index) && index >= 0 ? index : null; return; }
    const next = index !== null && Number.isInteger(index) && index >= 0 && index < (plan?.events.length ?? 0) ? index : null;
    if (next === activeIndex && cursor) return;
    activeIndex = next;
    groups.forEach((pair, item) => {
      pair.staff.classList.toggle('is-playing', item === activeIndex); pair.tab.classList.toggle('is-playing', item === activeIndex);
      if (item === activeIndex) { pair.staff.setAttribute('aria-current', 'true'); pair.tab.setAttribute('aria-current', 'true'); }
      else { pair.staff.removeAttribute('aria-current'); pair.tab.removeAttribute('aria-current'); }
    });
    if (cursor) {
      cursor.style.display = activeIndex === null ? 'none' : '';
      if (activeIndex !== null) cursor.setAttribute('x', String(groups[activeIndex].x - 16));
    }
    if (activeIndex !== null) keepVisible(activeIndex);
  }
  function addStringLabels(svg: SVGSVGElement, x: number, ys: readonly number[]) {
    ['G', 'D', 'A', 'E'].forEach((string, row) => {
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', String(x)); label.setAttribute('y', String(ys[row] + 4)); label.setAttribute('class', 'notation-string-label');
      label.textContent = string; svg.append(label);
    });
  }

  async function refreshContext() {
    if (disposed || !visible) return;
    let next: NotationPlan;
    try { const context = getContext(); next = createNotationPlan(context); if (Object.hasOwn(context, 'fragment')) fragment = context.fragment ?? null; }
    catch (error) { generation++; plan = null; groups = []; cursor = null; surface.replaceChildren(); count.textContent = ''; status.textContent = error instanceof Error ? error.message : String(error); return; }
    const nextSignature = `${next.duration}:${next.events.map(event => `${event.positionId}/${event.spelling}`).join('|')}`;
    if (nextSignature === signature && surface.querySelector('svg')) { setFragment(fragment); const saved = activeIndex; activeIndex = null; setActiveIndex(saved); return; }
    signature = nextSignature; const run = ++generation;
    const hadFocus = container.contains(document.activeElement);
    plan = next; groups = []; cursor = null; surface.replaceChildren();
    selectedIndex = Math.min(selectedIndex, Math.max(0, next.events.length - 1));
    count.textContent = `${next.events.length} нот · ${next.bars} такт${next.bars === 1 ? '' : next.bars >= 2 && next.bars <= 4 ? 'а' : 'ов'}`;
    if (!next.events.length) { status.textContent = 'Создай последовательность, чтобы увидеть её ноты и выбранные позиции таба.'; selected.textContent = ''; return; }
    status.textContent = 'Загружаем локальные нотные шрифты…';
    try {
      const VF = await localFonts(); if (disposed || run !== generation) return;
      const bars = Array.from({ length: next.bars }, (_, bar) => next.events.filter(event => event.bar === bar));
      const widths = bars.map((events, bar) => Math.max(220, events.length * 49 + (bar === 0 ? 115 : 35)));
      const width = widths.reduce((sum, value) => sum + value, 0) + 36;
      const highest = Math.max(8, ...next.events.map(event => event.staffStep));
      const extraTop = Math.max(0, highest - 8) * 5;
      const staffY = 59 + extraTop; const tabY = staffY + 155; const height = tabY + 125;
      const renderer = new VF.Renderer(surface, VF.Renderer.Backends.SVG); renderer.resize(width, height);
      const context = renderer.getContext(); context.setFillStyle('var(--notation-ink)'); context.setStrokeStyle('var(--notation-ink)');
      if (context instanceof VF.SVGContext) context.setBackgroundFillStyle('var(--notation-paper)');
      const svg = surface.querySelector<SVGSVGElement>('svg')!;
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('role', 'group'); svg.setAttribute('aria-label', 'Басовый ключ и табулатура четырёхструнного баса');
      svg.classList.add('notation-svg');
      const duration = next.duration === 'quarter' ? 'q' : next.duration === 'eighth' ? '8' : '16';
      const pending: Array<{ event: NotationEvent; staff: InstanceType<typeof VF.StaveNote>; tab: InstanceType<typeof VF.TabNote> }> = [];
      let x = 18;
      bars.forEach((events, bar) => {
        const stave = new VF.Stave(x, staffY, widths[bar]);
        const tab = new VF.TabStave(x, tabY, widths[bar], { numLines: 4 });
        if (bar === 0) stave.addClef('bass').addTimeSignature('4/4');
        const noteStart = x + (bar === 0 ? 91 : 17);
        stave.setNoteStartX(noteStart); tab.setNoteStartX(noteStart);
        stave.setContext(context).draw(); tab.setContext(context).draw();
        if (bar === 0) addStringLabels(svg, x + 12, [0, 1, 2, 3].map(row => tab.getYForLine(row)));
        const notes = events.map(event => {
          const key = `${event.spelling.replaceAll('♯', '#').replaceAll('♭', 'b').toLowerCase()}/${event.writtenOctave}`;
          const staff = new VF.StaveNote({ clef: 'bass', keys: [key], duration, autoStem: true });
          staff.setAttribute('id', `notation-${instance}-staff-${event.index}`);
          if (event.accidentalDisplay) {
            const accidental = event.accidental === 0 ? 'n' : event.accidental > 0 ? '#'.repeat(event.accidental) : 'b'.repeat(-event.accidental);
            staff.addModifier(new VF.Accidental(accidental), 0);
          }
          const tabNote = new VF.TabNote({ positions: [{ str: event.tab.row + 1, fret: event.tab.fret }], duration });
          tabNote.setAttribute('id', `notation-${instance}-tab-${event.index}`);
          pending.push({ event, staff, tab: tabNote });
          return { staff, tab: tabNote };
        });
        const staffVoice = new VF.Voice({ numBeats: 4, beatValue: 4 }).setMode(VF.Voice.Mode.SOFT).addTickables(notes.map(note => note.staff));
        const tabVoice = new VF.Voice({ numBeats: 4, beatValue: 4 }).setMode(VF.Voice.Mode.SOFT).addTickables(notes.map(note => note.tab));
        new VF.Formatter().joinVoices([staffVoice]).joinVoices([tabVoice]).format([staffVoice, tabVoice], widths[bar] - (noteStart - x) - 24);
        staffVoice.draw(context, stave); tabVoice.draw(context, tab);
        x += widths[bar];
      });
      groups = pending.map(({ event, staff, tab }) => {
        const pair = { staff: staff.getSVGElement()!, tab: tab.getSVGElement()!, x: staff.getAbsoluteX() };
        for (const view of ['staff', 'tab'] as const) {
          const group = pair[view]; group.classList.add('notation-note'); group.dataset.notationIndex = String(event.index); group.dataset.notationView = view;
          group.dataset.notationPosition = event.positionId; group.dataset.written = event.writtenName; group.dataset.soundingMidi = String(event.soundingMidi); group.dataset.staffStep = String(event.staffStep);
          group.setAttribute('role', 'button'); group.setAttribute('focusable', 'true'); group.setAttribute('aria-label', selectedDescription(event));
          const title = document.createElementNS('http://www.w3.org/2000/svg', 'title'); title.textContent = selectedDescription(event); group.append(title);
        }
        return pair;
      });
      cursor = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); cursor.setAttribute('class', 'notation-cursor'); cursor.setAttribute('y', '26'); cursor.setAttribute('width', '32'); cursor.setAttribute('height', String(height - 38)); cursor.setAttribute('rx', '8'); cursor.style.display = 'none'; svg.prepend(cursor);
      updateSelection(); setFragment(fragment); const savedActive = activeIndex; activeIndex = null; setActiveIndex(savedActive);
      if (hadFocus) groups[selectedIndex]?.[focusView].focus();
      const partial = next.totalBeats % 4 !== 0;
      status.textContent = partial ? 'Последний такт неполный. Запись повторяет длину последовательности.' : 'Ноты и таба готовы. Звук и курсор принадлежат общему проигрывателю.';
    } catch (error) {
      if (disposed || run !== generation) return;
      surface.replaceChildren(); groups = []; cursor = null;
      status.textContent = `Не удалось построить нотную запись: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  container.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest<SVGElement>('[data-notation-index]') : null;
    if (!target) return;
    choose(Number(target.dataset.notationIndex), target.dataset.notationView === 'tab' ? 'tab' : 'staff', true);
  }, { signal: controller.signal });
  container.addEventListener('keydown', event => {
    const target = event.target instanceof Element ? event.target.closest<SVGElement>('[data-notation-index]') : null;
    if (!target || !plan?.events.length) return;
    const index = Number(target.dataset.notationIndex); const view = target.dataset.notationView === 'tab' ? 'tab' : 'staff';
    const next = event.key === 'ArrowRight' ? Math.min(plan.events.length - 1, index + 1) : event.key === 'ArrowLeft' ? Math.max(0, index - 1)
      : event.key === 'Home' ? 0 : event.key === 'End' ? plan.events.length - 1 : event.key === 'Enter' || event.key === ' ' ? index : null;
    if (next === null) return; event.preventDefault(); event.stopPropagation(); choose(next, view, true, event.key === 'Enter' || event.key === ' ' ? 'show-position' : 'select');
  }, { signal: controller.signal });
  return { refreshContext, setActiveIndex, setFragment, setPlaybackState, getPlan: () => plan,
    setVisible(next: boolean) { if (disposed) return; visible = next; container.hidden = !next; if (next) void refreshContext(); else generation++; },
    dispose() { if (disposed) return; disposed = true; generation++; controller.abort(); groups = []; plan = null; cursor = null; container.replaceChildren(); } };
}
