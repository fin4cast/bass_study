/** Узкая граница локального alphaTab: native ESM, worker и SoundFont из поставки. */
export type AlphaTabModule = typeof import('@coderline/alphatab');

export interface MusicBankAssets {
  readonly moduleUrl: string;
  readonly fontDirectory: string;
  readonly soundFont: string;
}

/** baseUrl — база приложения Vite, включая размещение в подпапке. */
export function musicBankAssets(baseUrl = import.meta.env.BASE_URL): MusicBankAssets {
  const documentUrl = typeof document !== 'undefined' ? document.baseURI : typeof location !== 'undefined' ? location.href : undefined;
  let base: URL;
  try {
    base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`, documentUrl);
  } catch (cause) {
    throw new Error('Не удалось определить адрес ресурсов раздела «Табулатура и ноты».', { cause });
  }
  return Object.freeze({
    moduleUrl: new URL('vendor/music-bank/alphaTab.js', base).href,
    fontDirectory: new URL('vendor/music-bank/font/', base).href,
    soundFont: new URL('vendor/music-bank/soundfont/sonivox.sf2', base).href,
  });
}

const loading = new Map<string, Promise<AlphaTabModule>>();

/** Одновременные обращения разделяют загрузку; отказ не оставляет rejected promise. */
export function loadAlphaTab(baseUrl = import.meta.env.BASE_URL): Promise<AlphaTabModule> {
  const { moduleUrl } = musicBankAssets(baseUrl);
  const existing = loading.get(moduleUrl);
  if (existing) return existing;
  const attempt = import(/* @vite-ignore */ moduleUrl)
    .then(module => module as AlphaTabModule)
    .catch((cause: unknown) => {
      if (loading.get(moduleUrl) === attempt) loading.delete(moduleUrl);
      throw new Error('Не удалось загрузить проигрыватель раздела «Табулатура и ноты». Повторите попытку.', { cause });
    });
  loading.set(moduleUrl, attempt);
  return attempt;
}
