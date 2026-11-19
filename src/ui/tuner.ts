/**
 * Окно тюнера поверх «Занятия» (R-020, D-052). Подключение — только кнопкой; закрытие окна, скрытие вкладки и ошибка
 * устройства освобождают вход. Показ — диагностическая высота относительно открытых струн, а не оценка игры.
 */
import './tuner.css';
import { createInputMonitor, type InputDevice } from '../audio/input';
import { createTunerState, TUNER_STRINGS, tunerHint, tunerStep, type TunerState } from '../input/tuner';
import { escapeHtml } from './html';
import { onPageVisibility } from './page-visibility';

export interface TunerOptions {
  /** Сохранённый аудиовход из «Настроек»; выбор в окне действует, пока окно открыто. */
  readonly deviceId: string;
  /** Право на звук (владелец `input`); `false` — подключение не начинается. */
  readonly onBeforeStart: () => boolean;
  /** Окно закрыто и вход освобождён. */
  readonly onClosed: () => void;
}
export interface TunerHandle {
  /** Остановить вход (окно остаётся открытым); повтор — только кнопкой. */
  stop(reason?: string): void;
  close(): void;
  readonly isOpen: boolean;
}

const fixed = (value: number, digits = 1) => value.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function openTuner(options: TunerOptions): TunerHandle {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const monitor = createInputMonitor();
  const controller = new AbortController();
  let open = true;
  let deviceId = options.deviceId;
  let devices: readonly InputDevice[] = [];
  let tuner: TunerState = createTunerState();
  let failure = '';
  let notice = '';
  let lastHint = '';
  let request = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const dialog = document.createElement('dialog');
  dialog.className = 'tuner-dialog';
  dialog.setAttribute('aria-labelledby', 'tuner-title');
  dialog.innerHTML = `<div class="tuner-head"><h2 id="tuner-title">Настроить бас</h2><button type="button" class="secondary-button button-compact" data-tuner="close" aria-label="Закрыть тюнер">✕</button></div>
    <p class="tuner-intro">Сыграй открытую струну и дай ей звучать. Стрелка показывает, ниже или выше нужной ноты. Начни с E и иди к G.</p>
    <div class="tuner-connect"><select class="form-control" data-tuner="device" aria-label="Аудиовход"></select>
      <button type="button" class="primary-button" data-tuner="connect">Подключить</button><button type="button" class="secondary-button" data-tuner="stop" disabled>Отключить</button></div>
    <p class="status-error" role="alert" data-tuner="error" hidden></p>
    <div class="tuner-face" data-verdict="none">
      <output class="tuner-note" data-tuner="note">—</output>
      <div class="tuner-scale" aria-hidden="true"><span class="tuner-zone"></span><span class="tuner-needle" data-tuner="needle"></span></div>
      <div class="tuner-ticks" aria-hidden="true"><span>−50</span><span>0</span><span>+50 ¢</span></div>
      <p class="tuner-cents" data-tuner="cents">—</p>
      <p class="tuner-hint" role="status" data-tuner="hint">Подключи вход и сыграй открытую струну.</p>
    </div>
    <ol class="tuner-strings" aria-label="Струны">${TUNER_STRINGS.map(item => `<li data-string="${item.string}"><b>${item.string}</b><small>${item.name}</small></li>`).join('')}</ol>
    <p class="tuner-foot">Тюнер не проверен на настоящем басе: точность не заявляется. Вход не выводится на динамики.</p>`;
  document.body.append(dialog);

  const query = <T extends HTMLElement = HTMLElement>(name: string) => dialog.querySelector<T>(`[data-tuner="${name}"]`)!;
  const picker = query<HTMLSelectElement>('device');
  const text = (name: string, value: string) => { const element = query(name); if (element.textContent !== value) element.textContent = value; };

  function renderDevices() {
    const missing = deviceId && !devices.some(device => device.id === deviceId);
    picker.innerHTML = `<option value="">Устройство по умолчанию</option>${missing ? `<option value="${escapeHtml(deviceId)}">Сохранённый аудиовход · сейчас не найден</option>` : ''}${devices.filter(device => device.id).map((device, index) => `<option value="${escapeHtml(device.id)}">${escapeHtml(device.label || `Аудиовход ${index + 1} · название скрыто`)}</option>`).join('')}`;
    picker.value = deviceId;
  }
  async function refreshDevices() {
    try { devices = await monitor.listDevices(); } catch { devices = []; }
    if (open) renderDevices();
  }
  function render() {
    if (!open) return;
    const snapshot = monitor.getSnapshot();
    const running = snapshot.state === 'running', pending = snapshot.state === 'starting';
    dialog.dataset.tunerState = snapshot.state;
    query<HTMLButtonElement>('connect').disabled = running || pending;
    query<HTMLButtonElement>('stop').disabled = !running && !pending;
    const error = snapshot.error?.message || failure;
    const errorBox = query('error');
    errorBox.hidden = !error; if (errorBox.textContent !== error) errorBox.textContent = error;
    const reading = running ? tuner.reading : null;
    const face = dialog.querySelector<HTMLElement>('.tuner-face')!;
    face.dataset.verdict = reading?.verdict ?? 'none';
    text('note', reading ? reading.target : '—');
    text('cents', reading ? `${reading.cents >= 0 ? '+' : '−'}${fixed(Math.abs(reading.cents))} центов · ${fixed(reading.hz, 2)} Гц` : '—');
    query('needle').style.left = `${50 + Math.max(-50, Math.min(50, reading?.cents ?? 0))}%`;
    const hint = running ? tunerHint(reading) : pending ? 'Ожидаем разрешение браузера и подключаем вход…' : notice || 'Подключи вход и сыграй открытую струну.';
    // Живая область меняется только со сменой подсказки, а не каждые 100 мс.
    if (hint !== lastHint) { text('hint', hint); lastHint = hint; }
    dialog.querySelectorAll<HTMLElement>('.tuner-strings li').forEach(item => {
      item.toggleAttribute('data-tuned', tuner.tuned.includes(item.dataset.string as never));
      item.toggleAttribute('data-current', reading?.string === item.dataset.string);
    });
  }
  function tick() {
    const snapshot = monitor.getSnapshot();
    if (snapshot.state === 'running') tuner = tunerStep(tuner, snapshot.pitch, performance.now());
    else if (timer) { clearInterval(timer); timer = null; }
    render();
  }
  function stop(reason = 'Вход отключён. Для нового подключения нажми «Подключить».') {
    if (!open) return;
    request++; monitor.stop();
    if (timer) clearInterval(timer); timer = null;
    tuner = createTunerState(); notice = reason; failure = '';
    render();
  }
  async function connect() {
    const current = ++request;
    failure = ''; notice = '';
    if (!options.onBeforeStart()) { failure = 'Звук сейчас занят другим разделом или вкладка не может записывать.'; render(); return; }
    try {
      const pending = monitor.start(deviceId ? { deviceId } : {});
      render();
      await pending;
      if (!open || current !== request) return;
      tuner = createTunerState();
      if (timer) clearInterval(timer);
      timer = setInterval(tick, 100);
      void refreshDevices();
    } catch (error) {
      if (!open || current !== request) return;
      failure = error instanceof Error ? error.message : 'Не удалось подключить аудиовход.';
    }
    render();
  }
  function close() {
    if (!open) return;
    open = false; request++;
    if (timer) clearInterval(timer); timer = null;
    controller.abort();
    monitor.dispose();
    if (dialog.open) dialog.close();
    dialog.remove();
    options.onClosed();
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  }

  dialog.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-tuner]');
    if (!button || button.disabled) return;
    if (button.dataset.tuner === 'close') close();
    if (button.dataset.tuner === 'connect') void connect();
    if (button.dataset.tuner === 'stop') stop();
  }, { signal: controller.signal });
  picker.addEventListener('change', () => { deviceId = picker.value; stop('Выбор входа изменён. Снова нажми «Подключить».'); }, { signal: controller.signal });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }, { signal: controller.signal });
  onPageVisibility(controller.signal, () => {
    if (['running', 'starting'].includes(monitor.getSnapshot().state)) stop('При скрытии вкладки вход отключён. Для нового подключения нажми «Подключить».');
  });

  renderDevices(); render();
  dialog.showModal();
  query('connect').focus();
  void refreshDevices();
  return { stop, close, get isOpen() { return open; } };
}
