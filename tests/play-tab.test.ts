import { describe, expect, it } from 'vitest';
import { buildExercise, createExerciseSpec } from '../src/exercises';
import { createNotationPlan } from '../src/notation';
import { barRange, countLabel, pageRange, renderTab, slotsPerBar } from '../src/ui/play/tab';

/** Контрольный TAB EX-1 (карточка VIS-11): строка и лад каждой из 16 восьмых. */
const EX1_TAB = [['E', 5], ['E', 8], ['A', 5], ['A', 7], ['D', 5], ['D', 7], ['G', 5], ['G', 7], ['G', 9], ['G', 7], ['D', 10], ['D', 7], ['A', 10], ['A', 7], ['E', 10], ['E', 8]];
const events = () => createNotationPlan({ positions: buildExercise(createExerciseSpec('connect-forms')).positions, duration: 'eighth' }).events;
const frets = (svg: string) => [...svg.matchAll(/class="pl-tab-fret[^"]*" data-index="(\d+)" data-string="([GDAE])"[^>]*>(\d+)</g)]
  .map(match => ({ index: Number(match[1]), string: match[2], fret: Number(match[3]) }));

describe('счёт и такты', () => {
  it('подписи счёта восьмыми и шестнадцатыми', () => {
    expect([0, 0.5, 1, 1.5, 3, 3.5].map(countLabel)).toEqual(['1', 'и', '2', 'и', '4', 'и']);
    expect([0.25, 0.75].map(countLabel)).toEqual(['е', 'а']);
  });
  it('EX-1: два такта по 8 восьмых, страница из двух тактов — 16 столбцов', () => {
    const list = events();
    expect(slotsPerBar(0.5)).toBe(8);
    expect(barRange(list, 0)).toEqual({ from: 0, count: 8 });
    expect(barRange(list, 1)).toEqual({ from: 8, count: 8 });
    expect(barRange(list, 5)).toEqual({ from: 0, count: 0 });
    expect(pageRange(list, 1, 2)).toMatchObject({ firstBar: 0, lastBar: 1, totalBars: 2, from: 0, count: 16, slots: 16 });
  });
  it('длинное упражнение листается страницами по два такта', () => {
    const list = createNotationPlan({ positions: buildExercise(createExerciseSpec('pentatonic-neck')).positions, duration: 'eighth' }).events;
    const totalBars = list.at(-1)!.bar + 1;
    expect(totalBars).toBeGreaterThan(2);
    const page = pageRange(list, 3, 2);
    expect(page).toMatchObject({ firstBar: 2, lastBar: 3, from: 16, slots: 16 });
    expect(list.slice(page.from, page.from + page.count).every(event => event.bar === 2 || event.bar === 3)).toBe(true);
  });
});

describe('SVG-табулатура', () => {
  it('столбцы, строки и лады совпадают с контрольным TAB', () => {
    const svg = renderTab({ events: events() });
    expect(frets(svg).map(item => [item.string, item.fret])).toEqual(EX1_TAB);
    expect(frets(svg).map(item => item.index)).toEqual([...Array(16).keys()]);
    expect([...svg.matchAll(/class="pl-tab-count"[^>]*>([^<]+)</g)].map(match => match[1]).join(' ')).toBe('1 и 2 и 3 и 4 и 1 и 2 и 3 и 4 и');
  });

  it('тактовая черта между тактами 1 и 2, линии G-D-A-E', () => {
    const svg = renderTab({ events: events() });
    expect([...svg.matchAll(/data-bar-line="(\d+)"/g)].map(match => Number(match[1]))).toEqual([1]);
    expect([...svg.matchAll(/class="pl-tab-string"[^>]*>([GDAE])</g)].map(match => match[1])).toEqual(['G', 'D', 'A', 'E']);
  });

  it('курсор — один контур на текущей ноте; без текущей ноты курсора нет', () => {
    const svg = renderTab({ events: events(), current: 5 });
    expect(svg.match(/class="pl-tab-cursor"/g)).toHaveLength(1);
    expect(frets(svg).find(item => item.index === 5)).toEqual({ index: 5, string: 'D', fret: 7 });
    expect(svg).toMatch(/class="pl-tab-fret is-current" data-index="5"/);
    expect(renderTab({ events: events(), current: -1 })).not.toContain('pl-tab-cursor');
  });

  it('один такт: только его ноты; сыгранные затемняются', () => {
    const list = events();
    const svg = renderTab({ events: list, current: 12, ...barRange(list, 1), slots: 8, dimPlayed: true });
    expect(frets(svg).map(item => item.index)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    expect([...svg.matchAll(/is-played" data-index="(\d+)"/g)].map(match => Number(match[1]))).toEqual([8, 9, 10, 11]);
    expect(svg).not.toContain('data-bar-line');
  });

  it('без счёта и с экранированной подписью', () => {
    const svg = renderTab({ events: events(), showCount: false, label: 'Такт "1" <след.>' });
    expect(svg).not.toContain('pl-tab-count');
    expect(svg).toContain('aria-label="Такт &quot;1&quot; &lt;след.&gt;"');
  });
});
