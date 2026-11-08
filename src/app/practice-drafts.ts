import type { HistoryMetadata, PracticeDraft, DrainDraftRequest, RouteRef } from '../storage';
import type { QuestionContext } from '../training';
import type { PracticeMaterial } from '../training/results';

export interface PracticeBinding {
  readonly context: QuestionContext;
  readonly material: PracticeMaterial;
  readonly routeRef: RouteRef | null;
  readonly label: string;
  readonly readClock: () => { durationMs: number; comfortableBpm: number; runtimeContextKey?: string };
}
interface DraftStore {
  upsertPracticeDraft(value: PracticeDraft): Promise<PracticeDraft>;
  deletePracticeDraft(id: string): Promise<unknown>;
  drainDraft(value: DrainDraftRequest): Promise<{ entry: import('../storage').ManualHistoryEntry; draft: PracticeDraft }>;
}
interface Options {
  readonly getStore: () => DraftStore;
  readonly write: <T>(operation: () => Promise<T>, key: string) => Promise<T>;
  readonly supersede?: (key: string) => unknown;
  readonly resolveSuperseded?: (key: string) => void;
  readonly onCommit: (draft: PracticeDraft) => void;
  readonly onEntry: (entry: import('../storage').ManualHistoryEntry) => void;
  readonly onChange?: () => void;
  readonly now?: () => Date;
}

const clone = <T>(value: T): T => structuredClone(value);
const localDay = (now: Date, timeZone: string) => new Intl.DateTimeFormat('sv-SE', { timeZone }).format(now);
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable((value as Record<string, unknown>)[key])]));
  return value;
}
const keyOf = (context: QuestionContext, material: PracticeMaterial, routeRef: RouteRef | null, day: string) => JSON.stringify(stable({ context: { ...context, positionIds: [...context.positionIds].sort() }, material, routeRef, day }));

/** Owns durable, ungraded practice. Audio clocks remain owned by the players. */
export function createPracticeDrafts(options: Options) {
  const records = new Map<string, PracticeDraft>();
  const committed = new Map<string, string>();
  const clocks = new Map<string, number>();
  const saves = new Map<string, DrainDraftRequest>();
  const retired = new Set<string>();
  let binding: PracticeBinding | null = null;
  let currentId: string | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  let disposed = false;
  const now = () => options.now?.() ?? new Date();
  const notify = () => { try { options.onChange?.(); } catch (error) { console.error('Не удалось обновить представление черновика.', error); } };
  const publish = (draft: PracticeDraft) => { try { options.onCommit(draft); } catch (error) { console.error('Черновик записан, но представление не обновилось.', error); } };

  function remember(value: PracticeDraft) {
    const current = records.get(value.id);
    if (!current) records.set(value.id, clone(value));
    else records.set(value.id, { ...clone(value), totalReferenceMs: Math.max(value.totalReferenceMs, current.totalReferenceMs), recordedThroughMs: Math.max(value.recordedThroughMs, current.recordedThroughMs),
      ...(current.editRevision > value.editRevision || current.editRevision === value.editRevision && current.recordedThroughMs > value.recordedThroughMs
        ? { note: current.note, comfortableBpm: current.comfortableBpm, editRevision: current.editRevision } : {}) });
  }

  function capture(force = false): PracticeDraft | null {
    if (disposed || !binding || !binding.context.positionIds.length) return null;
    const clock = binding.readClock();
    const runtime = clock.runtimeContextKey ?? binding.material.kind;
    const elapsed = Math.max(0, Math.round(clock.durationMs));
    const previous = clocks.get(runtime) ?? 0;
    const delta = Math.max(0, elapsed - previous);
    clocks.set(runtime, elapsed);
    const date = now(); const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const day = localDay(date, timeZone);
    const key = keyOf(binding.context, binding.material, binding.routeRef, day);
    let draft = [...records.values()].find(value => !retired.has(value.id) && keyOf(value.context, value.material, value.routeRef, value.localDate) === key);
    if (!draft && !force && !delta) { currentId = null; return null; }
    if (!draft) {
      draft = { id: `draft-${crypto.randomUUID()}`, createdAt: date.toISOString(), updatedAt: date.toISOString(), timeZone, localDate: day,
        context: clone(binding.context), material: clone(binding.material), routeRef: clone(binding.routeRef), totalReferenceMs: 0, recordedThroughMs: 0,
        suggestedBpm: clock.comfortableBpm, comfortableBpm: clock.comfortableBpm, note: '', editRevision: 0 };
    }
    if (delta) draft = { ...draft, totalReferenceMs: draft.totalReferenceMs + delta, suggestedBpm: clock.comfortableBpm, updatedAt: date.toISOString() };
    records.set(draft.id, draft); currentId = draft.id;
    return clone(draft);
  }

  async function persist(draft: PracticeDraft) {
    if (retired.has(draft.id)) return;
    const revision = generation; const value = clone(draft); const signature = JSON.stringify(value);
    if (committed.get(value.id) === signature) return;
    await options.write(async () => {
      if (disposed || revision !== generation || retired.has(value.id)) return;
      const saved = await options.getStore().upsertPracticeDraft(value);
      if (disposed || revision !== generation) return;
      committed.set(value.id, JSON.stringify(saved)); remember(saved); publish(saved);
    }, `draft:${value.id}`);
  }

  async function flush() {
    capture();
    if (debounce) { clearTimeout(debounce); debounce = null; }
    for (const draft of [...records.values()]) await persist(draft);
  }

  function edit(id: string | null, note: string, comfortableBpm: number) {
    const draft = id ? records.get(id) : capture(true);
    if (!draft) throw new Error('Выбери доступный материал для ручной практики.');
    if (retired.has(draft.id)) throw new Error('Этот черновик ожидает удаления. При ошибке повтори удаление.');
    if (!Number.isInteger(comfortableBpm) || comfortableBpm < 40 || comfortableBpm > 220) throw new RangeError('Укажи комфортный темп от 40 до 220 BPM.');
    if (note.length > 2000) throw new RangeError('Заметка должна содержать не больше 2000 символов.');
    const updated = { ...draft, note, comfortableBpm, editRevision: draft.editRevision + 1, updatedAt: now().toISOString() };
    records.set(updated.id, updated);
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => { debounce = null; void flush().catch(() => {}); }, 300);
    notify(); return clone(updated);
  }

  async function save(id: string, note: string, comfortableBpm: number) {
    capture();
    const current = records.get(id); if (!current) throw new Error('Черновик больше не существует.');
    if (retired.has(id)) throw new Error('Этот черновик ожидает удаления.');
    if (current.note !== note || current.comfortableBpm !== comfortableBpm) edit(id, note, comfortableBpm);
    await flush();
    const draft = records.get(id)!;
    let request = saves.get(id);
    if (!request) {
      request = { draftId: id, historyId: `manual-${crypto.randomUUID()}`, expectedRecordedThroughMs: draft.recordedThroughMs,
        throughMs: draft.totalReferenceMs, editRevision: draft.editRevision, comfortableBpm, note,
        occurredAt: draft.createdAt, timeZone: draft.timeZone };
      saves.set(id, request);
    }
    const captured = request; const revision = generation;
    return options.write(async () => {
      if (disposed || revision !== generation || retired.has(id)) throw new Error('Данные изменились; открой черновик заново.');
      const result = await options.getStore().drainDraft(captured);
      if (revision === generation && !disposed) {
        remember(result.draft); committed.set(result.draft.id, JSON.stringify(result.draft)); saves.delete(id);
        publish(result.draft);
        try { options.onEntry(result.entry); } catch (error) { console.error('Результат записан, но представление не обновилось.', error); }
        notify();
      }
      return result;
    }, `draft-save:${captured.historyId}`);
  }

  return {
    capture,
    bind(next: PracticeBinding | null) { capture(); binding = next; currentId = null; capture(); },
    current(force = false) { return capture(force); },
    get(id: string) { const value = records.get(id); return value ? clone(value) : null; },
    hasPendingChanges() { return [...records.values()].some(value => !retired.has(value.id) && committed.get(value.id) !== JSON.stringify(value)); },
    all() { return [...records.values()].filter(value => value.totalReferenceMs > value.recordedThroughMs || value.note.trim()).map(clone); },
    edit, save, flush,
    async remove(id: string) {
      capture(); const revision = generation; const key = `draft:${id}`;
      const pendingSave = saves.get(id); const saveKey = pendingSave ? `draft-save:${pendingSave.historyId}` : null;
      retired.add(id); options.supersede?.(key);
      if (saveKey) options.supersede?.(saveKey);
      await options.write(async () => {
        if (disposed || revision !== generation) return;
        await options.getStore().deletePracticeDraft(id);
        if (revision === generation && !disposed) { records.delete(id); committed.delete(id); saves.delete(id); retired.delete(id); if (saveKey) options.resolveSuperseded?.(saveKey); if (currentId === id) currentId = null; notify(); }
      }, key);
    },
    reload(values: readonly PracticeDraft[]) { generation++; binding = null; records.clear(); committed.clear(); clocks.clear(); saves.clear(); retired.clear(); currentId = null; if (debounce) { clearTimeout(debounce); debounce = null; } for (const draft of values) { records.set(draft.id, clone(draft)); committed.set(draft.id, JSON.stringify(draft)); } notify(); },
    dispose() { disposed = true; generation++; if (debounce) clearTimeout(debounce); records.clear(); binding = null; },
  };
}

export function practiceDraftMetadata(draft: PracticeDraft): HistoryMetadata { return { id: draft.id, occurredAt: draft.createdAt, timeZone: draft.timeZone }; }
