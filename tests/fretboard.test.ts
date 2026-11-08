import { describe, expect, it } from 'vitest';
import { annotatePositions, createStructure, getPositions } from '../src/music';
import { createBoxSelection, getBoxInstance } from '../src/music/boxes';
import { renderOctaveLegend, renderStudyFretboard, type StudyFretboardOptions } from '../src/ui/fretboard';

function options(overrides: Partial<StudyFretboardOptions> = {}): StudyFretboardOptions {
  const structure = createStructure('A', 'minor-pentatonic');
  return {
    width: 520, positions: annotatePositions(getPositions({ strings: ['E', 'A', 'D', 'G'], fretMin: 0, fretMax: 24 }), structure),
    structure, fretMin: 0, fretMax: 24, selectedId: 'E:5', activeId: 'E:5', box: null,
    showFingers: false, showOctaves: true, showInterval: true, sharedIds: new Set(), labelMode: 'notes', ...overrides,
  };
}

describe('развёртка учебного грифа', () => {
  it('0–24 переносятся без потерь или повторений физических позиций и ладов', () => {
    const source = options();
    const markup = renderStudyFretboard(source);
    const ids = [...markup.matchAll(/data-position="([^"]+)"/g)].map(match => match[1]);
    const frets = [...markup.matchAll(/class="fret-number" data-fret="(\d+)"/g)].map(match => Number(match[1]));
    const partCount = [...markup.matchAll(/data-testid="fretboard"/g)].length;
    expect(ids).toHaveLength(100);
    expect(new Set(ids).size).toBe(100);
    expect([...ids].sort()).toEqual(source.positions.map(position => position.id).sort());
    expect(frets).toEqual(Array.from({ length: 25 }, (_, index) => index));
    expect(partCount).toBeGreaterThan(1);
    expect([...markup.matchAll(/class="string-name"/g)]).toHaveLength(4 * partCount);
    expect([...markup.matchAll(/tabindex="0"/g)]).toHaveLength(1);
  });

  it('пустой выбранный диапазон сохраняет все четыре строки и номера ладов', () => {
    const markup = renderStudyFretboard(options({ width: 850, fretMax: 12, positions: [] }));
    expect(markup).toContain('data-testid="empty-state"');
    expect([...markup.matchAll(/class="fret-number"/g)]).toHaveLength(13);
    expect([...markup.matchAll(/class="string-name"/g)]).toHaveLength(4);
    expect(markup).not.toContain('data-position=');
  });

  it('сохраняет выбор, точную форму, пальцы и один соединитель', () => {
    const box = getBoxInstance(createBoxSelection({ root: 'A', structureId: 'minor-pentatonic', shapeId: 'penta-a', anchorFret: 5, anchorString: 'E' }));
    const source = options({ width: 900, fretMax: 12, box, selectedId: 'D:7', activeId: 'D:7', showFingers: true, sharedIds: new Set(['D:7']) });
    const markup = renderStudyFretboard(source);
    expect([...markup.matchAll(/data-interval-link="true"/g)]).toHaveLength(1);
    expect([...markup.matchAll(/class="finger-label"/g)]).toHaveLength(8);
    expect(markup).toMatch(/class="position in-structure is-large in-box root-position selected-position shared-box-position" data-position="D:7"/);
    expect(markup).toContain('<circle class="note-marker" r="23"/>');
    expect(renderOctaveLegend(source)).toContain('A2 — общая тоника соседних участков.');
    expect([...renderOctaveLegend(source).matchAll(/data-complete="true"/g)]).toHaveLength(1);
    expect(markup).not.toContain('is-interval-target'); // Another tonic keeps its amber role.
    expect(renderStudyFretboard({ ...source, selectedId: 'A:7' })).toContain('selected-position is-interval-target');
    expect(renderStudyFretboard({ ...source, selectedId: 'A:7', showInterval: false })).not.toContain('is-interval-target');
  });
});
