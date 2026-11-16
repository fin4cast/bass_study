import { describe, expect, it } from 'vitest';
import { createPlaybackPlan, eventAtGrid } from '../src/audio/plan';
import { buildExercise, createExerciseSpec } from '../src/exercises';
import { buildTimeline, rhythmPatternsFor, type RhythmPatternId } from '../src/exercises/rhythm';
import { annotatePositions, createStructure, getPosition } from '../src/music';
import { articulationText, renderRhythm, renderTab } from '../src/ui/play/tab';
import { playbackConfig, DEFAULT_PLAY_SETTINGS, tabEvents, timelineFor } from '../src/ui/play/model';

/* ---------- Длительность звучания ноты и «Длинные и короткие» (R-028, A3, A8.1) ---------- */

const plan = buildExercise(createExerciseSpec('long-short'));

describe('шаблон long-short (A8.1)', () => {
  it('по умолчанию: 16 раз E:5 (A1), ноты 0–7 длинные (gate 1), 8–15 короткие (gate 0,5), правая рука i m', () => {
    expect(plan.notes).toHaveLength(16);
    expect(plan.notes.every(note => note.id === 'E:5' && note.name === 'A1' && note.finger === null)).toBe(true);
    expect(plan.notes.map(note => note.gate)).toEqual([...Array(8).fill(1), ...Array(8).fill(0.5)]);
    expect(plan.notes.map(note => note.pluck).join('')).toBe('imimimimimimimim');
    expect(plan.segments.map(segment => segment.label)).toEqual(['Длинные · легато', 'Короткие · стаккато']);
    expect(plan.overlap).toBe('none');
    expect(plan.notes.map(note => note.segment)).toEqual([...Array(8).fill(0), ...Array(8).fill(1)]);
  });
  it('варианты программы: A:5 (D2) и D:5 (G2); открытая струна допустима; лад вне 0–12 отклоняется', () => {
    expect(buildExercise(createExerciseSpec('long-short', { string: 'A' })).notes[0]).toMatchObject({ id: 'A:5', name: 'D2' });
    expect(buildExercise(createExerciseSpec('long-short', { string: 'D' })).notes[0]).toMatchObject({ id: 'D:5', name: 'G2' });
    expect(buildExercise(createExerciseSpec('long-short', { fret: 0 })).notes[0].id).toBe('E:0');
    expect(() => createExerciseSpec('long-short', { fret: 13 })).toThrow(RangeError);
  });
  it('допустимы только четверти и восьмые; граница длинных и коротких совпадает с тактовой чертой', () => {
    expect(rhythmPatternsFor(plan)).toEqual(['eighths', 'quarters']);
    const bars = (pattern: RhythmPatternId) => {
      const timeline = buildTimeline(plan, { pattern });
      return Array.from({ length: timeline.bars }, (_, bar) => timeline.steps.filter(step => step.bar === bar).map(step => step.gate));
    };
    // Четверти: 2 такта длинных и 2 коротких; восьмые: такт и такт.
    expect(bars('quarters')).toEqual([Array(4).fill(1), Array(4).fill(1), Array(4).fill(0.5), Array(4).fill(0.5)]);
    expect(bars('eighths')).toEqual([Array(8).fill(1), Array(8).fill(0.5)]);
    // Другой рисунок не подставляется: недопустимый заменяется первым допустимым.
    expect(buildTimeline(plan, { pattern: 'syncopation' }).pattern).toBe('eighths');
  });
  it('у остальных шаблонов gate нет (обычная длительность)', () => {
    for (const templateId of ['pulse-note', 'chromatic-position', 'progression'] as const) {
      const other = buildExercise(createExerciseSpec(templateId));
      expect(other.notes.every(note => note.gate === null), templateId).toBe(true);
      expect(buildTimeline(other).steps.every(step => step.gate === null), templateId).toBe(true);
    }
  });
});

describe('gate в звуковом плане (A3)', () => {
  const notes = annotatePositions([getPosition('E', 5), getPosition('A', 3)], createStructure('A', 'minor-pentatonic'));
  const base = { notes, bpm: 60, countInBars: 0, repeat: 'once' } as const;

  it('доля звучания приходит к событию сетки с первой шестнадцатой шага; у обычной ноты и у лиги — null', () => {
    const planned = createPlaybackPlan({ ...base, steps: [{ note: 0, grids: 4, gate: 1 }, { note: 1, grids: 4, gate: 0.5 }, { note: 1, grids: 4 }] });
    expect([0, 4, 8].map(grid => eventAtGrid(planned, grid).gate)).toEqual([1, 0.5, null]);
    expect(eventAtGrid(planned, 1).gate).toBeNull();
    const tied = createPlaybackPlan({ ...base, steps: [{ note: 0, grids: 4, gate: 0.5 }, { note: 0, grids: 4, tie: true, gate: 0.5 }] });
    expect(eventAtGrid(tied, 0)).toMatchObject({ gate: 0.5, noteGrids: 8 });
    expect(eventAtGrid(tied, 4).gate).toBeNull();
  });
  it('строгая проверка: от 0 (не включая) до 1; без шагов gate не нужен', () => {
    for (const gate of [0, -0.1, 1.01, Number.NaN, '0.5' as never]) {
      expect(() => createPlaybackPlan({ ...base, steps: [{ note: 0, grids: 4, gate }] }), String(gate)).toThrow(RangeError);
    }
    expect(eventAtGrid(createPlaybackPlan({ ...base, duration: 'quarter' }), 0).gate).toBeNull();
  });
  it('экран игры передаёт gate шага шкалы в конфигурацию звука', () => {
    const timeline = timelineFor(plan, { rhythm: 'quarters', echo: false });
    const config = playbackConfig(plan, timeline, { ...DEFAULT_PLAY_SETTINGS, rhythm: 'quarters' });
    expect(config.steps!.map(step => step.gate)).toEqual([...Array(8).fill(1), ...Array(8).fill(0.5)]);
  });
});

describe('показ: знак артикуляции в TAB и закраска в строке ритма', () => {
  const timeline = timelineFor(plan, { rhythm: 'quarters', echo: false });
  const events = tabEvents(plan, timeline);

  it('TAB: у короткой ноты точка, у длинной черта, у ноты без gate знака нет', () => {
    const long = renderTab({ events: events.filter(event => event.bar === 0), fromBar: 0, bars: 1 });
    expect(long).toContain('is-long');
    expect(long).not.toContain('is-short');
    expect(long).toContain('data-articulation="long"');
    const short = renderTab({ events: events.filter(event => event.bar === 2), fromBar: 2, bars: 1 });
    expect(short).toContain('is-short');
    expect(short).not.toContain('is-long');
    const plain = tabEvents(buildExercise(createExerciseSpec('pulse-note')), timelineFor(buildExercise(createExerciseSpec('pulse-note')), { rhythm: 'eighths', echo: false }));
    expect(renderTab({ events: plain, fromBar: 0, bars: 1 })).not.toContain('pl-tab-art');
  });
  it('строка ритма: короткая нота закрашена наполовину шага, длинная — на весь шаг; подписи «длинно» и «коротко»', () => {
    const widthOf = (svg: string, cls: string) => [...svg.matchAll(new RegExp(`<rect class="${cls}[^"]*"[^>]* width="([\\d.]+)"`, 'g'))].map(match => Number(match[1]));
    const long = renderRhythm(events, 0, null);
    const short = renderRhythm(events, 2, null);
    const [fullLong] = widthOf(long, 'pl-rh-step'), [filledLong] = widthOf(long, 'pl-rh-note');
    const [fullShort] = widthOf(short, 'pl-rh-step'), [filledShort] = widthOf(short, 'pl-rh-note');
    expect(filledLong).toBe(fullLong);
    expect(filledShort).toBeCloseTo(fullShort / 2, 1);
    expect(long).toContain('нота · длинно');
    expect(short).toContain('нота · коротко');
  });
  it('текст и ARIA: подпись артикуляции у ноты и в названии строки ритма', () => {
    expect([articulationText(1), articulationText(0.5), articulationText(null)]).toEqual(['длинно', 'коротко', '']);
    expect(renderRhythm(events, 0, null)).toContain('aria-label="Ритм такта 1 · длинные ноты"');
    expect(renderRhythm(events, 2, null)).toContain('aria-label="Ритм такта 3 · короткие ноты"');
    expect(renderRhythm(tabEvents(buildExercise(createExerciseSpec('pulse-note')), timelineFor(buildExercise(createExerciseSpec('pulse-note')), { rhythm: 'eighths', echo: false })), 0, null)).toContain('aria-label="Ритм такта 1"');
  });
});
