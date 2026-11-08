import './input.css';
import { createInputMonitor, type InputDevice, type InputMonitorSnapshot } from '../audio/input';
import { PITCH_DIAGNOSTIC } from '../input/pitch';
import { formatMidi } from '../music';

export interface InputPreferences { readonly deviceId: string }
export interface InputOptions {
  readonly onBeforeStart?: () => void;
  readonly onPrefsChange?: () => void;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, mark => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[mark]!);
const fixed = (value: number, digits = 1) => value.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const db = (value: number) => value <= 0.000001 ? '−∞ dBFS' : `${fixed(20 * Math.log10(value))} dBFS`;
function parameter(value: unknown): string {
  if (value === undefined || value === null) return 'Не сообщено';
  if (typeof value === 'boolean') return value ? 'Включено' : 'Выключено';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Explicit, silent input diagnostics. Preferences never request permission or start capture. */
export function mountInput(container: HTMLElement, options: InputOptions = {}) {
  const monitor = createInputMonitor();
  const controller = new AbortController();
  let preferences: InputPreferences = { deviceId: '' };
  let devices: readonly InputDevice[] = [];
  let visible = !container.hidden;
  let disposed = false;
  let request = 0, enumeration = 0;
  let listing = false;
  let notice = '', actionError = '', lastStatus = '', detailsKey = '';
  let frame = 0, lastFrame = 0;
  container.classList.add('input-section');
  container.innerHTML = `<div class="input-heading"><div><p class="eyebrow">АУДИОВХОД · ДИАГНОСТИКА</p><h2>Подключи бас. Посмотри сигнал.</h2></div><p>Аудиоинтерфейс или USB.<br>Подключение только по твоей кнопке.</p></div>
    <p class="input-intro">Выбери вход инструмента и сыграй одну протяжную ноту. Здесь можно посмотреть уровень и приблизительную звучащую высоту. Это исследовательская диагностика: она не оценивает игру и не определяет струну или лад.</p>
    <div class="input-connect"><label class="input-device-field"><span>Аудиовход</span><select aria-label="Аудиовход" data-input-setting="deviceId"></select></label><button class="text-button" type="button" data-input-action="refresh">Обновить устройства</button><button class="primary-button" type="button" data-input-action="connect">Подключить</button><button class="text-button" type="button" data-input-action="stop" disabled>Отключить</button></div>
    <p class="input-device-help" data-testid="input-device-help"></p><p class="input-error" role="alert" data-testid="input-error" hidden></p><p class="input-notice" role="status" data-testid="input-notice" hidden></p>
    <p class="input-status" role="status" data-testid="input-status">Вход не подключён. Доступ к аудио запрашивается после «Подключить».</p>
    <div class="input-readouts"><section class="input-level-card" aria-labelledby="input-level-heading"><h3 id="input-level-heading">Уровень входа</h3><label class="input-meter-label"><span>Пиковый уровень</span><meter min="0" max="1" low="0.015" high="0.9" optimum="0.25" value="0" aria-label="Пиковый уровень аудиовхода" data-testid="input-level-meter">0</meter></label><div class="input-level-values"><span>RMS <output data-testid="input-rms">−∞ dBFS</output></span><span>Пик <output data-testid="input-peak">−∞ dBFS</output></span></div><p class="input-clipping" data-testid="input-clipping">Перегрузка не обнаружена</p><p class="input-card-help">Если появляется перегрузка, уменьши усиление на аудиоинтерфейсе. Изменение уровня здесь не управляет усилением устройства.</p></section>
    <section class="input-pitch-card" aria-labelledby="input-pitch-heading"><h3 id="input-pitch-heading">Звучащая высота</h3><div class="input-pitch-main"><output data-testid="input-note">—</output><span><output data-testid="input-hz">—</output> Гц</span></div><p class="input-cents" data-testid="input-cents">Нет устойчивой высоты</p><p class="input-confidence">Эвристика периодичности: <output data-testid="input-confidence">—</output></p><p class="input-uncertainty" data-testid="input-uncertainty">Подключи вход, чтобы начать диагностику.</p><p class="input-card-help">Показатель не является вероятностью правильного распознавания. Атака, шум и сильные обертоны могут сделать высоту неопределённой или дать ошибку октавы.</p></section></div>
    <p class="input-silent-help">Вход не выводится на динамики. Для прослушивания используй прямой мониторинг своего аудиоинтерфейса. При уходе из раздела или скрытии вкладки подключение останавливается; вернуться можно по кнопке.</p>
    <details class="input-diagnostics"><summary>Запрошенные и фактические параметры</summary><p class="input-diagnostics-help">Браузер может применить другие параметры. Столбец «Фактически» показывает ответ аудиодорожки, а не обещание устройства. После отключения здесь остаются последние полученные параметры дорожки.</p><div class="input-settings-scroll"><table><caption>Параметры аудиодорожки</caption><thead><tr><th scope="col">Параметр</th><th scope="col">Запрошено</th><th scope="col">Фактически</th></tr></thead><tbody data-testid="input-settings"></tbody></table></div><dl class="input-context" data-testid="input-context"></dl><p class="input-window-help" data-testid="input-window"></p><p class="input-diagnostics-help">Длительность окна анализа и выходной baseLatency AudioContext не измеряют сквозную задержку аудиовхода. Качество реального баса, USB и конкретного интерфейса требует отдельной проверки.</p></details>`;

  const query = <T extends HTMLElement = HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
  const output = (name: string, text: string) => { const element = query(`[data-testid="input-${name}"]`); if (element.textContent !== text) element.textContent = text; };
  const picker = query<HTMLSelectElement>('[data-input-setting="deviceId"]');
  function getPreferences(): InputPreferences { return { ...preferences }; }
  function messages() {
    const failure = monitor.getSnapshot().error?.message || actionError;
    const errorElement = query('[data-testid="input-error"]');
    errorElement.textContent = failure; errorElement.hidden = !failure;
    const noticeElement = query('[data-testid="input-notice"]');
    noticeElement.textContent = notice; noticeElement.hidden = !notice;
  }
  function renderDevices() {
    const selected = preferences.deviceId;
    const missing = selected && !devices.some(device => device.id === selected);
    picker.innerHTML = `<option value="">Устройство по умолчанию</option>${missing ? `<option value="${escapeHtml(selected)}">Сохранённый аудиовход · сейчас не найден</option>` : ''}${devices.filter(device => device.id).map((device, index) => `<option value="${escapeHtml(device.id)}">${escapeHtml(device.label || `Аудиовход ${index + 1} · название скрыто`)}</option>`).join('')}`;
    picker.value = selected;
    output('device-help', listing ? 'Обновляем список без запроса доступа к аудио…' : devices.some(device => !device.label) ? 'До разрешения доступа браузер может скрывать названия входов. Список сам по себе не включает запись; названия обновятся после подключения.' : devices.length ? 'Выбери инструментальный вход своего интерфейса. Смена выбора отключает текущий вход; затем снова нажми «Подключить».' : 'Видимых аудиовходов пока нет. Браузер может скрывать список до разрешения доступа. Проверь USB/интерфейс и обнови список либо подключи вход по умолчанию.');
    query<HTMLButtonElement>('[data-input-action="refresh"]').disabled = listing;
  }
  async function refreshDevices() {
    const current = ++enumeration;
    listing = true; renderDevices();
    try {
      const values = await monitor.listDevices();
      if (disposed || current !== enumeration) return;
      devices = values;
    } catch (failure) {
      if (disposed || current !== enumeration) return;
      actionError = failure instanceof Error ? failure.message : 'Не удалось получить список аудиовходов.';
    } finally {
      if (!disposed && current === enumeration) { listing = false; renderDevices(); messages(); }
    }
  }
  function renderDetails(snapshot: InputMonitorSnapshot) {
    const key = JSON.stringify([snapshot.requested, snapshot.settings, snapshot.context, snapshot.device]);
    if (key === detailsKey) return;
    detailsKey = key;
    const requested = snapshot.requested, actual = snapshot.settings;
    const rows: readonly [string, keyof MediaTrackConstraints, keyof MediaTrackSettings][] = [
      ['Каналы', 'channelCount', 'channelCount'], ['Частота дискретизации, Гц', 'sampleRate', 'sampleRate'],
      ['Размер отсчёта, бит', 'sampleSize', 'sampleSize'], ['Эхоподавление', 'echoCancellation', 'echoCancellation'],
      ['Автоусиление', 'autoGainControl', 'autoGainControl'], ['Шумоподавление', 'noiseSuppression', 'noiseSuppression'],
    ];
    query('[data-testid="input-settings"]').innerHTML = rows.map(([name, requestedKey, actualKey]) => `<tr><th scope="row">${name}</th><td>${requested ? escapeHtml(parameter(requested[requestedKey])) : 'Ещё не запрашивалось'}</td><td>${actual ? escapeHtml(parameter(actual[actualKey])) : 'Нет подключения'}</td></tr>`).join('');
    const context = snapshot.context;
    query('[data-testid="input-context"]').innerHTML = `<div><dt>Выбранный вход</dt><dd>${escapeHtml(snapshot.device?.label || (snapshot.device ? 'Название не сообщено' : 'Нет подключения'))}</dd></div><div><dt>Частота AudioContext</dt><dd>${context ? `${context.sampleRate.toLocaleString('ru-RU')} Гц` : 'Нет активного контекста'}</dd></div><div><dt>Выходной baseLatency AudioContext</dt><dd>${context ? `${fixed(context.outputBaseLatencySeconds * 1000, 2)} мс` : 'Нет активного контекста'}</dd></div>`;
    output('window', `Окно анализа: ${PITCH_DIAGNOSTIC.frameSize} отсчёта${context ? ` / ${context.sampleRate.toLocaleString('ru-RU')} Гц = ${fixed(PITCH_DIAGNOSTIC.frameSize / context.sampleRate * 1000, 2)} мс` : '; длительность станет известна после подключения'}. Диагностический диапазон: ${PITCH_DIAGNOSTIC.minHz}–${PITCH_DIAGNOSTIC.maxHz} Гц.`);
  }
  function refresh() {
    if (disposed) return;
    const snapshot = monitor.getSnapshot();
    const active = snapshot.state === 'running', pending = snapshot.state === 'starting';
    container.dataset.inputState = snapshot.state;
    query<HTMLButtonElement>('[data-input-action="connect"]').disabled = pending || active || !visible;
    query<HTMLButtonElement>('[data-input-action="stop"]').disabled = !active && !pending;
    query<HTMLButtonElement>('[data-input-action="stop"]').textContent = pending ? 'Отменить подключение' : 'Отключить';
    const status = pending ? 'Ожидаем разрешение браузера и подключаем выбранный аудиовход…' : active ? 'Вход подключён. Анализ идёт без вывода на динамики.' : snapshot.state === 'error' ? 'Подключение остановлено из-за ошибки. Повтор — только по кнопке «Подключить».' : 'Вход не подключён. Доступ к аудио запрашивается после «Подключить».';
    if (status !== lastStatus) { output('status', status); lastStatus = status; }
    const meter = query<HTMLMeterElement>('[data-testid="input-level-meter"]');
    meter.value = Math.min(1, snapshot.level.peak);
    meter.textContent = `${fixed(snapshot.level.peak * 100, 0)}%`;
    output('rms', db(snapshot.level.rms)); output('peak', db(snapshot.level.peak));
    const clipping = query('[data-testid="input-clipping"]');
    clipping.classList.toggle('is-clipping', snapshot.level.clipping);
    output('clipping', !active ? 'Подключи вход для проверки уровня' : snapshot.level.clipping ? `Перегрузка: ${snapshot.level.clippedSamples} отсчётов у предела. Уменьши усиление входа.` : 'Перегрузка не обнаружена в текущем окне');
    const pitch = snapshot.pitch;
    const reason = !active ? 'Подключи вход, чтобы начать диагностику.' : !pitch ? 'Ожидаем полный кадр сигнала. Сыграй одну протяжную ноту.' : pitch.voiced ? 'Приблизительная высота одного сигнала. Сверяй слухом: возможна ошибка октавы.' : ({ silence: 'Сигнал слишком тихий для устойчивой высоты.', noise: 'Нет устойчивой периодичности: возможен шум или несколько нот.', uncertain: 'Высота неоднозначна: дождись окончания атаки и оставь одну ноту.', 'out-of-range': 'Высота вне диагностического диапазона 35–350 Гц.' }[pitch.reason]);
    output('note', pitch?.voiced ? formatMidi(pitch.nearestMidi) : '—');
    output('hz', pitch?.voiced ? fixed(pitch.hz) : '—');
    output('cents', pitch?.voiced ? `${pitch.cents >= 0 ? '+' : '−'}${fixed(Math.abs(pitch.cents))} цента от ${formatMidi(pitch.nearestMidi)}` : 'Нет устойчивой высоты');
    output('confidence', pitch ? `${fixed(pitch.confidence, 2)} / 1` : '—');
    output('uncertainty', reason);
    renderDetails(snapshot); messages();
  }
  function stop(reason = 'Отключено. Для нового подключения нажми «Подключить».') {
    if (disposed) return;
    request++; monitor.stop(); notice = reason; actionError = ''; refresh();
  }
  async function connect() {
    if (disposed || !visible) return;
    const current = ++request;
    actionError = ''; notice = '';
    try {
      options.onBeforeStart?.();
      if (disposed || !visible || current !== request) return;
      const pending = monitor.start(preferences.deviceId ? { deviceId: preferences.deviceId } : {});
      refresh();
      await pending;
      if (disposed || !visible || current !== request) return;
      refresh(); void refreshDevices();
    } catch (failure) {
      if (disposed || current !== request) return;
      actionError = failure instanceof Error ? failure.message : 'Не удалось подключить аудиовход.';
      refresh();
    }
  }
  function applyPreferences(value: InputPreferences) {
    if (!value || typeof value.deviceId !== 'string' || value.deviceId.length > 2048) throw new TypeError('Некорректная настройка аудиовхода.');
    stop('Выбор аудиовхода восстановлен. Доступ к аудио не запрашивался; нажми «Подключить», когда будешь готов.');
    preferences = { deviceId: value.deviceId }; renderDevices();
  }
  container.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-input-action]');
    if (!button || button.disabled) return;
    if (button.dataset.inputAction === 'connect') void connect();
    if (button.dataset.inputAction === 'stop') stop();
    if (button.dataset.inputAction === 'refresh') { actionError = ''; void refreshDevices(); }
  }, { signal: controller.signal });
  picker.addEventListener('change', () => {
    stop('Выбор входа изменён. Подключение остановлено; снова нажми «Подключить».');
    preferences = { deviceId: picker.value }; options.onPrefsChange?.();
  }, { signal: controller.signal });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && ['running', 'starting'].includes(monitor.getSnapshot().state)) stop('Вкладка скрыта — аудиовход отключён. Вернувшись, подключись снова по кнопке.');
  }, { signal: controller.signal });
  function tick(time: number) { if (disposed) return; if (visible && time - lastFrame >= 100) { lastFrame = time; refresh(); } frame = requestAnimationFrame(tick); }
  renderDevices(); refresh(); void refreshDevices(); frame = requestAnimationFrame(tick);
  return {
    getPreferences, applyPreferences, getSnapshot: monitor.getSnapshot,
    setVisible(value: boolean) { if (disposed) return; visible = value; container.hidden = !value; if (!value) stop('Раздел закрыт — аудиовход отключён. При возвращении нажми «Подключить».'); else refresh(); },
    stop,
    async dispose() { if (disposed) return; request++; enumeration++; disposed = true; controller.abort(); cancelAnimationFrame(frame); await monitor.dispose(); },
  };
}
