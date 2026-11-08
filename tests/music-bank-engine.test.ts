import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAlphaTab, musicBankAssets } from '../src/music-bank/engine';

afterEach(() => vi.unstubAllGlobals());

describe('локальные ресурсы раздела «Табулатура и ноты»', () => {
  it('получает native ESM, шрифт и SoundFont с текущего origin', () => {
    vi.stubGlobal('document', { baseURI: 'http://localhost:4173/' });
    expect(musicBankAssets('/')).toEqual({
      moduleUrl: 'http://localhost:4173/vendor/music-bank/alphaTab.js',
      fontDirectory: 'http://localhost:4173/vendor/music-bank/font/',
      soundFont: 'http://localhost:4173/vendor/music-bank/soundfont/sonivox.sf2',
    });
  });
  it('сохраняет базу подпапки, включая относительный BASE_URL', () => {
    vi.stubGlobal('document', { baseURI: 'https://local.example/practice/index.html' });
    const assets = musicBankAssets('./');
    expect(assets.moduleUrl).toBe('https://local.example/practice/vendor/music-bank/alphaTab.js');
    expect(assets.fontDirectory).toBe('https://local.example/practice/vendor/music-bank/font/');
    expect(assets.soundFont).toBe('https://local.example/practice/vendor/music-bank/soundfont/sonivox.sf2');
    expect(musicBankAssets('/practice')).toEqual(assets);
    expect(Object.isFrozen(assets)).toBe(true);
  });
  it('не подменяет испорченную базу молчаливым внешним адресом', () => {
    vi.stubGlobal('document', { baseURI: 'http://localhost:4173/' });
    expect(() => musicBankAssets('http://[broken')).toThrow('Не удалось определить адрес ресурсов раздела «Табулатура и ноты».');
  });
  it('делит одновременную загрузку и разрешает новую попытку после отказа', async () => {
    const base = 'file:///__bass_study_missing_music_bank__/';
    const first = loadAlphaTab(base), simultaneous = loadAlphaTab(base);
    expect(simultaneous).toBe(first);
    await expect(first).rejects.toThrow('Не удалось загрузить проигрыватель раздела «Табулатура и ноты». Повторите попытку.');
    const retry = loadAlphaTab(base);
    expect(retry).not.toBe(first);
    await expect(retry).rejects.toThrow('Не удалось загрузить проигрыватель раздела «Табулатура и ноты». Повторите попытку.');
  });
});
