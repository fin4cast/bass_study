import { DEFAULT_PREFERENCES, validatePreferences, type AppPreferences } from '../storage';

export function createPreferences() {
  let value = DEFAULT_PREFERENCES;
  return {
    get value() { return value; },
    hydrate(snapshot: AppPreferences, source: 'preset' | 'restore') {
      const checked = validatePreferences(snapshot);
      value = source === 'preset' && checked.rhythm === null ? { ...checked, rhythm: value.rhythm } : checked;
      return checked;
    },
    update(patch: Partial<AppPreferences>) {
      const next = validatePreferences({ ...value, ...patch });
      if (JSON.stringify(next) === JSON.stringify(value)) return false;
      value = next;
      return true;
    },
  };
}
