import type { RouteSessionLink } from '../route';
import type { HistoryEntry, RouteHistoryEntry } from './model';

export interface HistoryCommit<T extends HistoryEntry = HistoryEntry> {
  readonly entry: T;
  readonly linkedRoute?: RouteHistoryEntry;
}

export function isRouteEntry(entry: HistoryEntry): entry is RouteHistoryEntry {
  return entry.result.kind === 'route';
}

function setLink<T>(groups: Map<string, Map<string, T>>, routeId: string, id: string, value: T) {
  let group = groups.get(routeId);
  if (!group) groups.set(routeId, group = new Map());
  group.set(id, value);
}

function removeLink<T>(groups: Map<string, Map<string, T>>, routeId: string, id: string) {
  const group = groups.get(routeId);
  if (group?.delete(id) && group.size === 0) groups.delete(routeId);
}

function withLinks<T extends RouteHistoryEntry>(route: T, links: readonly RouteSessionLink[]): T {
  return Object.freeze({ ...route, result: Object.freeze({ ...route.result, sessionLinks: Object.freeze(links) }) });
}

/** Plans changes from confirmed history. Apply to the index only after commit. */
export function createHistoryLinks(entries: readonly HistoryEntry[]) {
  const indexed = new Map<string, HistoryEntry>();
  const routes = new Map<string, Map<string, RouteHistoryEntry>>();
  const children = new Map<string, Map<string, RouteSessionLink>>();

  function remove(id: string) {
    const previous = indexed.get(id);
    if (!previous) return;
    if (isRouteEntry(previous)) removeLink(routes, previous.result.id, id);
    else if (previous.routeRef) removeLink(children, previous.routeRef.routeId, id);
    indexed.delete(id);
  }

  function remember(entry: HistoryEntry) {
    remove(entry.id);
    if (isRouteEntry(entry)) {
      setLink(routes, entry.result.id, entry.id, entry);
    } else if (entry.routeRef) {
      const link = Object.freeze({ id: entry.id, kind: entry.result.kind, step: entry.routeRef.step });
      setLink(children, entry.routeRef.routeId, entry.id, link);
    } else return;
    indexed.set(entry.id, entry);
  }

  entries.forEach(remember);
  return {
    remember,
    remove,
    plan<T extends HistoryEntry>(entry: T): HistoryCommit<T> {
      if (isRouteEntry(entry)) {
        const parents = routes.get(entry.result.id);
        const previous = parents?.get(entry.id);
        const links = new Map<string, RouteSessionLink>();
        for (const link of previous?.result.sessionLinks ?? []) links.set(link.id, link);
        for (const link of entry.result.sessionLinks) if (!links.has(link.id)) links.set(link.id, link);
        // Imported history can contain two route envelopes for one domain ID.
        if (!parents || parents.size === 1 && previous) {
          for (const link of children.get(entry.result.id)?.values() ?? []) links.set(link.id, link);
        }
        return { entry: withLinks(entry, [...links.values()]) };
      }
      if (!entry.routeRef) return { entry };
      const parents = routes.get(entry.routeRef.routeId);
      if (parents?.size !== 1) return { entry };
      const parent = parents.values().next().value!;
      if (parent.id === entry.id) return { entry };
      const link = Object.freeze({ id: entry.id, kind: entry.result.kind, step: entry.routeRef.step });
      const previous = parent.result.sessionLinks.find(item => item.id === link.id);
      if (previous?.kind === link.kind && previous.step === link.step) return { entry };
      const links = previous ? parent.result.sessionLinks.map(item => item.id === link.id ? link : item) : [...parent.result.sessionLinks, link];
      return { entry, linkedRoute: withLinks(parent, links) };
    },
  };
}
