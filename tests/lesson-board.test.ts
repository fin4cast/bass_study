import { describe, expect, it } from 'vitest';
import { boardGeometry, boardSvg, boardWindow } from '../src/ui/lesson/mini-board';

describe('мини-гриф', () => {
  it('окно ладов: на лад шире с краёв и не уже шести ладов', () => {
    expect(boardWindow([7, 10])).toEqual({ fretMin: 6, fretMax: 11 });
    expect(boardWindow([0, 2])).toEqual({ fretMin: 0, fretMax: 5 });
    expect(boardWindow([23, 24])).toEqual({ fretMin: 19, fretMax: 24 });
    expect(boardWindow([])).toEqual({ fretMin: 0, fretMax: 5 });
  });
  it('строки G–D–A–E сверху вниз и центр лада', () => {
    const geo = boardGeometry({ fretMin: 5, fretMax: 12, width: 1000, marker: 48 });
    expect(geo.y('G')).toBeLessThan(geo.y('D'));
    expect(geo.y('A')).toBeLessThan(geo.y('E'));
    expect(geo.x(5)).toBeCloseTo(34 + geo.cell / 2);
    expect(() => boardGeometry({ fretMin: 6, fretMax: 5 })).toThrow(RangeError);
  });
  it('рисует ноты окна, экранирует подписи и пропускает позиции вне окна', () => {
    const svg = boardSvg({ fretMin: 5, fretMax: 8, notes: [{ id: 'E:5', kind: 'root', label: '<A>' }, { id: 'G:12', kind: 'plain', label: 'x' }, { id: 'bad', kind: 'plain' }], ariaLabel: 'Гриф "A"' });
    expect(svg).toContain('&lt;A&gt;');
    expect(svg).not.toContain('<A>');
    expect(svg).toContain('aria-label="Гриф &quot;A&quot;"');
    expect(svg.match(/class="mb-note /g)).toHaveLength(1);
  });
  it('декоративный гриф скрыт от чтения с экрана; отмеченная позиция рисуется кольцом', () => {
    const svg = boardSvg({ fretMin: 6, fretMax: 11, current: 'A:10', decorative: true });
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).not.toContain('role="img"');
    expect(svg).toContain('mb-current-ring');
  });
});
