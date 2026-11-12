import { test } from 'vitest';
import literal from './fixtures/backup.json?raw';
import { createPracticeDrafts } from '../src/app/practice-drafts';
import { createMemoryStudyStore, originalLocalDate, parseBackup, type PracticeDraft } from '../src/storage';

function backupWithJournals(repeats: number): string {
  const backup = JSON.parse(literal);
  const ear = backup.history.find((entry: { result: { kind: string } }) => entry.result.kind === 'ear').result.questions[1];
  ear.listenEvents = Array.from({ length: repeats }, (_, index) => {
    const listenId = `${ear.question.id}:listen-${index + 1}`;
    return [{ type: 'start', listenId, order: index * 2 + 1, atMs: index * 25, bpm: 75 },
      { type: 'cancel', listenId, order: index * 2 + 2, atMs: index * 25 + 1 }];
  }).flat();
  ear.listensStarted = repeats;
  ear.listensCancelled = repeats;
  const route = backup.history.find((entry: { result: { kind: string } }) => entry.result.kind === 'route').result;
  const events = Array.from({ length: repeats }, (_, index) => [
    { type: 'pause', atMs: index * 3 + 1, reason: 'manual' }, { type: 'resume', atMs: index * 3 + 3, reason: null },
  ]).flat();
  route.asOfMs = repeats * 3 + 1;
  route.events = [{ type: 'start', atMs: 0, reason: null }, ...events, { type: 'stop', atMs: route.asOfMs, reason: null }];
  route.stepIndex = 0;
  route.actualStepMs = [repeats + 1, 0, 0];
  return JSON.stringify(backup);
}

function checkpointRead(count: number) {
  const store = createMemoryStudyStore();
  const base = parseBackup(literal).practiceDrafts[0];
  if (base.material.kind !== 'rhythm' || !base.material.playback.project) throw new Error('Нужен сохранённый проект ритма.');
  const { playback } = base.material;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localDate = originalLocalDate(base.createdAt, timeZone);
  const drafts: PracticeDraft[] = Array.from({ length: count }, (_, index) => ({ ...base, id: `draft-${index}`, timeZone, localDate,
    material: { kind: 'rhythm', playback: { ...playback, project: { ...playback.project!, name: `Проект ${index}` } } } }));
  const manager = createPracticeDrafts({ getStore: () => store, write: operation => operation(), onCommit() {}, onEntry() {}, now: () => new Date(base.createdAt) });
  manager.reload(drafts);
  let durationMs = 0;
  const draft = drafts[drafts.length - 1];
  manager.bind({ context: null, routeRef: null, material: draft.material, label: 'Ритм-секция', readClock: () => ({ durationMs, comfortableBpm: 117 }) });
  return () => { durationMs++; manager.capture(); manager.hasPendingChanges(); };
}

test('одинаковые снимки схемы 10', async ({ bench }) => {
  const small = backupWithJournals(8);
  const accumulated = backupWithJournals(1024);
  const options = { time: 500, iterations: 20, warmupTime: 200 };
  for (const [name, run] of [
    ['import-short-journals', () => { parseBackup(small); }],
    ['import-long-journals', () => { parseBackup(accumulated); }],
    ['capture-one-draft', checkpointRead(1)],
    ['capture-300-drafts', checkpointRead(300)],
  ] as const) {
    await bench(name, { writeResult: `test-results/storage-scale/${name}.json` }, run).run(options);
  }
}, 30000);
