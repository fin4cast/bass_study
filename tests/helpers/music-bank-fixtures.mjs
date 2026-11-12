import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as alphaTab from '@coderline/alphatab';

export function usePersonalMusicBank() {
  return process.argv.includes('--corpus') || process.env.BASS_REGRESSION_PROFILE === 'corpus';
}

function scoreBytes(title, bass, kick, snare) {
  const bars = notes => Array(32).fill(notes).join(' | ');
  const tex = String.raw`\title "${title}"
\tempo 120
.
\track "Bass" { instrument 34 }
\staff { score tabs }
\tuning G2 D2 A1 E1
${bars(bass)}
\track "Kick" { instrument percussion }
\staff { score }
${bars(kick)}
\track "Snare" { instrument percussion }
\staff { score }
${bars(snare)}`;
  return Buffer.from(new alphaTab.exporter.Gp7Exporter().export(alphaTab.importer.ScoreLoader.loadAlphaTex(tex)));
}

export function portableMusicBankSamples() {
  return [
    ['sample-03', 'Учебный рисунок A.gp', scoreBytes('Учебный рисунок A', '0.4.4 2.4.4 3.4.4 2.4.4', ':4 36 r 36 r', ':4 r 38 r 38')],
    ['sample-05', 'Учебный рисунок B.gp', scoreBytes('Учебный рисунок B', '3.4.4 2.4.4 0.4.4 2.4.4', ':4 36 36 36 36', ':4 38 38 38 38')],
    ['unsupported', 'Неподдерживаемый.gtp', Buffer.from('This is intentionally not a Guitar Pro score.')],
  ].map(([id, relativePath, data]) => ({ id, relativePath, extension: relativePath.slice(relativePath.lastIndexOf('.')),
    data, sha256: createHash('sha256').update(data).digest('hex') }));
}

export async function openMusicBankTestInputs(resultDir, corpus = usePersonalMusicBank()) {
  if (corpus) {
    if (!process.env.BASS_MUSIC_BANK_ROOT) throw new Error('Укажи BASS_MUSIC_BANK_ROOT для проверок личной коллекции.');
    const { selection, samplePath, sampleBytes, libraryRoot } = await import('./music-bank-corpus.mjs');
    await Promise.all(selection.samples.map(sampleBytes));
    return { selection, samplePath, sampleBytes, libraryRoot, corpus, query: 'Jackson Billie Jean', minimumCount: 48001 };
  }
  await mkdir(resultDir, { recursive: true });
  const libraryRoot = await mkdtemp(join(resultDir, 'synthetic-scores-'));
  const samples = portableMusicBankSamples();
  const samplePath = sample => join(libraryRoot, sample.relativePath);
  await Promise.all(samples.map(sample => writeFile(samplePath(sample), sample.data)));
  const catalogue = samples[0].data;
  for (let index = 1; index <= 82; index++) {
    await writeFile(join(libraryRoot, `Каталог ${String(index).padStart(3, '0')}.gp`), catalogue);
  }
  return { selection: { samples }, samplePath, sampleBytes: sample => readFile(samplePath(sample)),
    libraryRoot, corpus, query: 'Учебный рисунок B', minimumCount: 83 };
}
