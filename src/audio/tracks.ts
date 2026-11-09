import {
  TRACK_LIMITS, TracksError, assertFileMatches, createTracksManifest, planTrackSegments, setTrackMix as updateMix,
  setTracksPlayback, trackPositionAt, validateTracksManifest, type TrackDescriptor, type TracksManifest,
} from '../tracks';

/** Local-file playback. No persistence of PCM, source file bytes or object URLs. */
export function createTracksPlayer() {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let analyser: AnalyserNode | null = null;
  const waveform = new Float32Array(1024);
  let manifest: TracksManifest | null = null;
  let buffers = new Map<string, AudioBuffer>();
  const gains = new Map<string, GainNode>();
  const sources = new Set<AudioBufferSourceNode>();
  let state: 'stopped' | 'starting' | 'playing' | 'paused' | 'finished' = 'stopped';
  let position = 0; let startPosition = 0; let anchorTime = 0; let nextCycle = 0; let nextCycleAt = 0;
  let interval: ReturnType<typeof setInterval> | null = null;
  let epoch = 0; let loadToken = 0; let loading = false; let disposed = false; let pauseReason: string | null = null;

  function ensureActive() { if (disposed) throw new TracksError('DISPOSED', 'Проигрыватель дорожек уже закрыт.'); }
  function audioContext() {
    ensureActive();
    if (!context) {
      context = new AudioContext({ sampleRate: 48000 });
      master = context.createGain(); master.gain.value = 0.8; master.connect(context.destination);
      analyser = context.createAnalyser(); analyser.fftSize = waveform.length; master.connect(analyser);
    }
    return context;
  }
  function requireManifest(): TracksManifest { ensureActive(); if (!manifest) throw new TracksError('NO_TRACKS', 'Сначала выбери локальные дорожки или восстанови их манифест.'); return manifest; }
  function requirePaused() { if (state === 'playing' || state === 'starting') throw new TracksError('PAUSE_REQUIRED', 'Поставь дорожки на паузу перед изменением фрагмента, цикла или скорости.'); }
  function clearSources() {
    if (interval) clearInterval(interval); interval = null;
    for (const source of sources) { try { source.stop(); } catch { /* already ended */ } source.disconnect(); }
    sources.clear();
  }
  function actualPosition(atTime = context?.currentTime ?? 0) {
    if (!manifest || !context || state !== 'playing') return { position, cycleIndex: 0, finished: state === 'finished' };
    return trackPositionAt(manifest, Math.max(0, atTime - anchorTime), startPosition);
  }
  function stopInternal(reset = true) {
    epoch++; clearSources(); state = 'stopped'; pauseReason = null;
    if (reset) position = manifest?.clip.from ?? 0;
  }
  function updateGains() {
    if (!context || !master || !manifest) return;
    for (const track of manifest.tracks) {
      let gain = gains.get(track.id);
      if (!gain) { gain = context.createGain(); gain.connect(master); gains.set(track.id, gain); }
      gain.gain.setValueAtTime(track.muted ? 0 : track.volume, context.currentTime);
    }
    for (const [id, gain] of gains) if (!manifest.tracks.some(track => track.id === id)) { gain.disconnect(); gains.delete(id); }
  }
  function ready() { return !!manifest && manifest.tracks.every(track => buffers.has(track.id)); }
  function requireBuffers() { requireManifest(); if (!ready()) throw new TracksError('MISSING_FILES', 'Для дорожек из манифеста нужно повторно выбрать исходные файлы. Проверяется SHA-256; аудиоданных в JSON нет.'); }
  function scheduleCycle(at: number, offset: number) {
    const current = requireManifest(); const ctx = audioContext();
    const plan = planTrackSegments(current, { startPosition: offset });
    for (const segment of plan.segments) {
      const buffer = buffers.get(segment.trackId)!;
      const available = Math.min(segment.durationSeconds, buffer.duration - segment.offsetSeconds);
      if (available <= 0) continue;
      const source = ctx.createBufferSource(); source.buffer = buffer; source.playbackRate.value = current.rate;
      source.connect(gains.get(segment.trackId)!); sources.add(source);
      source.onended = () => { sources.delete(source); source.disconnect(); };
      // Duration is measured in source-buffer seconds; playbackRate controls the
      // output duration. Every stem shares this cycle start and common boundary.
      source.start(at, segment.offsetSeconds, available);
    }
    return plan.durationSeconds;
  }
  function tick() {
    if (state !== 'playing' || !context || !manifest) return;
    const now = context.currentTime;
    const actual = actualPosition(now); position = actual.position;
    if (actual.finished) { clearSources(); state = 'finished'; return; }
    // A delayed control-thread timer must not launch several missed cycles at
    // once. Resume the current common-cycle position and keep its original end.
    if (manifest.loop && nextCycle > 0 && nextCycleAt < now) {
      const recoverAt = now + 0.03;
      const recovered = actualPosition(recoverAt);
      nextCycleAt = recoverAt + scheduleCycle(recoverAt, recovered.position);
      nextCycle = recovered.cycleIndex + 1;
    }
    let scheduled = 0;
    while (nextCycleAt <= now + 0.15 && (nextCycle === 0 || manifest.loop)) {
      const offset = nextCycle === 0 ? startPosition : manifest.clip.from;
      const duration = scheduleCycle(nextCycleAt, offset);
      nextCycleAt += duration; nextCycle++;
      if (++scheduled > 16) { pause('scheduling-limit'); return; }
    }
  }
  async function play() {
    ensureActive(); requireBuffers(); if (state === 'playing' || state === 'starting') return;
    const current = requireManifest(); const run = ++epoch; const ctx = audioContext();
    state = 'starting'; pauseReason = null;
    try { await ctx.resume(); }
    catch (error) { if (run === epoch) state = 'paused'; throw new TracksError('AUDIO_START', `Не удалось включить звук: ${error instanceof Error ? error.message : String(error)}`); }
    if (disposed || run !== epoch || manifest?.id !== current.id) return;
    updateGains();
    if (position >= current.clip.to || position < current.clip.from) position = current.clip.from;
    startPosition = position; anchorTime = ctx.currentTime + 0.03; nextCycleAt = anchorTime; nextCycle = 0;
    state = 'playing'; tick(); interval = setInterval(tick, 25);
  }
  function pause(reason = 'manual') {
    ensureActive();
    if (state !== 'playing' && state !== 'starting') return;
    position = actualPosition().position; epoch++; clearSources(); state = 'paused'; pauseReason = reason;
  }
  function tokenCheck(token: number) { if (disposed || token !== loadToken) throw new TracksError('LOAD_CANCELLED', 'Загрузка отменена; её результат не применён.'); }
  function sourceCheck(file: File) {
    if (!(file instanceof File) || !/\.(?:wav|mp3)$/i.test(file.name)) throw new TracksError('FILE_TYPE', 'Выбери локальный WAV или MP3.');
    if (file.size < 1 || file.size > TRACK_LIMITS.sourcePerFile) throw new TracksError('SOURCE_LIMIT', 'Каждый исходный файл должен быть непустым и не больше 64 МиБ.');
  }
  async function decode(file: File, token: number, expected?: TrackDescriptor) {
    sourceCheck(file); const bytes = await file.arrayBuffer(); tokenCheck(token);
    const digest = await crypto.subtle.digest('SHA-256', bytes); tokenCheck(token);
    const sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    if (expected) assertFileMatches(expected, { sha256, size: file.size });
    let buffer: AudioBuffer;
    try { buffer = await audioContext().decodeAudioData(bytes); }
    catch { throw new TracksError('DECODE_FAILED', `Не удалось декодировать «${file.name}». Поддержка WAV/MP3 зависит от кодека браузера; прежний набор не изменён.`); }
    tokenCheck(token);
    if (expected && Math.abs(buffer.duration - expected.decoded.duration) > 0.05) throw new TracksError('DECODE_MISMATCH', 'Длительность повторно декодированного файла отличается от манифеста больше чем на 0,05 с. Ожидаемая дорожка не заменена.');
    return { buffer, sha256 };
  }
  function bufferBytes(values: Iterable<AudioBuffer>) { let total = 0; for (const buffer of values) total += buffer.length * buffer.numberOfChannels * 4; return total; }

  function getPlaybackState() {
    if (state === 'playing') tick();
    const actual = actualPosition();
    return { state, position: actual.position, cycleIndex: actual.cycleIndex, loading, ready: ready(), pauseReason, boundTrackIds: [...buffers.keys()] };
  }

  return {
    async loadFiles(files: readonly File[]) {
      ensureActive();
      if (!Array.isArray(files) || files.length < 1 || files.length > 4) throw new TracksError('TRACK_COUNT', 'Выбери от одного до четырёх WAV/MP3 файлов.');
      files.forEach(sourceCheck);
      if (files.reduce((sum, file) => sum + file.size, 0) > TRACK_LIMITS.sourceTotal) throw new TracksError('SOURCE_LIMIT', 'Суммарный размер исходников превышает 256 МиБ.');
      const token = ++loadToken; loading = true;
      try {
        const nextBuffers = new Map<string, AudioBuffer>(); const tracks: TrackDescriptor[] = [];
        for (const file of files) {
          const { buffer, sha256 } = await decode(file, token); const id = `track-${crypto.randomUUID()}`;
          nextBuffers.set(id, buffer);
          if (bufferBytes(nextBuffers.values()) > TRACK_LIMITS.decodedTotal) throw new TracksError('PCM_LIMIT', 'Декодированный набор превышает 512 МиБ PCM. Прежний набор сохранён.');
          tracks.push({ id, name: file.name, size: file.size, lastModified: file.lastModified, sha256,
            decoded: { duration: buffer.duration, frames: buffer.length, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels }, volume: 0.8, muted: false });
        }
        const next = createTracksManifest({ id: `tracks-${crypto.randomUUID()}`, tracks }); tokenCheck(token);
        stopInternal(); manifest = next; buffers = nextBuffers; position = next.clip.from; updateGains();
        return next;
      } finally { if (token === loadToken) loading = false; }
    },
    restoreManifest(value: unknown) {
      const validated = validateTracksManifest(value); ensureActive(); loadToken++; loading = false; stopInternal();
      manifest = validated; buffers = new Map(); position = validated.clip.from; updateGains(); return validated;
    },
    async rebindFile(trackId: string, file: File) {
      const current = requireManifest(); requirePaused();
      const expected = current.tracks.find(track => track.id === trackId); if (!expected) throw new TracksError('UNKNOWN_TRACK', 'Неизвестная дорожка манифеста.');
      const token = ++loadToken; loading = true;
      try {
        const { buffer } = await decode(file, token, expected);
        const next = new Map(buffers); next.set(trackId, buffer);
        if (bufferBytes(next.values()) > TRACK_LIMITS.decodedTotal) throw new TracksError('PCM_LIMIT', 'Повторно декодированный набор превышает 512 МиБ PCM.');
        tokenCheck(token); buffers = next; return current;
      } finally { if (token === loadToken) loading = false; }
    },
    // decodeAudioData itself is not abortable; stale completion is discarded.
    cancelLoad() { ensureActive(); loadToken++; loading = false; },
    play, pause,
    stop() { ensureActive(); stopInternal(); },
    async seek(seconds: number) {
      const current = requireManifest();
      if (!Number.isFinite(seconds) || seconds < current.clip.from || seconds > current.clip.to) throw new TracksError('INVALID_SEEK', 'Позиция должна находиться внутри общего фрагмента.');
      const wasPlaying = state === 'playing' || state === 'starting'; if (wasPlaying) pause(); position = seconds;
      if (seconds === current.clip.to && !current.loop) { state = 'finished'; return; }
      if (wasPlaying) await play();
    },
    setClip(clip: { from: number; to: number }) { const current = requireManifest(); requirePaused(); manifest = setTracksPlayback(current, { clip }); position = clip.from; return manifest; },
    setLoop(loop: boolean) { const current = requireManifest(); requirePaused(); manifest = setTracksPlayback(current, { loop }); return manifest; },
    setRate(rate: number) { const current = requireManifest(); requirePaused(); manifest = setTracksPlayback(current, { rate }); return manifest; },
    setTrackMix(id: string, mix: { volume?: number; muted?: boolean }) { manifest = updateMix(requireManifest(), id, mix); updateGains(); return manifest; },
    getManifest() { return manifest; },
    getPlaybackState,
    getSnapshot() {
      const playback = getPlaybackState();
      let peak = 0; let energy = 0;
      if (analyser) { analyser.getFloatTimeDomainData(waveform); for (const sample of waveform) { peak = Math.max(peak, Math.abs(sample)); energy += sample * sample; } }
      return { ...playback, activeSources: sources.size, sampleRate: context?.sampleRate ?? null,
        pitchShiftCents: manifest ? 1200 * Math.log2(manifest.rate) : 0, output: { peak, rms: Math.sqrt(energy / waveform.length) } };
    },
    async renderOffline(options: { durationSeconds?: number } = {}) {
      requirePaused(); requireBuffers(); const current = requireManifest();
      const cycleSeconds = (current.clip.to - current.clip.from) / current.rate;
      const durationSeconds = options.durationSeconds ?? cycleSeconds * (current.loop ? 2 : 1);
      if (!Number.isFinite(durationSeconds) || durationSeconds < 0.05 || durationSeconds > 30) throw new TracksError('OFFLINE_LIMIT', 'Диагностический рендер ограничен 0,05–30 секундами.');
      const offline = new OfflineAudioContext(current.tracks.length, Math.ceil(durationSeconds * 48000), 48000);
      const merger = offline.createChannelMerger(current.tracks.length); merger.connect(offline.destination);
      const buses = new Map<string, GainNode>();
      current.tracks.forEach((track, index) => {
        const bus = offline.createGain(); bus.channelCount = 1; bus.channelCountMode = 'explicit'; bus.gain.value = track.muted ? 0 : track.volume;
        bus.connect(merger, 0, index); buses.set(track.id, bus);
      });
      const plan = planTrackSegments(current, { cycles: current.loop ? Math.ceil(durationSeconds / cycleSeconds) : 1 });
      for (const segment of plan.segments) {
        const buffer = buffers.get(segment.trackId)!; const available = Math.min(segment.durationSeconds, buffer.duration - segment.offsetSeconds);
        if (available <= 0) continue;
        const source = offline.createBufferSource(); source.buffer = buffer; source.playbackRate.value = current.rate; source.connect(buses.get(segment.trackId)!);
        source.start(segment.atSeconds, segment.offsetSeconds, available);
      }
      const rendered = await offline.startRendering();
      return { sampleRate: rendered.sampleRate, durationSeconds: rendered.duration, trackIds: current.tracks.map(track => track.id), channels: current.tracks.map((_, index) => rendered.getChannelData(index).slice()), segments: plan.segments };
    },
    async dispose() { if (disposed) return; loadToken++; loading = false; stopInternal(); buffers.clear(); gains.forEach(gain => gain.disconnect()); gains.clear(); master?.disconnect(); analyser?.disconnect(); disposed = true; await context?.close(); },
  };
}
