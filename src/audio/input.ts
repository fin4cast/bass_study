import { estimatePitch, type PitchEstimate } from '../input/pitch';
import { audioContext, resumeAudio } from './context';

export class InputMonitorError extends Error { constructor(public readonly code: string, message: string) { super(message); this.name = 'InputMonitorError'; } }
export interface InputDevice { readonly id: string; readonly label: string; readonly groupId: string }
export interface InputMonitorSnapshot {
  readonly state: 'stopped' | 'starting' | 'running' | 'error' | 'disposed';
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly requested: MediaTrackConstraints | null; readonly settings: MediaTrackSettings | null;
  readonly supportedConstraints: MediaTrackSupportedConstraints | null; readonly device: { readonly id: string; readonly label: string } | null;
  readonly context: { readonly sampleRate: number; readonly state: AudioContextState; readonly outputBaseLatencySeconds: number; readonly latencyHint: 'interactive' } | null;
  readonly level: { readonly rms: number; readonly peak: number; readonly clipping: boolean; readonly clippedSamples: number; readonly clipThreshold: 0.999 };
  readonly pitch: PitchEstimate | null; readonly trackCount: number;
}

function immutable<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(immutable); Object.freeze(value); } return value; }
function mapError(error: unknown): InputMonitorError {
  if (error instanceof InputMonitorError) return error;
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return new InputMonitorError('PERMISSION_DENIED', 'Браузер не разрешил аудиовход. Разреши доступ для этого localhost и снова нажми «Подключить».');
  if (name === 'NotFoundError') return new InputMonitorError('DEVICE_NOT_FOUND', 'Аудиовход не найден. Подключи аудиоинтерфейс или USB-устройство и выбери его явно.');
  if (name === 'OverconstrainedError') return new InputMonitorError('DEVICE_CONSTRAINT', 'Выбранное устройство или запрошенные параметры недоступны. Обнови список и выбери аудиовход заново.');
  if (name === 'NotReadableError') return new InputMonitorError('DEVICE_BUSY', 'Не удалось открыть аудиовход. Проверь подключение, драйвер и использование устройства другими программами.');
  if (name === 'AbortError') return new InputMonitorError('START_ABORTED', 'Подключение аудиовхода было прервано. Автоматический повтор не выполняется.');
  return new InputMonitorError('INPUT_FAILURE', `Не удалось подключить аудиовход${name ? ` (${name})` : ''}. Повторное подключение выполняется только по кнопке.`);
}

/**
 * USB/interface input diagnostics only. Import/construction/enumeration never
 * requests microphone access. The sole getUserMedia call is inside start().
 * Capture is never connected audibly: both analysis branches end at gain0.
 * Requested flags are reported separately from actual getSettings().
 * Output baseLatency / the analysis window are not end-to-end input latency.
 * https://www.w3.org/TR/mediacapture-streams/
 * https://www.w3.org/TR/webaudio/
 */
export function createInputMonitor() {
  let state: InputMonitorSnapshot['state'] = 'stopped';
  let error: InputMonitorSnapshot['error'] = null;
  let requested: MediaTrackConstraints | null = null;
  let settings: MediaTrackSettings | null = null;
  let supportedConstraints: MediaTrackSupportedConstraints | null = null;
  let device: InputMonitorSnapshot['device'] = null;
  let context: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let rawAnalyser: AnalyserNode | null = null;
  let pitchAnalyser: AnalyserNode | null = null;
  let filter: BiquadFilterNode | null = null;
  let silent: GainNode | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let token = 0;
  let disposed = false;
  let removeDeviceListener: (() => void) | null = null;
  let removeStateListener: (() => void) | null = null;
  const raw = new Float32Array(8192);
  const filtered = new Float32Array(8192);
  const emptyLevel = () => ({ rms: 0, peak: 0, clipping: false, clippedSamples: 0, clipThreshold: 0.999 as const });
  let level = emptyLevel();
  let pitch: PitchEstimate | null = null;

  function mediaDevices() {
    if (!globalThis.navigator?.mediaDevices?.getUserMedia) throw new InputMonitorError('UNSUPPORTED', 'Аудиовход недоступен в этом браузере или контексте. Открой приложение через localhost в актуальном Edge.');
    return navigator.mediaDevices;
  }
  function ensureActive() { if (disposed) throw new InputMonitorError('DISPOSED', 'Диагностика аудиовхода уже закрыта.'); }
  function stopTracks(value: MediaStream) { value.getTracks().forEach(track => track.stop()); }
  function release() {
    if (timer) clearInterval(timer); timer = null;
    removeDeviceListener?.(); removeDeviceListener = null;
    stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); stream = null;
    source?.disconnect(); rawAnalyser?.disconnect(); pitchAnalyser?.disconnect(); filter?.disconnect(); silent?.disconnect();
    source = null; rawAnalyser = null; pitchAnalyser = null; filter = null; silent = null;
    // Общий AudioContext не закрывается: снимается только собственный граф и подписка.
    removeStateListener?.(); removeStateListener = null; context = null;
    level = emptyLevel(); pitch = null;
  }
  function fail(value: unknown) {
    token++; const failure = mapError(value); release();
    error = { code: failure.code, message: failure.message }; state = 'error'; return failure;
  }
  function snapshot(): InputMonitorSnapshot {
    return immutable({ state, error, requested, settings, supportedConstraints, device,
      context: context ? { sampleRate: context.sampleRate, state: context.state, outputBaseLatencySeconds: context.baseLatency, latencyHint: 'interactive' } : null,
      level, pitch, trackCount: stream?.getTracks().filter(track => track.readyState === 'live').length ?? 0 });
  }
  function analyze(run: number) {
    if (run !== token || state !== 'running' || !context || !rawAnalyser || !pitchAnalyser) return;
    try {
      rawAnalyser.getFloatTimeDomainData(raw); pitchAnalyser.getFloatTimeDomainData(filtered);
      let energy = 0; let peak = 0; let clippedSamples = 0;
      for (const value of raw) { energy += value * value; peak = Math.max(peak, Math.abs(value)); if (Math.abs(value) >= 0.999) clippedSamples++; }
      level = { rms: Math.sqrt(energy / raw.length), peak, clipping: clippedSamples > 0, clippedSamples, clipThreshold: 0.999 };
      pitch = estimatePitch(filtered, context.sampleRate);
    } catch (failure) { fail(failure); }
  }

  return {
    async listDevices(): Promise<readonly InputDevice[]> {
      ensureActive();
      try {
        return immutable((await mediaDevices().enumerateDevices()).filter(item => item.kind === 'audioinput').map(item => ({ id: item.deviceId, label: item.label, groupId: item.groupId })));
      } catch (failure) { throw mapError(failure); }
    },
    async start(options: { deviceId?: string } = {}): Promise<InputMonitorSnapshot> {
      ensureActive();
      if (options.deviceId !== undefined && (typeof options.deviceId !== 'string' || !options.deviceId.trim())) throw new InputMonitorError('INVALID_DEVICE', 'Выбери непустой ID аудиовхода либо используй устройство по умолчанию.');
      token++; release(); const run = token;
      state = 'starting'; error = null; settings = null; device = null;
      requested = immutable({ ...(options.deviceId === undefined ? {} : { deviceId: { exact: options.deviceId } }),
        channelCount: { ideal: 1 }, echoCancellation: false, autoGainControl: false, noiseSuppression: false });
      try {
        const media = mediaDevices(); supportedConstraints = immutable({ ...media.getSupportedConstraints() });
        const localContext = audioContext(); context = localContext;
        // Begin unlocking in this explicit user action; capture permission may
        // resolve later. A rejection is handled without an unhandled promise.
        const resumed = resumeAudio(localContext).then(() => null, failure => failure);
        const acquired = await media.getUserMedia({ audio: requested, video: false });
        if (disposed || run !== token) { stopTracks(acquired); return snapshot(); }
        stream = acquired;
        const resumeFailure = await resumed;
        if (disposed || run !== token) { stopTracks(acquired); return snapshot(); }
        if (resumeFailure) throw resumeFailure;
        const audioTrack = acquired.getAudioTracks()[0];
        if (!audioTrack || audioTrack.readyState !== 'live') throw new InputMonitorError('DEVICE_ENDED', 'Аудиовход завершился до начала анализа. Подключи устройство повторно по кнопке.');
        settings = immutable({ ...audioTrack.getSettings() }); device = immutable({ id: settings.deviceId ?? '', label: audioTrack.label });
        source = localContext.createMediaStreamSource(acquired);
        rawAnalyser = localContext.createAnalyser(); rawAnalyser.fftSize = 8192;
        filter = localContext.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1000; filter.Q.value = Math.SQRT1_2;
        pitchAnalyser = localContext.createAnalyser(); pitchAnalyser.fftSize = 8192;
        silent = localContext.createGain(); silent.gain.value = 0;
        source.connect(rawAnalyser); rawAnalyser.connect(silent);
        source.connect(filter); filter.connect(pitchAnalyser); pitchAnalyser.connect(silent); silent.connect(localContext.destination);
        audioTrack.onended = () => { if (run === token && !disposed) fail(new InputMonitorError('DEVICE_ENDED', 'Аудиовход отключён или завершён. Автоматического переподключения нет; выбери устройство и нажми «Подключить».')); };
        const changed = async () => {
          if (run !== token || disposed) return;
          try {
            const devices = await media.enumerateDevices();
            if (run === token && settings?.deviceId && !devices.some(item => item.kind === 'audioinput' && item.deviceId === settings!.deviceId)) fail(new InputMonitorError('DEVICE_DISCONNECTED', 'Выбранный аудиовход исчез из списка устройств. Подключение остановлено; автоматического повтора нет.'));
          } catch (failure) { if (run === token) fail(failure); }
        };
        media.addEventListener('devicechange', changed); removeDeviceListener = () => media.removeEventListener('devicechange', changed);
        const stateChanged = () => { if (run === token && state === 'running' && localContext.state !== 'running') fail(new InputMonitorError('CONTEXT_INTERRUPTED', 'Браузер остановил обработку аудиовхода. Подключись снова по кнопке; автоматического повтора нет.')); };
        localContext.addEventListener('statechange', stateChanged); removeStateListener = () => localContext.removeEventListener('statechange', stateChanged);
        state = 'running'; analyze(run);
        if (run === token && state === 'running') timer = setInterval(() => analyze(run), 100);
        return snapshot();
      } catch (failure) {
        if (disposed || run !== token) return snapshot();
        throw fail(failure);
      }
    },
    stop() { if (disposed) return; token++; release(); error = null; state = 'stopped'; },
    getSnapshot: snapshot,
    dispose() { if (disposed) return; disposed = true; token++; release(); state = 'disposed'; error = null; },
  };
}
