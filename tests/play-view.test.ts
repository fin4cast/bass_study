import { describe, expect, it } from 'vitest';
import type { PlaybackConfig } from '../src/audio/plan';
import { buildExercise, createExerciseSpec } from '../src/exercises';
import {
  DEFAULT_PLAY_SETTINGS, junctionText, junctions, ladderAvailable, loopAround, nextView, playbackConfig, plural, progressText, shiftText, suggestion,
  timelineFor, upcomingJunction, volumesFor,
} from '../src/ui/play/model';
import { createEnginePort, mapPlaybackState, type EnginePlayerLike, type RawPlaybackState } from '../src/ui/play/port';

const ex1 = () => buildExercise(createExerciseSpec('connect-forms'));
const base = { ...DEFAULT_PLAY_SETTINGS, bpm: 76 };
const raw = (patch: Partial<RawPlaybackState>): RawPlaybackState => ({
  state: 'running', phase: 'practice', audioTime: 1, bpm: 80, noteIndex: 3, stepIndex: 3, beat: 2, barInPass: 0, passIndex: 0, totalPasses: null, pauseReason: null, ...patch,
});

describe('переход между сегментами', () => {
  it('EX-1: G/7 третьим пальцем → сдвиг на 2 лада → G/9 третьим; петля — такты 1–2', () => {
    const list = junctions(ex1());
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ index: 8, shift: 2 });
    expect(junctionText(list[0])).toBe('G/7 (палец 3) → сдвиг на 2 лада → G/9 (палец 3)');
    // Нота 8 (конец формы A) — в такте 1, нота 9 (начало формы B) — в такте 2.
    expect(loopAround(timelineFor(ex1(), base), list[0])).toEqual({ fromBar: 0, toBar: 2 });
  });
  it('ближайший стык впереди, после последнего — снова первый', () => {
    const plan = buildExercise(createExerciseSpec('pentatonic-neck'));
    const list = junctions(plan);
    expect(list.length).toBe(4);
    expect(upcomingJunction(list, null)).toBe(list[0]);
    expect(upcomingJunction(list, list[1].index - 1)).toBe(list[1]);
    expect(upcomingJunction(list, list[1].index)).toBe(list[2]);
    expect(upcomingJunction(list, plan.notes.length - 1)).toBe(list[0]);
    expect(upcomingJunction([], 3)).toBeNull();
  });
  it('одно-сегментное упражнение без стыков', () => {
    expect(junctions(buildExercise(createExerciseSpec('pentatonic-form')))).toEqual([]);
  });
  it('согласование и направление сдвига', () => {
    expect([1, 2, 5, 11, 21, 22].map(n => plural(n, 'лад', 'лада', 'ладов'))).toEqual(['лад', 'лада', 'ладов', 'ладов', 'лад', 'лада']);
    expect(shiftText(-1)).toBe('сдвиг вниз на 1 лад');
    expect(shiftText(0)).toBe('без сдвига');
  });
});

describe('конфигурация звука (D-050)', () => {
  it('шкала шагов, отсчёт тактами, по кругу или один проход; метроном по выбору', () => {
    const plan = ex1();
    const timeline = timelineFor(plan, base);
    const config = playbackConfig(plan, timeline, base);
    expect(config).toMatchObject({ bpm: 76, countInBars: 1, repeat: 'infinite', metronome: { enabled: true, subdivision: 'quarter', mode: 'all' }, swing: 50, groove: null });
    expect(config.notes).toBe(plan.positions);
    expect(config.steps).toHaveLength(timeline.steps.length);
    expect(config.range).toBeUndefined();
    expect(playbackConfig(plan, timeline, { ...base, loop: false, countInBars: 2 })).toMatchObject({ repeat: 'once', countInBars: 2 });
    expect(playbackConfig(plan, timeline, { ...base, metronome: 'two-four' }).metronome).toMatchObject({ mode: 'two-four' });
    expect(playbackConfig(plan, timeline, { ...base, metronome: 'eighths' }).metronome).toMatchObject({ subdivision: 'eighth' });
    expect(playbackConfig(plan, timeline, { ...base, metronome: 'off' }).metronome).toMatchObject({ enabled: false });
  });
  it('лестница +4 каждые 2 прохода до цели; без запаса до цели — недоступна; петля в тактах → шаги', () => {
    const plan = ex1();
    const timeline = timelineFor(plan, base);
    expect(playbackConfig(plan, timeline, { ...base, ladder: true, targetBpm: 96 }).repeat).toEqual({ kind: 'ladder', start: 76, end: 96, step: 4, repeatsPerTempo: 2 });
    expect(ladderAvailable({ bpm: 96, targetBpm: 96 })).toBe(false);
    expect(playbackConfig(plan, timeline, { ...base, ladder: true, targetBpm: 70 }).repeat).toBe('infinite');
    const range = playbackConfig(plan, timeline, { ...base, range: { fromBar: 1, toBar: 2 } }).range!;
    expect(timeline.steps.slice(range.from, range.toExclusive).every(step => step.bar === 1)).toBe(true);
    expect(playbackConfig(plan, timeline, { ...base, bpm: 500 }).bpm).toBe(220);
  });
  it('подложка: удары пресета и его свинг; шаффл-ритм без подложки свингует сам', () => {
    const plan = ex1();
    const shuffle = playbackConfig(plan, timelineFor(plan, base), { ...base, groove: 'shuffle' });
    expect(shuffle.swing).toBe(66);
    expect(shuffle.groove).toHaveLength(16);
    expect(shuffle.groove![0].map(hit => hit.sound)).toContain('kick');
    const swung = { ...base, rhythm: 'shuffle' as const };
    expect(playbackConfig(plan, timelineFor(plan, swung), swung).swing).toBe(66);
  });
  it('эталон «авто» молчит только в «По памяти»; «тихо», «выкл»; эхо включает эталон', () => {
    expect(volumesFor(base, 'both').bass).toBeGreaterThan(0.5);
    expect(volumesFor(base, 'memory').bass).toBe(0);
    expect(volumesFor({ ...base, reference: 'on' }, 'memory').bass).toBeGreaterThan(0.5);
    expect(volumesFor({ ...base, reference: 'quiet' }, 'both').bass).toBe(0.25);
    expect(volumesFor({ ...base, reference: 'off' }, 'board').bass).toBe(0);
    expect(volumesFor({ ...base, reference: 'off', echo: true }, 'memory').bass).toBeGreaterThan(0.5);
    expect(volumesFor({ ...base, click: 0.2, grooveVolume: 0.3 }, 'both')).toMatchObject({ click: 0.2, groove: 0.3 });
  });
});

describe('предложения после самооценки', () => {
  const context = (view: 'both' | 'memory', plan = ex1()) => ({ bpm: 76, view, plan, timeline: timelineFor(plan, base) });
  it('«Чисто»: темп +4 и следующий вид; в «По памяти» вида дальше нет', () => {
    const clean = suggestion('clean', context('both'));
    expect(clean.actions).toEqual([{ kind: 'bpm', bpm: 80, label: 'Темп 80' }, { kind: 'view', view: 'tab', label: 'Вид «Таб» →' }]);
    expect(suggestion('clean', context('memory')).actions.map(action => action.kind)).toEqual(['bpm']);
    expect(nextView('memory')).toBeNull();
  });
  it('«С ошибками»: петля на такты вокруг перехода; без перехода — подсказка выбрать такт', () => {
    const errors = suggestion('errors', context('both'));
    expect(errors.text).toBe('Оставь 76; включи петлю на такты 1–2 — переход G/7 → G/9.');
    expect(errors.actions).toEqual([{ kind: 'loop', range: { fromBar: 0, toBar: 2 }, label: 'Петля: такты 1–2' }]);
    const single = suggestion('errors', context('both', buildExercise(createExerciseSpec('pentatonic-form'))));
    expect(single.actions).toEqual([]);
    expect(single.text).toMatch(/клавишей L/);
  });
  it('«Не успевал»: темп −4, но не ниже 40', () => {
    expect(suggestion('slow', context('both')).actions).toEqual([{ kind: 'bpm', bpm: 72, label: 'Темп 72' }]);
    expect(suggestion('slow', { ...context('both'), bpm: 40 }).actions).toEqual([]);
  });
});

describe('прогресс', () => {
  const state = { status: 'playing' as const, passIndex: 1, totalPasses: null, pauseReason: null };
  it('строки «Нота N из M · проход K»', () => {
    expect(progressText({ ...state, status: 'stopped' }, null, 16)).toBe('Нота 0 из 16');
    expect(progressText({ ...state, status: 'stopped' }, null, 16, { fromStart: true })).toBe('Нота 0 из 16 · с начала');
    expect(progressText({ ...state, status: 'counting' }, null, 16)).toBe('Отсчёт · нота 0 из 16');
    expect(progressText(state, 5, 16)).toBe('Нота 6 из 16 · проход 2');
    expect(progressText({ ...state, totalPasses: 7 }, 5, 16)).toBe('Нота 6 из 16 · проход 2 из 7');
    expect(progressText({ ...state, status: 'paused', pauseReason: 'hidden' }, 5, 16)).toBe('Нота 6 из 16 · проход 2 · пауза: вкладка скрыта');
    expect(progressText(state, 5, 16, { range: { fromBar: 1, toBar: 3 } })).toBe('Нота 6 из 16 · проход 2 · петля: такты 2–3');
  });
});

describe('порт звука', () => {
  it('состояние проигрывателя переводится в состояние экрана: шаг, доля и такт прохода', () => {
    expect(mapPlaybackState(raw({ state: 'stopped', noteIndex: 4 }), true)).toMatchObject({ status: 'stopped', noteIndex: null, step: null, countBeat: null });
    expect(mapPlaybackState(raw({ state: 'starting', noteIndex: null }), true)).toMatchObject({ status: 'counting', countBeat: null });
    expect(mapPlaybackState(raw({ state: 'starting', noteIndex: null }), false)).toMatchObject({ status: 'playing' });
    expect(mapPlaybackState(raw({ phase: 'count-in', beat: 3, noteIndex: null }), true)).toMatchObject({ status: 'counting', countBeat: 3, noteIndex: null, step: null });
    expect(mapPlaybackState(raw({ state: 'finishing', beat: 2, barInPass: 1 }), true)).toMatchObject({ status: 'playing', noteIndex: 3, step: 3, beat: 2, barInPass: 1 });
    expect(mapPlaybackState(raw({ state: 'paused', pauseReason: 'hidden' }), true)).toMatchObject({ status: 'paused', noteIndex: 3, step: 3, pauseReason: 'hidden' });
    expect(mapPlaybackState(raw({ state: 'paused', phase: 'count-in', noteIndex: null }), true)).toMatchObject({ status: 'paused', noteIndex: null, step: null });
    expect(mapPlaybackState(raw({ state: 'finished', noteIndex: null, passIndex: 2 }), true)).toMatchObject({ status: 'finished', passIndex: 2 });
  });

  it('createEnginePort: «С начала» = stop + start, пауза с причиной, громкости, освобождение один раз', async () => {
    const calls: string[] = [];
    let current = raw({ state: 'stopped', noteIndex: null });
    const player: EnginePlayerLike = {
      async start(config: PlaybackConfig) { calls.push(`start:${config.countInBars}`); current = raw({ state: 'starting', noteIndex: null }); },
      pause(reason?: string) { calls.push(`pause:${reason}`); },
      async resume() { calls.push('resume'); },
      stop() { calls.push('stop'); },
      setBpm(bpm: number) { calls.push(`bpm:${bpm}`); },
      setVolumes(volumes) { calls.push(`volumes:${volumes.bass}`); },
      playbackState: () => current,
      dispose() { calls.push('dispose'); },
    };
    const port = createEnginePort(player);
    const plan = ex1();
    const config = playbackConfig(plan, timelineFor(plan, base), { ...base, countInBars: 0 });
    await port.start(config);
    expect(port.state().status).toBe('playing');
    port.pause();
    port.pause('hidden');
    await port.resume();
    port.setBpm(80);
    port.setVolumes({ bass: 0 });
    await port.restart({ ...config, countInBars: 1 });
    expect(port.state().status).toBe('counting');
    port.dispose();
    port.dispose();
    expect(calls).toEqual(['start:0', 'pause:manual', 'pause:hidden', 'resume', 'bpm:80', 'volumes:0', 'stop', 'start:1', 'dispose']);
    expect(port.state().status).toBe('stopped');
    expect(() => port.stop()).toThrow();
  });
});
