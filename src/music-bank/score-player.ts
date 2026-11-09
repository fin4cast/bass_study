import { musicBankAssets, type AlphaTabModule } from './engine';
import type { MusicBankPreferences } from './model';

export type BankApi = InstanceType<AlphaTabModule['AlphaTabApi']>;
export type BankScore = NonNullable<BankApi['score']>;
export type ScorePosition = { readonly currentTime: number; readonly endTime: number };
export type ScoreTransport = 'stopped' | 'paused' | 'playing';

export function destroyScorePlayer(player: BankApi | null) {
  if (!player) return;
  try { try { player.stop(); } finally { player.destroy(); } }
  catch (error) { console.warn('Не удалось полностью освободить проигрыватель партитуры.', error); }
}

export function createScorePlayer(host: HTMLElement, scrollElement: HTMLElement, module: AlphaTabModule, settings: MusicBankPreferences, events: {
  ready(): void;
  error(error: unknown): void;
  position(position: ScorePosition): void;
  bar(index: number): void;
  transport(state: ScoreTransport): void;
}) {
  const assets = musicBankAssets();
  const api = new module.AlphaTabApi(host, {
    core: { scriptFile: assets.moduleUrl, fontDirectory: assets.fontDirectory, engine: 'svg' },
    display: { staveProfile: settings.notation.staff ? settings.notation.tab ? module.StaveProfile.ScoreTab : module.StaveProfile.Score : module.StaveProfile.Tab },
    player: { playerMode: module.PlayerMode.EnabledSynthesizer, soundFont: assets.soundFont, enableCursor: true,
      // alphaTab sends its settings to a worker, so pass the local pane by selector.
      enableUserInteraction: true, scrollElement: `#${CSS.escape(scrollElement.id)}`, scrollOffsetY: -12,
      scrollMode: settings.follow ? module.ScrollMode.Continuous : module.ScrollMode.Off },
  });
  let rendered = false, midi = false, synth = false, waiting = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  function cancelPreparation() {
    waiting = false;
    clearTimeout(timeout);
  }
  function settle() {
    if (!waiting || !rendered || !midi || !synth || !api.isReadyForPlayback) return;
    cancelPreparation();
    events.ready();
  }

  api.error.on(events.error);
  api.renderFinished.on(() => { rendered = true; settle(); });
  api.midiLoaded.on(() => { midi = true; settle(); });
  // alphaTab applies source volumes after raising playerReady.
  api.playerReady.on(() => queueMicrotask(() => { synth = true; settle(); }));
  api.playerPositionChanged.on(events.position);
  api.playedBeatChanged.on(beat => events.bar(beat.voice.bar.index));
  api.playerStateChanged.on(event => events.transport(event.state === 1 ? 'playing' : event.stopped ? 'stopped' : 'paused'));

  return {
    api, cancelPreparation,
    prepare(score: BankScore, tracks: readonly number[]) {
      waiting = true;
      timeout = setTimeout(() => events.error(new Error('Подготовка партитуры заняла больше минуты. Выбери файл повторно.')), 60_000);
      api.player?.resetChannelStates();
      api.renderScore(score, tracks.length ? [...tracks] : [0]);
    },
  };
}
