import { describe, expect, it } from 'vitest';
import type { PlaybackConfig } from '../src/audio/plan';
import { buildExercise, createExerciseSpec } from '../src/exercises';
import {
  junctionText, junctions, loopAround, nextView, playbackConfig, plural, progressText, shiftText, suggestion, upcomingJunction,
} from '../src/ui/play/model';
import { createEnginePort, mapPlaybackState, type EnginePlayerLike, type RawPlaybackState } from '../src/ui/play/port';

const ex1 = () => buildExercise(createExerciseSpec('connect-forms'));
const raw = (patch: Partial<RawPlaybackState>): RawPlaybackState => ({
  state: 'running', phase: 'practice', audioTime: 1, bpm: 80, noteIndex: 3, beat: 2, passIndex: 0, totalPasses: null, pauseReason: null, ...patch,
});

describe('переход между сегментами', () => {
  it('EX-1: G/7 третьим пальцем → сдвиг на 2 лада → G/9 третьим', () => {
    const list = junctions(ex1());
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ index: 8, shift: 2 });
    expect(junctionText(list[0])).toBe('G/7 (палец 3) → сдвиг на 2 лада → G/9 (палец 3)');
    expect(loopAround(ex1(), list[0])).toEqual({ from: 4, toExclusive: 12 });
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

describe('конфигурация звука', () => {
  const base = { bpm: 76, countIn: true, loop: true, ladder: false, range: null };
  it('восьмые, позиции плана, по кругу или один проход', () => {
    const plan = ex1();
    const config = playbackConfig(plan, base);
    expect(config).toMatchObject({ duration: 'eighth', bpm: 76, countIn: true, repeat: 'infinite' });
    expect(config.notes).toBe(plan.positions);
    expect(config.range).toBeUndefined();
    expect(playbackConfig(plan, { ...base, loop: false, countIn: false })).toMatchObject({ repeat: 'once', countIn: false });
  });
  it('лестница темпа +4 до +24 и не выше 220; петля передаёт фрагмент', () => {
    expect(playbackConfig(ex1(), { ...base, ladder: true }).repeat).toEqual({ kind: 'ladder', start: 76, end: 100, step: 4, repeatsPerTempo: 1 });
    expect(playbackConfig(ex1(), { ...base, bpm: 210, ladder: true }).repeat).toMatchObject({ start: 210, end: 220 });
    expect(playbackConfig(ex1(), { ...base, range: { from: 4, toExclusive: 12 } }).range).toEqual({ from: 4, toExclusive: 12 });
    expect(playbackConfig(ex1(), { ...base, bpm: 500 }).bpm).toBe(220);
  });
});

describe('предложения после самооценки', () => {
  it('«Чисто»: темп +4 и следующий вид; в «По памяти» вида дальше нет', () => {
    const clean = suggestion('clean', { bpm: 76, view: 'both', plan: ex1() });
    expect(clean.actions).toEqual([{ kind: 'bpm', bpm: 80, label: 'Темп 80' }, { kind: 'view', view: 'tab', label: 'Вид «Таб крупно» →' }]);
    expect(suggestion('clean', { bpm: 76, view: 'memory', plan: ex1() }).actions.map(action => action.kind)).toEqual(['bpm']);
    expect(nextView('memory')).toBeNull();
  });
  it('«С ошибками»: петля на ноты 5–12 вокруг перехода', () => {
    const errors = suggestion('errors', { bpm: 76, view: 'both', plan: ex1() });
    expect(errors.text).toBe('Оставь 76; включи петлю на ноты 5–12 — переход G/7 → G/9.');
    expect(errors.actions).toEqual([{ kind: 'loop', range: { from: 4, toExclusive: 12 }, label: 'Петля 5–12' }]);
    const single = suggestion('errors', { bpm: 76, view: 'both', plan: buildExercise(createExerciseSpec('pentatonic-form')) });
    expect(single.actions).toEqual([{ kind: 'loop', range: null, label: 'По кругу' }]);
  });
  it('«Не успевал»: темп −4, но не ниже 40', () => {
    expect(suggestion('slow', { bpm: 76, view: 'both', plan: ex1() }).actions).toEqual([{ kind: 'bpm', bpm: 72, label: 'Темп 72' }]);
    expect(suggestion('slow', { bpm: 40, view: 'both', plan: ex1() }).actions).toEqual([]);
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
    expect(progressText(state, 5, 16, { range: { from: 4, toExclusive: 12 } })).toBe('Нота 6 из 16 · проход 2 · петля 5–12');
  });
});

describe('порт звука', () => {
  it('состояние проигрывателя переводится в состояние экрана', () => {
    expect(mapPlaybackState(raw({ state: 'stopped', noteIndex: 4 }), true)).toMatchObject({ status: 'stopped', noteIndex: null, countBeat: null });
    expect(mapPlaybackState(raw({ state: 'starting', noteIndex: null }), true)).toMatchObject({ status: 'counting', countBeat: null });
    expect(mapPlaybackState(raw({ state: 'starting', noteIndex: null }), false)).toMatchObject({ status: 'playing' });
    expect(mapPlaybackState(raw({ phase: 'count-in', beat: 3, noteIndex: null }), true)).toMatchObject({ status: 'counting', countBeat: 3, noteIndex: null });
    expect(mapPlaybackState(raw({ state: 'finishing' }), true)).toMatchObject({ status: 'playing', noteIndex: 3 });
    expect(mapPlaybackState(raw({ state: 'paused', pauseReason: 'hidden' }), true)).toMatchObject({ status: 'paused', noteIndex: 3, pauseReason: 'hidden' });
    expect(mapPlaybackState(raw({ state: 'paused', phase: 'count-in', noteIndex: null }), true)).toMatchObject({ status: 'paused', noteIndex: null });
    expect(mapPlaybackState(raw({ state: 'finished', noteIndex: null, passIndex: 2 }), true)).toMatchObject({ status: 'finished', passIndex: 2 });
  });

  it('createEnginePort: «С начала» = stop + start, пауза с причиной, освобождение один раз', async () => {
    const calls: string[] = [];
    let current = raw({ state: 'stopped', noteIndex: null });
    const player: EnginePlayerLike = {
      async start(config: PlaybackConfig) { calls.push(`start:${config.countIn}`); current = raw({ state: 'starting', noteIndex: null }); },
      pause(reason?: string) { calls.push(`pause:${reason}`); },
      async resume() { calls.push('resume'); },
      stop() { calls.push('stop'); },
      setBpm(bpm: number) { calls.push(`bpm:${bpm}`); },
      playbackState: () => current,
      dispose() { calls.push('dispose'); },
    };
    const port = createEnginePort(player);
    const config = playbackConfig(ex1(), { bpm: 76, countIn: false, loop: true, ladder: false, range: null });
    await port.start(config);
    expect(port.state().status).toBe('playing');
    port.pause();
    port.pause('hidden');
    await port.resume();
    port.setBpm(80);
    await port.restart({ ...config, countIn: true });
    expect(port.state().status).toBe('counting');
    port.dispose();
    port.dispose();
    expect(calls).toEqual(['start:false', 'pause:manual', 'pause:hidden', 'resume', 'bpm:80', 'stop', 'start:true', 'dispose']);
    expect(port.state().status).toBe('stopped');
    expect(() => port.stop()).toThrow();
  });
});
