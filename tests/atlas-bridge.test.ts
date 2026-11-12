import { describe, expect, it } from 'vitest';
import { atlasBridge, ATLAS_CHECK_COUNT } from '../src/app/atlas-bridge';
import { buildExercise } from '../src/exercises';
import { getBoxCatalogue } from '../src/music/boxes';

/** Мостики «Грифа» (P13-08): из формы атласа — упражнение экрана игры и «Проверь себя» по тому же материалу. */
describe('мостики атласа «Гриф»', () => {
  const instance = (root: string, structureId: Parameters<typeof getBoxCatalogue>[1], shapeId: string, index = 0) =>
    getBoxCatalogue(root, structureId).filter(box => box.selection.shapeId === shapeId)[index]!.selection;

  it('форма пентатоники → «Форма пентатоники вверх-вниз» с той же тоникой, структурой и формой', () => {
    const box = instance('A', 'minor-pentatonic', 'penta-a');
    const bridge = atlasBridge({ root: 'A', structureId: 'minor-pentatonic', box });
    expect(bridge.exercise).toEqual({ version: 'exercise-v1', templateId: 'pentatonic-form', params: { root: 'A', structureId: 'minor-pentatonic', shapeId: 'penta-a' } });
    expect(bridge.check).toEqual({ version: 'check-v1', exercise: bridge.exercise, kind: 'find-degree', count: ATLAS_CHECK_COUNT, ear: false });
    expect(bridge).toMatchObject({ reason: '', note: '' });
    // Независимый контрольный пример VIS-01 r5: форма A минорной пентатоники A — восемь позиций на ладах 5–8.
    const ids = buildExercise(bridge.exercise!).positions.map(position => position.id);
    expect([...new Set(ids)].sort()).toEqual(['A:5', 'A:7', 'D:5', 'D:7', 'E:5', 'E:8', 'G:5', 'G:7']);
  });

  it('компактная форма гаммы → «Гамма в одной позиции», трезвучия → «Арпеджио 1–3–5–8»; диез в тонике сохраняется', () => {
    const scale = atlasBridge({ root: 'F#', structureId: 'natural-minor', box: instance('F#', 'natural-minor', 'compact-a') });
    expect(scale.exercise).toMatchObject({ templateId: 'scale-compact', params: { root: 'F♯', structureId: 'natural-minor', shapeId: 'compact-a' } });
    const triad = atlasBridge({ root: 'C', structureId: 'major-triad', box: instance('C', 'major-triad', 'compact-e') });
    expect(triad.exercise).toMatchObject({ templateId: 'arpeggio-1358', params: { root: 'C', structureId: 'major-triad', shapeId: 'compact-e' } });
    expect(triad.check?.exercise).toBe(triad.exercise);
  });

  it('верхний экземпляр формы честно поясняется: упражнение играет нижний', () => {
    const upper = instance('A', 'minor-pentatonic', 'penta-a', 1);
    const bridge = atlasBridge({ root: 'A', structureId: 'minor-pentatonic', box: upper });
    expect(bridge.exercise).not.toBeNull();
    expect(bridge.note).toBe('Упражнение и проверка — по нижнему экземпляру этой формы: лады 5–8.');
  });

  it('без учебной формы мостиков нет, причина названа', () => {
    const bridge = atlasBridge({ root: 'A', structureId: 'minor-pentatonic', box: null });
    expect(bridge).toMatchObject({ exercise: null, check: null });
    expect(bridge.reason).toMatch(/учебную форму/);
  });
});
