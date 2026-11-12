import { describe, expect, it } from 'vitest';
import { transportKeyIntent, type TransportKeyContext, type TransportKeyInput } from '../src/ui/transport-shortcut';

const key = (value: string, patch: Partial<TransportKeyInput> = {}): TransportKeyInput => ({
  key: value, code: value === ' ' ? 'Space' : value, repeat: false, modified: false, defaultPrevented: false, ...patch,
});
const at = (patch: Partial<TransportKeyContext> = {}): TransportKeyContext => ({ blocked: false, focus: 'none', ...patch });

describe('единые клавиши транспорта (P14-01)', () => {
  it('пробел вне элементов управления переключает играть / пауза / продолжить', () => {
    expect(transportKeyIntent(key(' '), at())).toBe('toggle');
    expect(transportKeyIntent(key('Unidentified', { code: 'Space' }), at())).toBe('toggle');
  });

  it('Esc возвращает к началу и на собственной кнопке раздела', () => {
    expect(transportKeyIntent(key('Escape'), at())).toBe('restart');
    expect(transportKeyIntent(key('Escape'), at({ focus: 'own-button' }))).toBe('restart');
  });

  it('пробел на кнопке нажимает её саму, а не транспорт', () => {
    expect(transportKeyIntent(key(' '), at({ focus: 'own-button' }))).toBeNull();
  });

  it('поля, раскрытые меню и ползунки оставляют клавиши себе', () => {
    expect(transportKeyIntent(key(' '), at({ focus: 'control' }))).toBeNull();
    expect(transportKeyIntent(key('Escape'), at({ focus: 'control' }))).toBeNull();
  });

  it('прокручиваемая область сохраняет пробел для прокрутки, но Esc работает', () => {
    expect(transportKeyIntent(key(' '), at({ keepSpace: true }))).toBeNull();
    expect(transportKeyIntent(key('Escape'), at({ keepSpace: true }))).toBe('restart');
  });

  it('скрытый раздел, диалог, повтор, модификаторы и обработанное событие не трогают транспорт', () => {
    for (const value of [' ', 'Escape']) {
      expect(transportKeyIntent(key(value), at({ blocked: true }))).toBeNull();
      expect(transportKeyIntent(key(value, { repeat: true }), at())).toBeNull();
      expect(transportKeyIntent(key(value, { modified: true }), at())).toBeNull();
      expect(transportKeyIntent(key(value, { defaultPrevented: true }), at())).toBeNull();
    }
  });

  it('другие клавиши не являются клавишами транспорта', () => {
    for (const value of ['Enter', 'k', 'ArrowLeft', 'Digit1']) expect(transportKeyIntent(key(value), at())).toBeNull();
  });
});
