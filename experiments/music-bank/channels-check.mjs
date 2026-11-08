import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as original from '@coderline/alphatab';
import { selection, sampleBytes, resultDir } from './inspect.mjs';
import { generatedVendor, prepareVendor } from './prepare-vendor.mjs';
import { isPercussionChannel, normalizeScoreChannels, sameInstrumentChannels } from './channel-layout.mjs';

const manifest = await prepareVendor();
const patched = await import(pathToFileURL(resolve(generatedVendor, 'alphaTab.mjs')).href);
const soundFont = new Uint8Array(await readFile(resolve(generatedVendor, 'soundfont/sonivox.sf2')));
const report = { generatedAt: new Date().toISOString(), manifest, node: process.version, checks: [], files: [],
  scope: 'Node: настоящий DSP/PCM alphaSynth из локального SoundFont. Вывод в устройство и браузерный live отдельно; PCM не сохраняется.',
  limitations: ['Целевая выборка 16 файлов и независимые синтетические музыкальные примеры, не весь каталог.',
    'Виртуальные каналы предназначены только для внутреннего проигрывателя; SMF/MIDI-экспорт требует отдельного преобразования.'] };

async function check(name, action) {
  try { const details = await action(); report.checks.push({ name, status: 'passed', details }); console.log(`PASS ${name}`); }
  catch (error) { report.checks.push({ name, status: 'failed', error: error.stack || String(error) }); console.log(`FAIL ${name}: ${error.message}`); }
}
function emitter() {
  const listeners = new Set();
  return { on: f => listeners.add(f), off: f => listeners.delete(f), trigger: value => { for (const f of listeners) f(value); } };
}
function generate(lib, score) {
  const settings = new lib.Settings(), midi = new lib.midi.MidiFile();
  const generator = new lib.midi.MidiFileGenerator(score, settings, new lib.midi.AlphaSynthMidiFileHandler(midi));
  generator.applyTranspositionPitches = false; generator.generate();
  return { midi, pitches: generator.transpositionPitches, generator };
}
function allEvents(midi) { return midi.tracks.flatMap(t => t.events).sort((a,b) => a.tick - b.tick); }
function noteStart(midi, track) { return allEvents(midi).find(e => e.track === track && e.type === 128 && e.noteVelocity > 0)?.tick; }
function stats(pcm) {
  let peak = 0, squares = 0;
  for (const value of pcm) { peak = Math.max(peak, Math.abs(value)); squares += value * value; }
  return { frames: pcm.length / 2, sampleRate: 44100, channels: 2, peak, rms: Math.sqrt(squares / Math.max(1, pcm.length)),
    sha256: createHash('sha256').update(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)).digest('hex') };
}
function delta(a, b) {
  assert.equal(a.length, b.length, 'Длина сравниваемых PCM различается');
  let peak = 0, squares = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; peak = Math.max(peak, Math.abs(d)); squares += d*d; }
  return { peak, rms: Math.sqrt(squares / Math.max(1, a.length)) };
}
function channels(score) { return score.tracks.map(t => [...new Set([t.playbackInfo.primaryChannel, t.playbackInfo.secondaryChannel])]); }

// Это чистый DSP, не fake-device и не измерение физического вывода. Используются
// настоящие loadMidiFile/loadSoundFont, setChannelMute/Solo/Volume и synth PCM.
function render(lib, generated, { startTick = 0, milliseconds = 1200, mute = [], solo = [], volumes = [], livePitches = [] } = {}) {
  const collected = [], output = {
    sampleRate: 44100, ready: emitter(), sampleRequest: emitter(), samplesPlayed: emitter(),
    open() { this.ready.trigger(); }, play() {}, pause() {}, activate() {}, destroy() {}, resetSamples() {},
    addSamples(samples) { if (samples.length) collected.push(samples); }
  };
  const synth = new lib.synth.AlphaSynth(output, 100);
  try {
    synth.loadMidiFile(generated.midi); synth.loadSoundFont(soundFont, false);
    assert.equal(synth.isReadyForPlayback, true);
    synth.applyTranspositionPitches(generated.pitches || new Map());
    synth.masterVolume = 0.5; synth.metronomeVolume = 0; synth.countInVolume = 0;
    for (const [channel, volume] of volumes) synth.setChannelVolume(channel, volume);
    for (const channel of mute) synth.setChannelMute(channel, true);
    for (const channel of solo) synth.setChannelSolo(channel, true);
    for (const [channel, pitch] of livePitches) synth.setChannelTranspositionPitch(channel, pitch);
    synth.tickPosition = startTick;
    assert.equal(synth.play(), true);
    const required = Math.ceil(milliseconds * 44100 / 1000) * 2;
    let received = 0;
    for (let i = 0; i < 2000 && received < required; i++) {
      const before = collected.length; output.sampleRequest.trigger();
      for (let j = before; j < collected.length; j++) received += collected[j].length;
      if (collected.length === before) break;
    }
    const result = new Float32Array(required); let offset = 0;
    for (const chunk of collected) { const count = Math.min(chunk.length, required - offset); result.set(chunk.subarray(0, count), offset); offset += count; if (offset === required) break; }
    return result;
  } finally { synth.destroy(); }
}
function instrumentSummary(score) {
  return score.tracks.map(t => ({ name: t.name, program: t.playbackInfo.program, bank: t.playbackInfo.bank,
    volume: t.playbackInfo.volume, balance: t.playbackInfo.balance, mute: t.playbackInfo.isMute, solo: t.playbackInfo.isSolo,
    staves: t.staves.map(s => ({ percussion: s.isPercussion, tuning: s.tuning, transpositionPitch: s.transpositionPitch })) }));
}
function musicalEvents(midi) {
  // Новые служебные ProgramChange на бывшем общем канале ожидаемы. Проверяем
  // сами ноты, паузы, bends, темп, метр и развёрнутый порядок после реприз.
  return allEvents(midi).filter(e => [128, 144, 224, 96, 81, 88, 241, 242].includes(e.type)).map(e => {
    const o = Object.fromEntries(Object.entries(e).filter(([key]) => !['channel'].includes(key)));
    return o;
  });
}

await check('Алгоритм: детерминизм, непересечение и отказ до частичной записи', () => {
  const mock = { tracks: Array.from({ length: 24 }, (_, i) => ({ playbackInfo: { primaryChannel: 9, secondaryChannel: 9 }, staves: [{ isPercussion: i % 3 === 0 }] })) };
  const first = normalizeScoreChannels(mock), second = normalizeScoreChannels(mock);
  assert.equal(second.changed, false);
  const used = new Set();
  for (const t of first.tracks) for (const ch of new Set(t.channels)) { assert.equal(used.has(ch), false); used.add(ch); assert.equal(isPercussionChannel(ch), t.percussion); }
  for (const t of first.tracks) assert.equal(sameInstrumentChannels(...t.channels), true);
  for (const a of first.tracks) for (const b of first.tracks) if (a.index !== b.index) {
    for (const ca of a.channels) for (const cb of b.channels) assert.equal(sameInstrumentChannels(ca, cb), false);
  }
  const bad = { tracks: [{ playbackInfo: { primaryChannel: 4, secondaryChannel: 5 }, staves: [{ isPercussion: false }] },
    { playbackInfo: { primaryChannel: 9, secondaryChannel: 9 }, staves: [{ isPercussion: false }, { isPercussion: true }] }] };
  assert.throws(() => normalizeScoreChannels(bad), /Смешанный/); assert.equal(bad.tracks[0].playbackInfo.primaryChannel, 4);
  return { tracks: first.tracks.length, virtualChannels: used.size, maxChannel: Math.max(...used) };
});

for (const sample of selection.samples) {
  const entry = { id: sample.id, path: sample.relativePath }; report.files.push(entry);
  await check(`${sample.id}: структура, музыкальные события и отдельный PCM каждой партии`, async () => {
    const bytes = await sampleBytes(sample);
    if (sample.extension === '.gtp') {
      assert.throws(() => patched.importer.ScoreLoader.loadScoreFromBytes(bytes, new patched.Settings()), /No compatible importer/);
      entry.status = 'unsupported-gtp'; return { unsupported: true };
    }
    const baseline = original.importer.ScoreLoader.loadScoreFromBytes(bytes, new original.Settings());
    const score = patched.importer.ScoreLoader.loadScoreFromBytes(bytes, new patched.Settings());
    assert.deepEqual(instrumentSummary(score), instrumentSummary(baseline));
    const sourceGenerated = generate(original, baseline), actual = generate(patched, score);
    assert.deepEqual(musicalEvents(actual.midi), musicalEvents(sourceGenerated.midi));
    const assigned = channels(score), used = new Set();
    for (const t of score.tracks) for (const ch of assigned[t.index]) {
      assert.equal(used.has(ch), false, `Общий канал ${ch}`); used.add(ch);
      assert.equal(isPercussionChannel(ch), t.isPercussion);
    }
    assert.equal(normalizeScoreChannels(score).changed, false);
    entry.channels = assigned; entry.tracks = [];
    for (const track of score.tracks) {
      const trackResult = { index: track.index, name: track.name, channels: assigned[track.index], percussion: track.isPercussion };
      entry.tracks.push(trackResult);
      const start = noteStart(actual.midi, track.index);
      if (start === undefined) { trackResult.status = 'empty'; continue; }
      // Штатный независимый эталон: та же партия из того же GP, оставленная
      // единственной в памяти, с исходной программой/банком и штатным channel9.
      const isolated = original.importer.ScoreLoader.loadScoreFromBytes(bytes, new original.Settings());
      const one = isolated.tracks[track.index]; isolated.tracks = []; isolated.addTrack(one);
      one.playbackInfo.primaryChannel = one.isPercussion ? 9 : 0;
      one.playbackInfo.secondaryChannel = one.isPercussion ? 9 : 1;
      const expected = generate(original, isolated), expectedStart = noteStart(expected.midi, 0);
      const solo = assigned[track.index];
      const full = render(patched, actual, { startTick: start, solo });
      const expectedPcm = render(original, expected, { startTick: expectedStart });
      const quiet = render(patched, actual, { startTick: start, solo, volumes: solo.map(ch => [ch, 0.25]) });
      const muted = render(patched, actual, { startTick: start, solo, mute: solo });
      const soloOtherMuted = render(patched, actual, { startTick: start, mute: assigned.filter((_, i) => i !== track.index).flat() });
      const fullStats = stats(full), difference = delta(full, expectedPcm), isolatedDelta = delta(full, soloOtherMuted);
      const quietStats = stats(quiet), mutedStats = stats(muted);
      Object.assign(trackResult, { status: 'checking', startTick: start, expectedStartTick: expectedStart,
        full: fullStats, expected: stats(expectedPcm), quiet: quietStats, muted: mutedStats,
        differenceFromStockSingleTrack: difference, soloVsMuteOtherTracks: isolatedDelta });
      assert.ok(fullStats.peak > 1e-7, `Пустой PCM у непустой партии ${track.index}`);
      assert.ok(mutedStats.peak < 1e-8, `Mute партии ${track.index} не дал тишину`);
      assert.ok(difference.peak < 2e-6, `Изменился PCM партии ${track.index}: peakDelta=${difference.peak}`);
      assert.ok(isolatedDelta.peak < 2e-6, 'Solo отличается от выключения остальных партий');
      const ratio = quietStats.rms / fullStats.rms;
      assert.ok(ratio > 0.245 && ratio < 0.255, `Громкость партии ${track.index}: ${ratio}`);
      trackResult.status = 'passed'; trackResult.rmsQuarterToFull = ratio;
    }
    entry.status = 'passed'; return { tracks: score.tracks.length, independentlyAudible: entry.tracks.filter(t => t.status === 'passed').length, channels: assigned };
  });
}

// Контрольные MIDI-примеры независимы от коллекции GP. В одном случае
// закрытый hi-hat на отключённой второй партии не должен оборвать открытый
// hi-hat первой. В другом velocity0 не должен гасить ту же высоту чужой партии.
function fixture(lib, { extended = true, second = true, zero = false, percussionProgram = 0 } = {}) {
  const midi = new lib.midi.MidiFile(), h = new lib.midi.AlphaSynthMidiFileHandler(midi);
  h.addTimeSignature(0, 4, 4); h.addTempo(0, 120);
  const main = 9, other = extended ? 25 : 9;
  for (const [track, channel] of [[0, main], ...(second ? [[1, other]] : [])]) {
    h.addControlChange(track, 0, channel, 7, 100); h.addControlChange(track, 0, channel, 10, 64);
    h.addProgramChange(track, 0, channel, percussionProgram);
  }
  h.addNote(0, 0, 3840, 46, 100, main);
  if (second) h.addNote(1, 480, 480, zero ? 46 : 42, zero ? 0 : 100, other);
  h.finishTrack(0, 7680); if (second) h.finishTrack(1, 7680);
  return { midi, pitches: new Map() };
}
for (const [name, zero] of [['SoundFont choke-group', false], ['NoteOn velocity0', true]]) {
  await check(`${name}: отключённая вторая партия не гасит первую`, () => {
    const baseline = render(original, fixture(original, { second: false }));
    const actual = render(patched, fixture(patched, { zero }), { mute: [25] });
    const difference = delta(baseline, actual);
    assert.ok(stats(actual).peak > 0.001); assert.ok(difference.peak < 2e-6, `Чужая партия изменила PCM: ${difference.peak}`);
    return { baseline: stats(baseline), actual: stats(actual), difference };
  });
}
await check('Extended drums: штатный fallback неизвестного drum program', () => {
  const reference = render(original, fixture(original, { second: false, percussionProgram: 127 }));
  const generated = fixture(patched, { second: false, percussionProgram: 127 });
  for (const event of allEvents(generated.midi)) if ('channel' in event) event.channel = 25;
  const actual = render(patched, generated), difference = delta(reference, actual);
  assert.ok(stats(actual).peak > 0.001); assert.ok(difference.peak < 2e-6);
  return { reference: stats(reference), actual: stats(actual), difference };
});
await check('Extended melodic: program-change, pitch-bend, per-note-bend и транспозиция', () => {
  function melodicFixture(lib, primary, secondary) {
    const midi = new lib.midi.MidiFile(), h = new lib.midi.AlphaSynthMidiFileHandler(midi);
    h.addTimeSignature(0, 4, 4); h.addTempo(0, 120);
    for (const ch of [primary, secondary]) {
      h.addControlChange(0, 0, ch, 7, 105); h.addControlChange(0, 0, ch, 10, 64);
      h.addControlChange(0, 0, ch, 0, 0); h.addControlChange(0, 0, ch, 32, 0);
      h.addControlChange(0, 0, ch, 101, 0); h.addControlChange(0, 0, ch, 100, 0); h.addControlChange(0, 0, ch, 6, 2);
      h.addProgramChange(0, 0, ch, 33); h.addProgramChange(0, 1920, ch, 27);
    }
    h.addNote(0, 0, 1700, 45, 95, primary); h.addNote(0, 0, 1700, 52, 90, secondary);
    h.addBend(0, 480, primary, 9216); h.addNoteBend(0, 960, secondary, 52, 10240);
    h.addNote(0, 1920, 1920, 57, 100, primary); h.addNote(0, 1920, 1920, 64, 90, secondary);
    h.finishTrack(0, 7680);
    return { midi, pitches: new Map([[primary, 3], [secondary, 3]]) };
  }
  const reference = render(original, melodicFixture(original, 0, 1), { milliseconds: 2200, livePitches: [[0, -2], [1, -2]] });
  const actual = render(patched, melodicFixture(patched, 20, 21), { milliseconds: 2200, livePitches: [[20, -2], [21, -2]] });
  const difference = delta(reference, actual);
  assert.ok(stats(actual).peak > 0.001); assert.ok(difference.peak < 2e-6);
  return { channels: [20, 21], programs: [33, 27], scoreTranspose: 3, liveTranspose: -2,
    reference: stats(reference), actual: stats(actual), difference };
});
await check('Повторная подготовка vendor даёт те же байты', async () => {
  const repeated = await prepareVendor(); assert.deepEqual(repeated, manifest);
  return { coreSha256: manifest.modifiedCoreSha256, helperSha256: manifest.helperSha256 };
});

await mkdir(resultDir, { recursive: true });
report.completedAt = new Date().toISOString();
report.summary = { passed: report.checks.filter(c => c.status === 'passed').length,
  failed: report.checks.filter(c => c.status === 'failed').length,
  pcmTracksPassed: report.files.flatMap(f => f.tracks || []).filter(t => t.status === 'passed').length };
await writeFile(resolve(resultDir, 'channels.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.summary));
if (report.summary.failed) process.exitCode = 1;
