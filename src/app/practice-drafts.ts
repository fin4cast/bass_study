import type { HistoryMetadata, PracticeDraft, DrainDraftRequest, RouteRef } from '../storage';
import type { QuestionContext } from '../training';
import { manualTempoBounds, type PracticeMaterial } from '../training/results';

export interface PracticeBinding {
  readonly context: QuestionContext | null;
  readonly material: PracticeMaterial;
  readonly routeRef: RouteRef | null;
  readonly label: string;
  readonly readClock: () => { durationMs: number; comfortableBpm: number; runtimeContextKey?: string };
}
interface DraftStore {
  upsertPracticeDraft(value: PracticeDraft): Promise<PracticeDraft>;
  deletePracticeDraft(id: string): Promise<unknown>;
  drainDraft(value: DrainDraftRequest): Promise<import('../storage').HistoryCommit<import('../storage').ManualHistoryEntry> & { draft: PracticeDraft }>;
}
interface Options {
  readonly getStore: () => DraftStore;
  readonly write: <T>(operation: () => Promise<T>, key: string) => Promise<T>;
  readonly supersede?: (key: string) => unknown;
  readonly resolveSuperseded?: (key: string) => void;
  readonly onCommit: (draft: PracticeDraft) => void;
  readonly onEntry: (entry: import('../storage').ManualHistoryEntry, linkedRoute?: import('../storage').HistoryCommit['linkedRoute']) => void;
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
const materialKey = ({ context, material, routeRef }: Pick<PracticeBinding, 'context' | 'material' | 'routeRef'>) =>
  JSON.stringify(stable({ context: context && { ...context, positionIds: [...context.positionIds].sort() }, material, routeRef }));

/** Owns durable, ungraded practice. Audio clocks remain owned by the players. */
export function createPracticeDrafts(options: Options) {
  const records = new Map<string, PracticeDraft>();
  const byMaterialDay = new Map<string, Set<string>>();
  const keysById = new Map<string, string>();
  const bindingKeys = new WeakMap<PracticeBinding, string>();
  const dirty = new Set<string>();
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

  function index(id: string, key: string) {
    let matches = byMaterialDay.get(key);
    if (!matches) { matches = new Set(); byMaterialDay.set(key, matches); }
    matches.add(id);
    keysById.set(id, key);
  }

  function unindex(id: string) {
    const key = keysById.get(id);
    if (key === undefined) return;
    const matches = byMaterialDay.get(key)!;
    matches.delete(id);
    if (matches.size === 0) byMaterialDay.delete(key);
    keysById.delete(id);
  }

  function rememberCommit(value: PracticeDraft, written: PracticeDraft | undefined, previouslyDirty = false) {
    const current = records.get(value.id);
    if (retired.has(value.id) || !current) return;
    if (current === written && !previouslyDirty) {
      records.set(value.id, value);
      dirty.delete(value.id);
      return;
    }
    // The record object is the local revision. Keep input or time accrued while the write was in flight.
    records.set(value.id, { ...value, totalReferenceMs: Math.max(value.totalReferenceMs, current.totalReferenceMs),
      recordedThroughMs: Math.max(value.recordedThroughMs, current.recordedThroughMs), suggestedBpm: current.suggestedBpm, updatedAt: current.updatedAt,
      ...(current.editRevision > value.editRevision ? { note: current.note, comfortableBpm: current.comfortableBpm, editRevision: current.editRevision } : {}) });
  }

  function capture(force = false, source = binding): PracticeDraft | null {
    if (disposed || !source || (source.material.kind !== 'rhythm' && !source.context?.positionIds.length)) return null;
    const clock = source.readClock();
    const runtime = clock.runtimeContextKey ?? source.material.kind;
    const elapsed = Math.max(0, Math.round(clock.durationMs));
    const previous = clocks.get(runtime) ?? 0;
    const delta = Math.max(0, elapsed - previous);
    // Reading the live rhythm clock can synchronously capture the end of the same epoch.
    clocks.set(runtime, source.material.kind === 'rhythm' ? Math.max(previous, elapsed) : elapsed);
    const date = now(); const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const day = localDay(date, timeZone);
    let material = bindingKeys.get(source);
    if (material === undefined) { material = materialKey(source); bindingKeys.set(source, material); }
    const key = `${day}:${material}`;
    const id = byMaterialDay.get(key)?.values().next().value;
    let draft = id === undefined ? undefined : records.get(id);
    if (!draft && !force && !delta) { if (source === binding) currentId = null; return null; }
    if (!draft) {
      draft = { id: `draft-${crypto.randomUUID()}`, createdAt: date.toISOString(), updatedAt: date.toISOString(), timeZone, localDate: day,
        context: clone(source.context), material: clone(source.material), routeRef: clone(source.routeRef), totalReferenceMs: 0, recordedThroughMs: 0,
        suggestedBpm: clock.comfortableBpm, comfortableBpm: clock.comfortableBpm, note: '', editRevision: 0 };
      index(draft.id, key);
      dirty.add(draft.id);
    }
    if (delta) {
      draft = { ...draft, totalReferenceMs: draft.totalReferenceMs + delta, suggestedBpm: clock.comfortableBpm, updatedAt: date.toISOString() };
      dirty.add(draft.id);
    }
    records.set(draft.id, draft);
    if (source === binding) currentId = draft.id;
    return draft;
  }

  async function persist(id: string) {
    if (!dirty.has(id) || retired.has(id)) return;
    const revision = generation;
    await options.write(async () => {
      if (disposed || revision !== generation || retired.has(id) || !dirty.has(id)) return;
      const value = records.get(id)!;
      const saved = await options.getStore().upsertPracticeDraft(value);
      if (disposed || revision !== generation) return;
      rememberCommit(saved, value);
      publish(saved);
    }, `draft:${id}`);
  }

  async function flush() {
    capture();
    if (debounce) { clearTimeout(debounce); debounce = null; }
    const outcomes = await Promise.allSettled([...dirty].map(persist));
    const failure = outcomes.find(outcome => outcome.status === 'rejected');
    if (failure) throw failure.reason;
  }

  function edit(id: string | null, note: string, comfortableBpm: number) {
    const draft = id ? records.get(id) : capture(true);
    if (!draft) throw new Error('Выбери доступный материал для ручной практики.');
    if (retired.has(draft.id)) throw new Error('Этот черновик ожидает удаления. При ошибке повтори удаление.');
    const [minBpm, maxBpm] = manualTempoBounds(draft.material);
    if (!Number.isInteger(comfortableBpm) || comfortableBpm < minBpm || comfortableBpm > maxBpm) throw new RangeError(`Укажи комфортный темп от ${minBpm} до ${maxBpm} BPM.`);
    if (note.length > 2000) throw new RangeError('Заметка должна содержать не больше 2000 символов.');
    const updated = { ...draft, note, comfortableBpm, editRevision: draft.editRevision + 1, updatedAt: now().toISOString() };
    records.set(updated.id, updated);
    dirty.add(updated.id);
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => { debounce = null; void flush().catch(() => {}); }, 300);
    notify(); return clone(updated);
  }

  async function save(id: string, note: string, comfortableBpm: number) {
    capture();
    const current = records.get(id); if (!current) throw new Error('Черновик больше не существует.');
    if (retired.has(id)) throw new Error('Этот черновик ожидает удаления.');
    if (current.note !== note || current.comfortableBpm !== comfortableBpm) edit(id, note, comfortableBpm);
    const draft = records.get(id)!;
    let request = saves.get(id);
    if (!request) {
      request = { draftId: id, historyId: `manual-${crypto.randomUUID()}`, expectedRecordedThroughMs: draft.recordedThroughMs,
        throughMs: draft.totalReferenceMs, editRevision: draft.editRevision, comfortableBpm, note,
        occurredAt: draft.createdAt, timeZone: draft.timeZone };
      saves.set(id, request);
    }
    const captured = request; const revision = generation;
    await persist(id);
    return options.write(async () => {
      if (disposed || revision !== generation || retired.has(id)) throw new Error('Данные изменились; открой черновик заново.');
      const beforeDrain = records.get(id);
      const previouslyDirty = dirty.has(id);
      const result = await options.getStore().drainDraft(captured);
      if (revision === generation && !disposed) {
        rememberCommit(result.draft, beforeDrain, previouslyDirty);
        if (saves.get(id) === captured) saves.delete(id);
        publish(result.draft);
        try { options.onEntry(result.entry, result.linkedRoute); } catch (error) { console.error('Результат записан, но представление не обновилось.', error); }
        notify();
      }
      return result;
    }, `draft-save:${captured.historyId}`);
  }

  return {
    capture(force = false) { return clone(capture(force)); },
    captureClosed(source: PracticeBinding) { capture(false, source); },
    bind(next: PracticeBinding | null) { capture(); binding = next; currentId = null; capture(); },
    current(force = false) { return clone(capture(force)); },
    peek() { return clone(currentId === null || retired.has(currentId) ? null : records.get(currentId) ?? null); },
    get(id: string) { const value = records.get(id); return value ? clone(value) : null; },
    hasPendingChanges() { return dirty.size > 0; },
    all() { return [...records.values()].filter(value => value.totalReferenceMs > value.recordedThroughMs || value.note.trim()).map(clone); },
    edit, save, flush,
    async remove(id: string) {
      capture(); const revision = generation; const key = `draft:${id}`;
      const pendingSave = saves.get(id); const saveKey = pendingSave ? `draft-save:${pendingSave.historyId}` : null;
      retired.add(id); unindex(id); dirty.delete(id); options.supersede?.(key);
      if (saveKey) options.supersede?.(saveKey);
      await options.write(async () => {
        if (disposed || revision !== generation) return;
        await options.getStore().deletePracticeDraft(id);
        if (revision === generation && !disposed) { records.delete(id); saves.delete(id); retired.delete(id); if (saveKey) options.resolveSuperseded?.(saveKey); if (currentId === id) currentId = null; notify(); }
      }, key);
    },
    reload(values: readonly PracticeDraft[]) {
      generation++; binding = null; records.clear(); byMaterialDay.clear(); keysById.clear(); dirty.clear(); clocks.clear(); saves.clear(); retired.clear(); currentId = null;
      if (debounce) { clearTimeout(debounce); debounce = null; }
      for (const draft of values) { records.set(draft.id, clone(draft)); index(draft.id, `${draft.localDate}:${materialKey(draft)}`); }
      notify();
    },
    dispose() { disposed = true; generation++; if (debounce) clearTimeout(debounce); records.clear(); byMaterialDay.clear(); keysById.clear(); dirty.clear(); clocks.clear(); saves.clear(); retired.clear(); binding = null; },
  };
}

export function practiceDraftMetadata(draft: PracticeDraft): HistoryMetadata { return { id: draft.id, occurredAt: draft.createdAt, timeZone: draft.timeZone }; }
