import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../src/ui/html';

describe('escapeHtml', () => {
  it('экранирует пять символов разметки и сохраняет остальной текст', () => {
    expect(escapeHtml(`<b class="x">Tom & 'Jerry'</b>`)).toBe('&lt;b class=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/b&gt;');
    expect(escapeHtml('A ♭3 · лады 0–12')).toBe('A ♭3 · лады 0–12');
    expect(escapeHtml('')).toBe('');
  });

  it('не экранирует повторно уже готовую сущность как разметку', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('принимает числа', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(-0.5)).toBe('-0.5');
  });

  it('безопасен в атрибуте в двойных и одинарных кавычках', () => {
    const hostile = `"><img src=x onerror="alert(1)">' onfocus='alert(2)`;
    const attribute = `<button data-name="${escapeHtml(hostile)}" aria-label='${escapeHtml(hostile)}'>`;
    expect(attribute).not.toMatch(/<img/);
    expect(attribute.match(/"/g)).toHaveLength(2);
    expect(attribute.match(/'/g)).toHaveLength(2);
    expect(attribute).toContain('&quot;&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39; onfocus=&#39;alert(2)');
  });
});
