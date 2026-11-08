import '../theme.css';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';
export const THEME_CACHE_KEY = 'bass-study-theme-v1';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  return preference === 'system' ? systemDark ? 'dark' : 'light' : preference;
}

/** This is a startup hint only. The validated IndexedDB profile takes precedence. */
export function parseThemeCache(raw: string | null): ThemePreference | null {
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const cache = value as Record<string, unknown>;
    return Object.keys(cache).length === 2 && cache.version === 1 && isThemePreference(cache.preference) ? cache.preference : null;
  } catch { return null; }
}

export interface ThemeOptions {
  readonly initialPreference?: ThemePreference;
  readonly onChange?: (preference: ThemePreference) => void;
}

/** Changes presentation only; the coordinator owns profile writes and confirms commits. */
export function createThemeController(options: ThemeOptions = {}) {
  const root = document.documentElement;
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = options.initialPreference ?? (isThemePreference(root.dataset.themePreference) ? root.dataset.themePreference : 'system');
  let disposed = false;

  function apply() {
    if (disposed) return;
    const resolved = resolveTheme(preference, system.matches);
    root.dataset.themePreference = preference;
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(root).getPropertyValue('--surface-canvas').trim();
    const picker = document.querySelector<HTMLSelectElement>('#theme-preference');
    if (picker) picker.value = preference;
  }
  const systemChanged = () => { if (preference === 'system') apply(); };
  system.addEventListener('change', systemChanged);
  apply();
  return {
    getPreference: () => preference,
    getResolvedTheme: () => resolveTheme(preference, system.matches),
    setPreference(value: ThemePreference, settings: { notify?: boolean } = {}) {
      if (!isThemePreference(value)) throw new RangeError('Неизвестная тема оформления.');
      if (disposed) return;
      const changed = preference !== value;
      preference = value; apply();
      if (changed && settings.notify !== false) options.onChange?.(preference);
    },
    /** Call only after a persistent commit; a failed mirror write cannot fail that commit. */
    confirmPreference(value: ThemePreference) {
      if (!isThemePreference(value)) throw new RangeError('Неизвестная тема оформления.');
      try { localStorage.setItem(THEME_CACHE_KEY, JSON.stringify({ version: 1, preference: value })); return true; }
      catch { return false; }
    },
    dispose() { disposed = true; system.removeEventListener('change', systemChanged); },
  };
}
