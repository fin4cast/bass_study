import { afterEach, describe, expect, it, vi } from 'vitest';
import { createThemeController, isThemePreference, parseThemeCache, resolveTheme, THEME_CACHE_KEY } from '../src/app/theme';

afterEach(() => { vi.unstubAllGlobals(); });

describe('подтверждённая подсказка темы', () => {
  it('разрешает системную тему без изменения выбранного предпочтения', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
  it('читает только известную версию и ровно два ожидаемых поля', () => {
    for (const preference of ['light', 'dark', 'system'] as const) expect(parseThemeCache(JSON.stringify({ version: 1, preference }))).toBe(preference);
    for (const value of [null, '', '{', '[]', 'null', '"dark"', '{"version":2,"preference":"dark"}', '{"version":1,"preference":"sepia"}', '{"version":1,"preference":"dark","profile":{}}']) expect(parseThemeCache(value)).toBeNull();
    expect(isThemePreference(undefined)).toBe(false);
    expect(isThemePreference({ preference: 'dark' })).toBe(false);
  });
  it('меняет только оформление до явного подтверждения постоянной записи', () => {
    const root = { dataset: { themePreference: 'system', theme: 'light' }, style: { colorScheme: '' } };
    const listeners = new Set<() => void>();
    const media = { matches: false, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) };
    const meta = { content: '' }, picker = { value: '' };
    const setItem = vi.fn(), onChange = vi.fn();
    vi.stubGlobal('document', { documentElement: root, querySelector: (selector: string) => selector.startsWith('meta') ? meta : picker });
    vi.stubGlobal('window', { matchMedia: () => media });
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => root.dataset.theme === 'dark' ? '#151d19' : '#f5f3ec' }));
    vi.stubGlobal('localStorage', { setItem });
    const theme = createThemeController({ onChange });
    theme.setPreference('dark');
    expect(root.dataset.theme).toBe('dark'); expect(picker.value).toBe('dark');
    expect(meta.content).toBe('#151d19'); expect(onChange).toHaveBeenCalledWith('dark');
    expect(setItem).not.toHaveBeenCalled();
    theme.confirmPreference('dark');
    expect(setItem).toHaveBeenCalledWith(THEME_CACHE_KEY, '{"version":1,"preference":"dark"}');
    theme.setPreference('light', { notify: false });
    media.matches = true; listeners.forEach(listener => listener());
    expect(theme.getResolvedTheme()).toBe('light'); expect(root.dataset.theme).toBe('light');
    theme.setPreference('system');
    expect(root.dataset.theme).toBe('dark');
    media.matches = false; listeners.forEach(listener => listener());
    expect(root.dataset.theme).toBe('light');
    expect(onChange.mock.calls).toEqual([['dark'], ['system']]);
    theme.dispose(); expect(listeners.size).toBe(0);
  });
});
