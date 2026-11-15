import { describe, expect, it } from 'vitest';
import { buildExercise, createExerciseSpec } from '../src/exercises';
import { buildTimeline } from '../src/exercises/rhythm';
import { tabEvents } from '../src/ui/play/model';
import { countLabel, pageOf, renderRhythm, renderTab, totalBars } from '../src/ui/play/tab';

/** Контрольный TAB EX-1 (карточка VIS-11): строка и лад каждой из 16 восьмых, затем завершение тоникой A на E/5. */
const EX1_TAB = [['E', 5], ['E', 8], ['A', 5], ['A', 7], ['D', 5], ['D', 7], ['G', 5], ['G', 7], ['G', 9], ['G', 7], ['D', 10], ['D', 7], ['A', 10], ['A', 7], ['E', 10], ['E', 8], ['E', 5]];
const ex1 = () => buildExercise(createExerciseSpec('connect-forms'));
const events = (options = {}) => { const plan = ex1(); return tabEvents(plan, buildTimeline(plan, options)); };
const frets = (svg: string) => [...svg.matchAll(/class="pl-tab-fret[^"]*" data-index="(\d+)" data-string="([GDAE])"[^>]*>(\d+)</g)]
  .map(match => ({ index: Number(match[1]), string: match[2], fret: Number(match[3]) }));

describe('счёт и такты', () => {
  it('подписи счёта восьмыми и шестнадцатыми', () => {
    expect([0, 0.5, 1, 1.5, 3, 3.5].map(countLabel)).toEqual(['1', 'и', '2', 'и', '4', 'и']);
    expect([0.25, 0.75].map(countLabel)).toEqual(['е', 'а']);
  });
  it('EX-1: 16 восьмых, тоника четвертью и пауза — три такта; страница из двух тактов', () => {
    const list = events();
    expect(totalBars(list)).toBe(3);
    expect(list.at(-1)).toMatchObject({ tab: null, bar: 2, beatInBar: 1, durationBeats: 3 });
    expect(list.at(-2)).toMatchObject({ tab: { string: 'E', fret: 5 }, bar: 2, beatInBar: 0, durationBeats: 1 });
    expect(pageOf(list, 1, 2)).toEqual({ firstBar: 0, lastBar: 1, totalBars: 3, bars: 2 });
    expect(pageOf(list, 2, 2)).toEqual({ firstBar: 2, lastBar: 2, totalBars: 3, bars: 1 });
  });
});

describe('SVG-табулатура', () => {
  it('ноты, строки и лады совпадают с контрольным TAB; счёт по каждому такту', () => {
    const svg = renderTab({ events: events() });
    expect(frets(svg).map(item => [item.string, item.fret])).toEqual(EX1_TAB);
    expect(frets(svg).map(item => item.index)).toEqual([...Array(17).keys()]);
    expect([...svg.matchAll(/class="pl-tab-count"[^>]*>([^<]+)</g)].map(match => match[1]).join(' ')).toBe(Array(3).fill('1 и 2 и 3 и 4 и').join(' '));
    expect(svg).toContain('class="pl-tab-rest');
  });

  it('тактовые черты, линии G-D-A-E и черты длительности под нотами', () => {
    const svg = renderTab({ events: events() });
    expect([...svg.matchAll(/data-bar-line="(\d+)"/g)].map(match => Number(match[1]))).toEqual([1, 2]);
    expect([...svg.matchAll(/class="pl-tab-string"[^>]*>([GDAE])</g)].map(match => match[1])).toEqual(['G', 'D', 'A', 'E']);
    expect(svg.match(/class="pl-tab-dur"/g)).toHaveLength(17);
  });

  it('курсор — один контур на текущем шаге; без текущего шага курсора нет', () => {
    const svg = renderTab({ events: events(), current: 5 });
    expect(svg.match(/class="pl-tab-cursor"/g)).toHaveLength(1);
    expect(frets(svg).find(item => item.index === 5)).toEqual({ index: 5, string: 'D', fret: 7 });
    expect(svg).toMatch(/class="pl-tab-fret is-current" data-index="5"/);
    expect(renderTab({ events: events(), current: -1 })).not.toContain('pl-tab-cursor');
  });

  it('один такт: только его ноты; сыгранные затемняются; такты выбираются для петли', () => {
    const svg = renderTab({ events: events(), current: 12, fromBar: 1, bars: 1, dimPlayed: true, selectable: true, loop: { fromBar: 1, toBar: 2 } });
    expect(frets(svg).map(item => item.index)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    expect([...svg.matchAll(/is-played" data-index="(\d+)"/g)].map(match => Number(match[1]))).toEqual([8, 9, 10, 11]);
    expect(svg).not.toContain('data-bar-line');
    expect(svg).toContain('data-bar="1"');
    expect(svg).toContain('class="pl-tab-loop"');
  });

  it('эхо: такт повтора подписан, ноты в нём отмечены', () => {
    const svg = renderTab({ events: events({ echo: true }), fromBar: 0, bars: 2 });
    expect(svg).toContain('эхо — повтори');
    expect(svg).toMatch(/pl-tab-fret is-echo/);
  });

  it('без счёта и с экранированной подписью', () => {
    const svg = renderTab({ events: events(), showCount: false, label: 'Такт "1" <след.>' });
    expect(svg).not.toContain('pl-tab-count');
    expect(svg).toContain('aria-label="Такт &quot;1&quot; &lt;след.&gt;"');
  });

  it('строка ритма: длительности такта блоками, пауза отдельно, текущий шаг выделен', () => {
    const list = events();
    const svg = renderRhythm(list, 2, 16);
    expect(svg.match(/class="pl-rh-note[^"]*"/g)).toHaveLength(2);
    expect(svg).toContain('pl-rh-note is-current');
    expect(svg).toContain('pl-rh-note is-rest');
  });
});
