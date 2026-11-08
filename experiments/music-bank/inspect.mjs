import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as alphaTab from '@coderline/alphatab';

export const root = dirname(fileURLToPath(import.meta.url));
export const selection = JSON.parse(await readFile(resolve(root, 'sample-selection.json'), 'utf8'));
export const libraryRoot = resolve(process.env.BASS_MUSIC_BANK_ROOT || selection.libraryRoot);
export const resultDir = resolve(root, '../../test-results/music-bank');
export function samplePath(sample) {
  const path = resolve(libraryRoot, sample.relativePath);
  if (!path.startsWith(libraryRoot + sep)) throw new Error('Путь вне выбранной папки');
  return path;
}
export async function sampleBytes(sample) {
  const bytes = await readFile(samplePath(sample));
  if (bytes.length !== sample.bytes || createHash('sha256').update(bytes).digest('hex') !== sample.sha256) {
    throw new Error(`Изменился исходник: ${sample.id}`);
  }
  return bytes;
}
export function scoreSummary(score) {
  const channels = new Map();
  const tracks = score.tracks.map(track => {
    const p = track.playbackInfo;
    for (const channel of new Set([p.primaryChannel, p.secondaryChannel])) {
      channels.set(channel, [...(channels.get(channel) || []), track.index]);
    }
    let notes = 0, beats = 0;
    for (const staff of track.staves) for (const bar of staff.bars) for (const voice of bar.voices) {
      for (const beat of voice.beats) { beats++; notes += beat.notes.length; }
    }
    return { index: track.index, name: track.name, program: p.program, primaryChannel: p.primaryChannel,
      secondaryChannel: p.secondaryChannel, volume: p.volume, sourceMute: p.isMute, sourceSolo: p.isSolo,
      staves: track.staves.map(s => ({ percussion: s.isPercussion, tuning: s.tuning, bars: s.bars.length })), notes, beats };
  });
  return { title: score.title, artist: score.artist, tempo: score.tempo, bars: score.masterBars.length,
    tracks, sharedChannels: [...channels].filter(([, indexes]) => indexes.length > 1).map(([channel, indexes]) => ({ channel, tracks: indexes })) };
}
export async function inspect() {
  const results = [];
  for (const sample of selection.samples) {
    const started = performance.now();
    try {
      const bytes = await sampleBytes(sample);
      const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(bytes), new alphaTab.Settings());
      results.push({ id: sample.id, path: sample.relativePath, sha256: sample.sha256, status: 'loaded',
        parseMs: performance.now() - started, ...scoreSummary(score) });
    } catch (error) {
      results.push({ id: sample.id, path: sample.relativePath, status: 'rejected', error: String(error) });
    }
  }
  const report = { generatedAt: new Date().toISOString(), alphaTabVersion: '1.9.0', node: process.version,
    scope: 'Целевая выборка. Только разбор структуры; не проверка звука, правильности транскрипции или всего банка.', results };
  await mkdir(resultDir, { recursive: true });
  await writeFile(resolve(resultDir, 'inspect.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ loaded: results.filter(r => r.status === 'loaded').length, rejected: results.filter(r => r.status === 'rejected'),
    files: results.map(r => ({ id: r.id, tracks: r.tracks?.length, bars: r.bars, shared: r.sharedChannels })) }, null, 2));
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await inspect();
