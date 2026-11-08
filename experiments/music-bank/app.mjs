import * as alphaTab from '/vendor/alphaTab.mjs';
const byId = id => document.getElementById(id);
const state = { id: null, loading: false, rendered: false, midi: false, rangeError: false, error: null, tracks: [], sharedChannels: [], positionEvents: [], beatEvents: [], notation: { staff: true, tab: true } };
let requestToken = 0;
const api = new alphaTab.AlphaTabApi(byId('score'), {
  core: { fontDirectory: '/vendor/font/', engine: 'svg' },
  display: { staveProfile: alphaTab.StaveProfile.ScoreTab },
  player: { playerMode: alphaTab.PlayerMode.EnabledSynthesizer, soundFont: '/vendor/soundfont/sonivox.sf2',
    enableCursor: true, enableUserInteraction: true, scrollElement: '#sheet-scroll', scrollOffsetY: -12 }
});
api.masterVolume = 0.7;
function message(text, error = false) { byId('status').textContent = text; byId('status').dataset.error = String(error); }
function updateReady() {
  const ready = !!state.id && state.rendered && state.midi && api.isReadyForPlayback && !state.error;
  for (const id of ['play','pause','stop','apply-range','full-range']) byId(id).disabled = !ready;
  if (state.rangeError) byId('play').disabled = true;
  if (ready) { state.loading = false; message(`Открыто: ${api.score.title || state.id} · ${api.score.tracks.length} партий · ${api.score.masterBars.length} тактов`); }
}
api.error.on(error => { state.error = String(error); state.loading = false; message(`Ошибка: ${error}`, true); });
api.renderFinished.on(() => { state.rendered = true; updateReady(); });
api.midiLoaded.on(() => {
  // Worker сохраняет пользовательские overrides при loadMidi. После нового
  // материала каждый видимый контрол обязан совпасть с фактическим микшером.
  for (const track of api.score?.tracks || []) {
    const mix = state.tracks[track.index];
    api.changeTrackMute([track], !mix.audible); api.changeTrackSolo([track], mix.solo); api.changeTrackVolume([track], mix.volume);
  }
  state.midi = true; updateReady();
});
api.playerReady.on(updateReady);
api.playerPositionChanged.on(event => {
  state.positionEvents.push({ tick: event.currentTick, time: event.currentTime, total: event.endTime, at: performance.now() });
  if (state.positionEvents.length > 1000) state.positionEvents.shift();
  byId('seek').max = String(event.endTime / 1000); byId('seek').value = String(event.currentTime / 1000);
  const time = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${Math.floor(ms / 100) % 10}`;
  byId('position').textContent = `${time(event.currentTime)} / ${time(event.endTime)}`;
});
api.playedBeatChanged.on(event => { const beat = event.beat || event; const bar = beat.voice?.bar?.index;
  state.beatEvents.push({ at: performance.now(), bar }); if (state.beatEvents.length > 1000) state.beatEvents.shift();
  if (bar !== undefined) byId('current-bar').textContent = `Такт ${bar + 1} из ${api.score.masterBars.length}`;
});
function findShared(score) {
  const channels = new Map();
  for (const track of score.tracks) for (const channel of new Set([track.playbackInfo.primaryChannel, track.playbackInfo.secondaryChannel])) {
    channels.set(channel, [...(channels.get(channel) || []), track.index]);
  }
  return [...channels].filter(([, tracks]) => tracks.length > 1).map(([channel, tracks]) => ({ channel, tracks }));
}
function renderNotation() {
  if (!api.score) return;
  const visible = api.score.tracks.filter(t => state.tracks[t.index].visible);
  const renderable = state.notation.staff ? visible : state.notation.tab ? visible.filter(t => t.staves.some(s => s.isStringed)) : [];
  const shown = renderable.length > 0;
  byId('score').hidden = !shown; byId('score-empty').hidden = shown;
  byId('sheet-label').textContent = visible.length ? visible.map(t => t.name || `Партия ${t.index + 1}`).join(' · ') : 'Партитура';
  if (!shown) {
    byId('score-empty').querySelector('h3').textContent = !visible.length ? 'Выбери партии для чтения' : !state.notation.staff && !state.notation.tab ? 'Ноты и TAB скрыты' : 'У этих партий нет табулатуры';
    byId('score-empty').querySelector('p').textContent = !visible.length ? 'Отметь «Показывать» у нужного инструмента. Звук настраивается отдельно.' : !state.notation.staff && !state.notation.tab ? 'Воспроизведение продолжается. Верни любое представление, когда понадобится.' : 'Для ударных и инструментов без струн включи ноты. Звучание не меняется.';
    return;
  }
  api.settings.display.staveProfile = state.notation.staff ? state.notation.tab ? alphaTab.StaveProfile.ScoreTab : alphaTab.StaveProfile.Score : alphaTab.StaveProfile.Tab;
  api.updateSettings();
  api.renderTracks(renderable);
}
function mixer() {
  byId('tracks').replaceChildren();
  for (const track of api.score.tracks) {
    const settings = state.tracks[track.index];
    const tr = document.createElement('tr'); tr.dataset.track = String(track.index);
    const cell = document.createElement('td'); cell.textContent = track.name || `Партия ${track.index + 1}`;
    const detail = document.createElement('small');
    detail.textContent = track.staves.some(s => s.isPercussion) ? 'Ударные' : track.staves[0].isStringed ? `${track.staves[0].tuning.length} струн` : 'Мелодический инструмент';
    cell.append(detail); tr.append(cell);
    for (const [key, label] of [['visible','Показывать'],['audible','Звучит'],['solo','Solo'],['volume','Громкость']]) {
      const td = document.createElement('td'), input = document.createElement('input');
      input.type = key === 'volume' ? 'range' : 'checkbox'; input.dataset.control = key;
      input.setAttribute('aria-label', `${label}: ${track.name || track.index + 1}`);
      if (key === 'volume') { input.min = '0'; input.max = '1.5'; input.step = '0.05'; input.value = String(settings.volume); }
      else input.checked = settings[key];
      input.addEventListener(key === 'volume' ? 'input' : 'change', () => {
        settings[key] = key === 'volume' ? Number(input.value) : input.checked;
        if (key === 'visible') renderNotation();
        else if (key === 'audible') api.changeTrackMute([track], !settings.audible);
        else if (key === 'solo') api.changeTrackSolo([track], settings.solo);
        else { api.changeTrackVolume([track], settings.volume); td.querySelector('output').textContent = `${Math.round(settings.volume * 100)}%`; }
      });
      const labelElement = document.createElement('label'); labelElement.append(input);
      const text = document.createElement('span'); text.textContent = label; labelElement.append(text);
      if (key === 'volume') { const value = document.createElement('output'); value.textContent = `${Math.round(settings.volume * 100)}%`; td.append(input, value); }
      else td.append(labelElement);
      tr.append(td);
    }
    byId('tracks').append(tr);
  }
  byId('mixer-empty').hidden = api.score.tracks.length > 0;
  byId('track-count').textContent = String(api.score.tracks.length);
}
async function openBytes(bytes, id) {
  api.stop(); state.loading = true; state.error = null; message('Читаем партитуру…');
  try {
    // Сначала полностью разобрать кандидата. Не очищать прежний материал при отказе.
    const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, new alphaTab.Settings());
    // Сброс до генерации новой MIDI: не стирает заново рассчитанные транспозиции
    // новой партитуры и убирает solo даже с отсутствующего в ней старого канала.
    api.player?.resetChannelStates();
    state.id = id; state.rendered = false; state.midi = false; state.rangeError = false; state.positionEvents = []; state.beatEvents = [];
    state.sharedChannels = findShared(score);
    if (state.sharedChannels.length) throw new Error('Не удалось разделить звуковые каналы партий. Проверь подготовку локального движка.');
    state.tracks = score.tracks.map((t, index) => ({ visible: index === 0, audible: !t.playbackInfo.isMute, solo: t.playbackInfo.isSolo, volume: 1 }));
    byId('score').hidden = false; byId('title').textContent = `${score.artist || 'Исполнитель не указан'} — ${score.title || id}`;
    byId('warning').textContent = '';
    byId('current-bar').textContent = '';
    byId('song-info').textContent = `${score.tracks.length} партий · ${score.masterBars.length} тактов · ${score.tempo} BPM`;
    byId('from-bar').value = '1'; byId('to-bar').value = String(Math.min(4, score.masterBars.length));
    byId('from-bar').max = byId('to-bar').max = String(score.masterBars.length);
    byId('loop').checked = false; api.isLooping = false; api.playbackRange = null;
    byId('score-empty').hidden = true;
    api.renderScore(score, [0]); mixer(); renderNotation(); updateReady();
  } catch (error) {
    state.loading = false; state.error = String(error); message(`Файл не открыт: ${error}. ${state.id ? 'Прежняя партитура сохранена.' : ''}`, true);
  }
}
byId('sample').addEventListener('change', async event => {
  if (!event.target.value) return;
  const token = ++requestToken; state.error = null; state.loading = true;
  try { const response = await fetch(`/samples/${event.target.value}`); if (!response.ok) throw new Error(await response.text());
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (token === requestToken) await openBytes(bytes, event.target.value);
  } catch (error) { if (token === requestToken) { state.loading = false; state.error = String(error); message(String(error), true); } }
});
byId('local-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  const token = ++requestToken; state.error = null; state.loading = true;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (token === requestToken) await openBytes(bytes, file.name);
  } catch (error) {
    if (token === requestToken) { state.loading = false; state.error = String(error); message(`Не удалось прочитать файл: ${error}`, true); }
  }
});
byId('play').addEventListener('click', () => api.play());
byId('pause').addEventListener('click', () => api.pause());
byId('stop').addEventListener('click', () => api.stop());
byId('speed').addEventListener('change', event => { api.playbackSpeed = Number(event.target.value); });
byId('master').addEventListener('input', event => { api.masterVolume = Number(event.target.value); });
byId('seek').addEventListener('input', event => { api.timePosition = Number(event.target.value) * 1000; });
byId('loop').addEventListener('change', event => { api.isLooping = event.target.checked; });
byId('apply-range').addEventListener('click', () => {
  const from = Number(byId('from-bar').value), to = Number(byId('to-bar').value);
  const invalid = () => {
    api.pause(); api.playbackRange = null; api.isLooping = false; byId('loop').checked = false;
    state.rangeError = true; byId('play').disabled = true;
    message('Недопустимый диапазон: воспроизведение приостановлено, прежний фрагмент и повтор сняты. Исправь такты или выбери всю песню.', true);
  };
  if (!api.score || !Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > api.score.masterBars.length) { invalid(); return; }
  const bars = api.tickCache?.masterBars || [];
  const first = bars.find(b => b.masterBar.index === from - 1), last = bars.find(b => b.masterBar.index === to - 1);
  if (!first || !last || last.end <= first.start) { invalid(); return; }
  state.rangeError = false; byId('play').disabled = false;
  api.pause(); api.playbackRange = { startTick: first.start, endTick: last.end }; api.tickPosition = first.start;
  message(`Фрагмент: такты ${from}–${to}. В песне с репризами используется первое вхождение.`);
});
byId('full-range').addEventListener('click', () => { state.rangeError = false; api.playbackRange = null;
  if (api.score) { byId('from-bar').value = '1'; byId('to-bar').value = String(api.score.masterBars.length); }
  updateReady(); message('Выбрана вся песня.'); });
for (const [id, key] of [['show-staff','staff'],['show-tab','tab']]) byId(id).addEventListener('change', event => { state.notation[key] = event.target.checked; renderNotation(); });
byId('follow').addEventListener('change', event => { api.settings.player.scrollMode = event.target.checked ? alphaTab.ScrollMode.Continuous : alphaTab.ScrollMode.Off; api.updateSettings(); });
function mixerOpen(open) { document.body.classList.toggle('mixer-collapsed', !open); byId('toggle-mixer').setAttribute('aria-expanded', String(open)); if (api.score) requestAnimationFrame(() => api.render()); }
byId('toggle-mixer').addEventListener('click', () => mixerOpen(document.body.classList.contains('mixer-collapsed')));
byId('close-mixer').addEventListener('click', () => { mixerOpen(false); byId('toggle-mixer').focus(); });
function setLayout(layout) { document.body.dataset.layout = layout; for (const button of document.querySelectorAll('button[data-layout]')) button.setAttribute('aria-pressed', String(button.dataset.layout === layout)); mixerOpen(layout === 'studio' && innerWidth > 1120); }
for (const button of document.querySelectorAll('button[data-layout]')) button.addEventListener('click', () => setLayout(button.dataset.layout));
function setTheme(theme) {
  document.body.dataset.theme = theme; document.documentElement.style.colorScheme = theme;
  for (const button of document.querySelectorAll('button[data-theme]')) button.setAttribute('aria-pressed', String(button.dataset.theme === theme));
  const color = hex => new alphaTab.model.Color(...hex.match(/\w\w/g).map(v => parseInt(v, 16)));
  const resources = api.settings.display.resources;
  resources.mainGlyphColor = color(theme === 'dark' ? 'edf4e8' : '27372e');
  resources.scoreInfoColor = resources.mainGlyphColor;
  resources.secondaryGlyphColor = color(theme === 'dark' ? 'b0beb0' : '637168');
  resources.staffLineColor = color(theme === 'dark' ? '86998b' : '7b897e');
  resources.barSeparatorColor = resources.staffLineColor; resources.barNumberColor = color(theme === 'dark' ? 'bdd5ab' : '345d42');
  api.updateSettings(); if (api.score) api.render();
}
for (const button of document.querySelectorAll('button[data-theme]')) button.addEventListener('click', () => setTheme(button.dataset.theme));
for (const sample of await (await fetch('/samples.json')).json()) {
  const option = document.createElement('option'); option.value = sample.id; option.textContent = sample.relativePath.split('/').at(-1); option.title = sample.relativePath; byId('sample').append(option);
}
// Только отдельный эксперимент. Не импортируется и не поставляется продуктом.
window.bankProbe = { api, state, alphaTab, openBytes };
const query = new URLSearchParams(location.search);
setTheme(query.get('theme') === 'dark' ? 'dark' : 'light'); setLayout(query.get('layout') === 'reading' ? 'reading' : 'studio');
message('Выбери файл. Звук начнётся только по кнопке «Старт».');
if ([...byId('sample').options].some(option => option.value === query.get('sample'))) { byId('sample').value = query.get('sample'); byId('sample').dispatchEvent(new Event('change')); }
