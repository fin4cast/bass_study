/**
 * Порт звука экрана игры. Экран не знает устройства проигрывателя: он запускает конфигурацию,
 * ставит паузу и читает состояние по аудиочасам. `createEnginePort` связывает порт с `createPlayer()`.
 */
import { createPlayer, type PlaybackConfig, type PlayerVolumes } from '../../audio/engine';

export type PlayStatus = 'stopped' | 'counting' | 'playing' | 'paused' | 'finished';

export interface PlayState {
  readonly status: PlayStatus;
  /** Индекс ноты плана, которая звучит (или на которой стоит пауза); null — ещё не звучала. */
  readonly noteIndex: number | null;
  /** Шаг шкалы прохода (D-050); у паузы в музыке — шаг паузы, `noteIndex` держит прозвучавшую ноту. */
  readonly step: number | null;
  /** Доля такта 1…4 и такт от начала прохода — для пульса «По памяти». */
  readonly beat: number;
  readonly barInPass: number;
  /** Доля отсчёта 1…4, пока идёт отсчёт; иначе null. */
  readonly countBeat: number | null;
  readonly passIndex: number;
  readonly totalPasses: number | null;
  readonly bpm: number;
  /** Аудиочасы, с. По ним экран считает активное время прохода. */
  readonly audioTime: number;
  readonly pauseReason: string | null;
}

export interface PlaybackPort {
  start(config: PlaybackConfig): Promise<void>;
  pause(reason?: string): void;
  /** Продолжение со следующей ноты без отсчёта. */
  resume(): Promise<void>;
  /** Остановка и новый запуск с отсчётом. */
  restart(config: PlaybackConfig): Promise<void>;
  /** Возврат к первой ноте без запуска. */
  stop(): void;
  setBpm(bpm: number): void;
  /** Громкости эталона, клика и подложки; меняются сразу, без перезапуска. */
  setVolumes(volumes: Partial<PlayerVolumes>): void;
  state(): PlayState;
  dispose(): void;
}

/** Часть проигрывателя `createPlayer()`, которой пользуется порт. */
export interface EnginePlayerLike {
  start(config: PlaybackConfig): Promise<unknown>;
  pause(reason?: string): unknown;
  resume(): Promise<unknown>;
  stop(): unknown;
  setBpm(bpm: number): unknown;
  setVolumes(volumes: Partial<PlayerVolumes>): unknown;
  playbackState(): RawPlaybackState;
  dispose(): void;
}

export interface RawPlaybackState {
  readonly state: 'stopped' | 'starting' | 'running' | 'paused' | 'finishing' | 'finished';
  readonly phase: 'count-in' | 'practice';
  readonly audioTime: number;
  readonly bpm: number;
  readonly noteIndex: number | null;
  readonly stepIndex?: number | null;
  readonly beat: number;
  readonly barInPass?: number;
  readonly passIndex: number;
  readonly totalPasses: number | null;
  readonly pauseReason: string | null;
}

/** Состояние проигрывателя → состояние экрана. Чистая функция; `countIn` — включён ли отсчёт в запуске. */
export function mapPlaybackState(raw: RawPlaybackState, countIn: boolean): PlayState {
  const base = { passIndex: raw.passIndex, totalPasses: raw.totalPasses, bpm: raw.bpm, audioTime: raw.audioTime, pauseReason: raw.pauseReason,
    beat: raw.beat, barInPass: raw.barInPass ?? 0 };
  const idle = { noteIndex: null, step: null, countBeat: null } as const;
  const practice = raw.phase === 'practice';
  switch (raw.state) {
    case 'stopped': return { ...base, ...idle, status: 'stopped', pauseReason: null };
    case 'finished': return { ...base, ...idle, status: 'finished', pauseReason: null };
    case 'starting': return { ...base, ...idle, status: countIn ? 'counting' : 'playing' };
    case 'paused': return { ...base, ...idle, status: 'paused', noteIndex: practice ? raw.noteIndex : null, step: practice ? raw.stepIndex ?? null : null };
    default:
      if (raw.phase === 'count-in') return { ...base, ...idle, status: 'counting', countBeat: Math.min(4, Math.max(1, raw.beat)) };
      return { ...base, ...idle, status: 'playing', noteIndex: raw.noteIndex, step: raw.stepIndex ?? null };
  }
}

export function createEnginePort(player: EnginePlayerLike = createPlayer()): PlaybackPort {
  let countIn = true;
  let disposed = false;
  const guard = () => { if (disposed) throw new Error('Порт звука уже освобождён.'); };
  async function start(config: PlaybackConfig) {
    guard();
    countIn = (config.countInBars ?? (config.countIn === false ? 0 : 1)) > 0;
    await player.start(config);
  }
  return {
    start,
    pause(reason = 'manual') { guard(); player.pause(reason); },
    async resume() { guard(); await player.resume(); },
    async restart(config) { guard(); player.stop(); await start(config); },
    stop() { guard(); player.stop(); },
    setBpm(bpm) { guard(); player.setBpm(bpm); },
    setVolumes(volumes) { guard(); player.setVolumes(volumes); },
    state() {
      if (disposed) return { status: 'stopped', noteIndex: null, step: null, beat: 1, barInPass: 0, countBeat: null, passIndex: 0, totalPasses: null, bpm: 0, audioTime: 0, pauseReason: null };
      return mapPlaybackState(player.playbackState(), countIn);
    },
    dispose() { if (disposed) return; disposed = true; player.dispose(); },
  };
}
