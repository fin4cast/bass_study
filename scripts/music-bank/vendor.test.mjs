import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import * as original from '@coderline/alphatab';
import { musicBankVendorDir } from '../prepare-music-bank.mjs';

// Подготовку выполняет отдельная команда сборки. Тест не меняет assets:
// его можно запускать, пока другой процесс читает готовую поставку.
const patched = await import(pathToFileURL(resolve(musicBankVendorDir, 'alphaTab.js')).href);
const helper = await import(pathToFileURL(resolve(musicBankVendorDir, 'channel-layout.js')).href);
const soundFont = new Uint8Array(await readFile(resolve(musicBankVendorDir, 'soundfont/sonivox.sf2')));
const hash = data => createHash('sha256').update(data).digest('hex');

test('готовые локальные ESM assets соответствуют manifest, включают лицензии и не ссылаются на .mjs', async () => {
  const manifest = JSON.parse(await readFile(resolve(musicBankVendorDir, 'patch-manifest.json'), 'utf8'));
  assert.equal(manifest.upstream.version, '1.9.0');
  for (const asset of manifest.assets) {
    const bytes = await readFile(resolve(musicBankVendorDir, asset.path));
    assert.equal(hash(bytes), asset.sha256);
    assert.doesNotMatch(bytes.toString('utf8'), /["']\.\/(alphaTab(?:\.core|\.worker|\.worklet)?|channel-layout)\.mjs["']/);
  }
  for (const path of ['LICENSE', 'LICENSE.header', 'font/Bravura-OFL.txt', 'soundfont/LICENSE']) {
    assert.ok((await readFile(resolve(musicBankVendorDir, path))).length > 100);
  }
  assert.match(await readFile(resolve(musicBankVendorDir, 'alphaTab.core.js'), 'utf8'), /Mozilla Public/);
  assert.equal(typeof patched.AlphaTabApi, 'function');
});

test('продуктовая модель каналов сохраняет отдельные инструменты и пары специальных приёмов', () => {
  const score = { tracks: Array.from({ length: 20 }, (_, i) => ({
    playbackInfo: { primaryChannel: 9, secondaryChannel: 9, program: i, bank: 0 },
    staves: [{ isPercussion: i % 3 === 0 }],
  })) };
  const layout = helper.normalizeScoreChannels(score), used = new Set();
  for (const track of layout.tracks) {
    for (const ch of new Set(track.channels)) {
      assert.equal(used.has(ch), false); used.add(ch);
      assert.equal(helper.isPercussionChannel(ch), track.percussion);
    }
    assert.equal(helper.sameInstrumentChannels(...track.channels), true);
  }
  assert.equal(helper.normalizeScoreChannels(score).changed, false);
  assert.deepEqual(score.tracks.map(t => t.playbackInfo.program), Array.from({ length: 20 }, (_, i) => i));
});

function emitter() {
  const listeners = new Set();
  return { on: fn => listeners.add(fn), off: fn => listeners.delete(fn), trigger: value => { for (const fn of listeners) fn(value); } };
}
function fixture(lib, { channel = 9, neighbor = false, velocityZero = false } = {}) {
  const midi = new lib.midi.MidiFile(), handler = new lib.midi.AlphaSynthMidiFileHandler(midi);
  handler.addTimeSignature(0, 4, 4); handler.addTempo(0, 120);
  for (const [track, ch] of [[0, channel], ...(neighbor ? [[1, 25]] : [])]) {
    handler.addControlChange(track, 0, ch, 7, 100); handler.addControlChange(track, 0, ch, 10, 64);
    handler.addProgramChange(track, 0, ch, 0);
  }
  handler.addNote(0, 0, 3840, 46, 100, channel);
  if (neighbor) handler.addNote(1, 480, 480, velocityZero ? 46 : 42, velocityZero ? 0 : 100, 25);
  handler.finishTrack(0, 7680); return midi;
}
function pcm(lib, midi, { mute = [], solo = [], volume = [] } = {}) {
  const chunks = [], output = {
    sampleRate: 44100, ready: emitter(), sampleRequest: emitter(), samplesPlayed: emitter(),
    open() { this.ready.trigger(); }, play() {}, pause() {}, activate() {}, destroy() {}, resetSamples() {},
    addSamples(samples) { if (samples.length) chunks.push(samples); },
  };
  const synth = new lib.synth.AlphaSynth(output, 100);
  try {
    synth.loadMidiFile(midi); synth.loadSoundFont(soundFont, false);
    synth.masterVolume = 0.5; synth.metronomeVolume = 0; synth.countInVolume = 0;
    for (const ch of mute) synth.setChannelMute(ch, true);
    for (const ch of solo) synth.setChannelSolo(ch, true);
    for (const [ch, gain] of volume) synth.setChannelVolume(ch, gain);
    assert.equal(synth.play(), true);
    const count = 52920 * 2; let received = 0;
    while (received < count) {
      const before = chunks.length; output.sampleRequest.trigger();
      assert.ok(chunks.length > before, 'DSP остановился до завершения контрольного фрагмента');
      for (let i = before; i < chunks.length; i++) received += chunks[i].length;
    }
    const result = new Float32Array(count); let offset = 0;
    for (const chunk of chunks) { const n = Math.min(chunk.length, count-offset); result.set(chunk.subarray(0,n), offset); offset += n; if (offset === count) break; }
    return result;
  } finally { synth.destroy(); }
}
function maxDelta(a, b) { let max = 0; for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i]-b[i])); return max; }

test('продуктовый .js ESM даёт штатный PCM на drum25 и независимые mute/solo/volume без чужого choke/noteoff', () => {
  const reference = pcm(original, fixture(original));
  assert.ok(reference.some(v => Math.abs(v) > 0.001));
  const extended = pcm(patched, fixture(patched, { channel: 25 }));
  assert.ok(maxDelta(reference, extended) < 2e-6);
  const quiet = pcm(patched, fixture(patched, { channel: 25 }), { volume: [[25, 0.25]] });
  assert.ok(maxDelta(reference.map(v => v*0.25), quiet) < 2e-6);
  const muted = pcm(patched, fixture(patched, { channel: 25 }), { mute: [25] });
  assert.ok(muted.every(v => v === 0));
  for (const velocityZero of [false, true]) {
    const actual = pcm(patched, fixture(patched, { neighbor: true, velocityZero }), { mute: [25] });
    assert.ok(maxDelta(reference, actual) < 2e-6);
    const solo = pcm(patched, fixture(patched, { neighbor: true, velocityZero }), { solo: [9] });
    assert.ok(maxDelta(reference, solo) < 2e-6);
  }
});
