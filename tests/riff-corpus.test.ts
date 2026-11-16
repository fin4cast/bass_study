import { describe, expect, it } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { buildExercise, createExerciseSpec, RIFF_IDS } from '../src/exercises';
import { buildTimeline } from '../src/exercises/rhythm';
// @ts-expect-error — вспомогательный модуль на JavaScript без объявлений типов.
import { portableMusicBankSamples } from './helpers/music-bank-fixtures.mjs';

/**
 * Встроенные риффы не воспроизводят партию конкретной песни (R-028, B4). Тест сравнивает такты каждой фигуры с тактами
 * партий нотного корпуса по подписи «ритм + интервалы от первой ноты»: тот же ритм и те же интервалы — совпадение.
 * Самодостаточная часть работает на синтетических партитурах репозитория; на личной коллекции владельца
 * (`BASS_MUSIC_BANK_ROOT`, режим `--corpus`) то же сравнение идёт по выборке из `tests/fixtures/music-bank-corpus-selection.json`.
 */

/** Подпись такта: `[начало, длина, высота − высота первой ноты]` в шестнадцатых; паузы не входят. */
type Signature = readonly (readonly [number, number, number])[];

/** Такты первой нотной партии партитуры (самой низкой по высоте — бас). */
function barSignatures(bytes: Uint8Array): Signature[] {
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes);
  const result: Signature[] = [];
  for (const track of score.tracks) {
    if (track.isPercussion || !track.staves.length) continue;
    for (const bar of track.staves[0].bars) {
      const events: [number, number, number][] = [];
      for (const beat of bar.voices[0]?.beats ?? []) {
        if (beat.isRest || beat.isEmpty || !beat.notes.length) continue;
        events.push([Math.round((beat.playbackStart - bar.masterBar.start) / 240), Math.round(beat.playbackDuration / 240), beat.notes[0].realValue]);
      }
      if (events.length) result.push(events.map(([start, length, pitch]) => [start, length, pitch - events[0][2]] as const));
    }
  }
  return result;
}

/** Подписи тактов фигуры: ноты плана по шкале прохода. */
function riffSignatures(riff: (typeof RIFF_IDS)[number]): Signature[] {
  const plan = buildExercise(createExerciseSpec('riff', { riff }));
  const timeline = buildTimeline(plan);
  const bars: [number, number, number][][] = [];
  for (const step of timeline.steps) {
    if (step.note === null || step.tie) continue;
    (bars[step.bar] ??= []).push([step.start % 16, step.grids, plan.notes[step.note].midi]);
  }
  return bars.filter(Boolean).map(events => events.map(([start, length, pitch]) => [start, length, pitch - events[0][2]] as const));
}

/** Корень личной коллекции из окружения; без него сравнение на ней пропускается. */
const CORPUS_ROOT = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.BASS_MUSIC_BANK_ROOT;
const same = (a: Signature, b: Signature) => a.length === b.length && a.every((event, index) => event.every((value, at) => value === b[index][at]));

describe('риффы не совпадают с партиями корпуса', () => {
  const synthetic = portableMusicBankSamples().filter((sample: { extension: string }) => sample.extension === '.gp');

  it('подпись такта читается из партитуры: учебный рисунок A — четыре четверти E1, F♯1, G1, F♯1', () => {
    const [bar] = barSignatures(new Uint8Array(synthetic[0].data));
    expect(bar).toEqual([[0, 4, 0], [4, 4, 2], [8, 4, 3], [12, 4, 2]]);
  });

  it('ни один такт ни одной фигуры не совпадает с тактом синтетических партитур', () => {
    for (const riff of RIFF_IDS) {
      const figure = riffSignatures(riff);
      for (const sample of synthetic) {
        const parts = barSignatures(new Uint8Array(sample.data));
        for (const [index, bar] of figure.entries()) expect(parts.some(part => same(part, bar)), `${riff}, такт ${index + 1} совпал с партией ${sample.relativePath}`).toBe(false);
      }
    }
  });

  // Регрессия требует, чтобы ни один unit-тест не был пропущен, поэтому без BASS_MUSIC_BANK_ROOT тест сразу завершается (сравнение не выполняется).
  it('на личной коллекции (только при BASS_MUSIC_BANK_ROOT): ни один такт фигуры не совпадает с партией', async () => {
    if (!CORPUS_ROOT) return;
    // @ts-expect-error — JavaScript-модуль выборки без объявлений типов.
    const { selection, sampleBytes } = await import('./helpers/music-bank-corpus.mjs');
    const figures = RIFF_IDS.flatMap(riff => riffSignatures(riff).map((bar, index) => ({ riff, index, bar })));
    for (const sample of selection.samples) {
      let parts: Signature[];
      try { parts = barSignatures(new Uint8Array(await sampleBytes(sample))); } catch { continue; }
      for (const figure of figures) expect(parts.some(part => same(part, figure.bar)), `${figure.riff}, такт ${figure.index + 1} совпал с партией ${sample.id}`).toBe(false);
    }
  }, 120_000);
});
