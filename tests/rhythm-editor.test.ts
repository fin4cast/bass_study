import { describe, expect, it } from 'vitest';
import { applyRhythmProjectEdit, copyRhythmBar, playbackForRhythmRun, type RhythmProjectEdit } from '../src/rhythm/editor';
import { DEFAULT_RHYTHM_PREFERENCES, createDefaultRhythmProject, type RhythmProject } from '../src/rhythm/model';

const createdAt = '2026-11-09T12:00:00.000Z';
const now = Date.parse(createdAt) + 1000;
const createProject = () => createDefaultRhythmProject('test-edit', 'Редактор', createdAt);
const edit = (project: RhythmProject, command: RhythmProjectEdit) => applyRhythmProjectEdit(project, DEFAULT_RHYTHM_PREFERENCES, command, now).project;
const pattern = (project: RhythmProject) => project.patterns.find(item => item.id === project.activePatternId)!;

describe('чистые команды редактора ритма', () => {
  it('добавляет пустые такты до четвёртого и копирует их по идентификаторам дорожек', () => {
    const original = createProject();
    const fourBars = ([2, 3, 4] as const).reduce((project, bars) => {
      const grown = edit(project, { kind: 'resize', bars });
      expect(pattern(grown).lanes.every(lane => lane.steps.length === bars * 16 &&
        lane.steps.slice(-16).every(step => step === 0) && lane.velocities.slice(-16).every(value => value === 0))).toBe(true);
      return grown;
    }, original);
    const copy = copyRhythmBar(fourBars, 0);
    const pasted = edit(fourBars, { kind: 'bar', bar: 2, source: copy });
    expect(copyRhythmBar(pasted, 2)).toEqual(copy);
    const shortened = edit(pasted, { kind: 'resize', bars: 2 });
    expect(pattern(shortened).lanes[0].steps).toHaveLength(32);
    expect(pattern(original).bars).toBe(1);
    expect(original.updatedAt).toBe(createdAt);
    expect(pasted.updatedAt).toBe(new Date(now).toISOString());
  });

  it('берёт силу нового удара из дорожки и оставляет заданные силы других шагов', () => {
    const base = createProject();
    const channelId = base.channels[0].id;
    const defaults = edit(base, { kind: 'lane-default', id: channelId, control: 'accent', value: 91 });
    const accent = edit(defaults, { kind: 'step', channelId, bar: 0, step: 1, level: 2 });
    const normal = edit(accent, { kind: 'step', channelId, bar: 0, step: 2, level: 1, velocity: .32 });
    expect(pattern(normal).lanes[0].steps.slice(0, 3)).toEqual([2, 2, 1]);
    expect(pattern(normal).lanes[0].velocities.slice(0, 3)).toEqual([1, .91, .32]);
    const cleared = edit(normal, { kind: 'step', channelId, bar: 0, step: 1, level: 0 });
    expect(pattern(cleared).lanes[0].velocities[1]).toBe(0);
    expect(cleared.channels[1].velocityDefaults).toEqual(base.channels[1].velocityDefaults);
  });

  it('переупорядочивает цепочку без замены ID и сохраняет независимые настройки проигрывания', () => {
    const base = createProject();
    const [first, second] = base.chain;
    const moved = edit(base, { kind: 'move-clip', id: first.id, move: 'right' });
    expect(moved.chain.slice(0, 2)).toEqual([second, first]);
    const removed = edit(moved, { kind: 'move-clip', id: first.id, move: 'remove' });
    const added = edit(removed, { kind: 'add-clip', id: 'new-clip' });
    const assigned = edit(added, { kind: 'assign-clip', id: 'new-clip', patternId: 'C' });
    expect(assigned.chain.at(-1)).toEqual({ id: 'new-clip', patternId: 'C' });
    expect(edit(assigned, { kind: 'settings', change: { scope: 'chain', repeat: 'once' } })).toMatchObject({
      chain: assigned.chain, scope: 'chain', repeat: 'once',
    });
  });

  it('связывает BPM в обе стороны и сохраняет текущий отсчёт до нового старта', () => {
    const initial = { ...DEFAULT_RHYTHM_PREFERENCES, metronome: { ...DEFAULT_RHYTHM_PREFERENCES.metronome, bpm: 108 } };
    const linked = applyRhythmProjectEdit(createProject(), initial, { kind: 'overlay', enabled: true }, now);
    expect(linked.project.bpm).toBe(108);
    const next = applyRhythmProjectEdit(linked.project, linked.preferences, { kind: 'settings', change: { bpm: 125, countIn: true } }, now);
    expect(next.preferences.metronome.bpm).toBe(125);
    expect(playbackForRhythmRun(next, linked).project!.countIn).toBe(false);
    expect(playbackForRhythmRun(next, null).project!.countIn).toBe(true);
    const disabled = applyRhythmProjectEdit(next.project, next.preferences, { kind: 'overlay', enabled: false }, now);
    const independent = applyRhythmProjectEdit(disabled.project, disabled.preferences, { kind: 'settings', change: { bpm: 96 } }, now);
    expect(independent.preferences.metronome.bpm).toBe(125);
  });
});
