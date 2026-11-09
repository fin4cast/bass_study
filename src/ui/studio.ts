import './studio.css';
import { renderPageHeader } from '../app/page-frame';
import type { AppPreferences } from '../storage';
import { mountMusicBank } from './music-bank';
import { bindPageTabs } from './page-tabs';
import { mountTracks } from './tracks';

type StudioView = 'scores' | 'audio';
type StudioSettings = Pick<AppPreferences, 'musicBank' | 'tracks'>;

export function mountStudio(container: HTMLElement, options: {
  observeHeight: Parameters<typeof mountMusicBank>[1]['observeHeight'];
  beforePlay(view: StudioView): boolean;
  onLeaveView(view: StudioView): void;
  onPreferencesChange(patch: Partial<StudioSettings>): void;
}) {
  const lifetime = new AbortController();
  container.innerHTML = `
    ${renderPageHeader('tracks', {
      descriptionText: 'Открой партитуру или локальную запись и повторяй фрагменты.',
      navigation: `<div class="workspace-tabs" role="tablist" aria-label="Материал раздела «Табулатура и ноты»">
        <button id="bank-scores-tab" type="button" role="tab" data-bank-view="scores" aria-controls="music-bank-mount">Партитуры</button>
        <button id="bank-audio-tab" type="button" role="tab" data-bank-view="audio" aria-controls="bank-audio-panel">Аудиозаписи</button>
      </div>`,
    })}
    <div id="music-bank-mount" role="tabpanel" aria-labelledby="bank-scores-tab"></div>
    <div id="bank-audio-panel" role="tabpanel" aria-labelledby="bank-audio-tab"><div id="legacy-tracks-mount"></div></div>`;
  const tracks = mountTracks(container.querySelector<HTMLElement>('#legacy-tracks-mount')!, {
    onBeforePlay: () => options.beforePlay('audio'),
    onPreferencesChange: () => options.onPreferencesChange({ tracks: tracks.getPreferences() }),
  });
  const scores = mountMusicBank(container.querySelector<HTMLElement>('#music-bank-mount')!, {
    observeHeight: options.observeHeight,
    onBeforePlay: () => options.beforePlay('scores'),
    onPreferencesChange: () => options.onPreferencesChange({ musicBank: scores.getPreferences() }),
  });
  let view: StudioView = 'scores';
  let visible = false;
  const tabs = bindPageTabs(container.querySelector<HTMLElement>('[role="tablist"]')!, {
    keys: ['scores', 'audio'] as const,
    canSelect: () => visible,
    signal: lifetime.signal,
    select(next) {
      if (view === next) return;
      options.onLeaveView(view);
      view = next;
      update();
    },
  });

  function update() {
    tracks.setVisible(visible && view === 'audio');
    scores.setVisible(visible && view === 'scores');
    tabs.setSelected(view);
  }

  update();
  return {
    get view() { return view; },
    setVisible(next: boolean) { visible = next; update(); },
    applyPreferences(settings: StudioSettings) {
      tracks.applyPreferences(settings.tracks);
      scores.applyPreferences(settings.musicBank);
      view = settings.musicBank?.file || !settings.tracks ? 'scores' : 'audio';
      update();
    },
    stop(next: StudioView) { if (next === 'audio') tracks.stop(); else scores.stop(); },
    cancelScorePreparation: scores.cancelPending,
    dispose() { lifetime.abort(); tracks.dispose(); scores.dispose(); },
  };
}
