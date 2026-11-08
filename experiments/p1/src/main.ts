import { createAudioProbe } from './audio';
import { createStorageProbe, SAMPLE_SNAPSHOT } from './storage';

const audio = createAudioProbe();
const storage = createStorageProbe();
const probe = {
  audio,
  storage,
  fixture: SAMPLE_SNAPSHOT,
  nextAudioConfig: { bpm: 180, countInBeats: 2, loopBeats: 4 },
  lastAction: { name: '', done: true, error: null as string | null },
  ready: true,
};
Object.assign(window, { p1: probe });

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
function bind(id: string, action: () => unknown | Promise<unknown>, status: string) {
  element(id).addEventListener('click', async () => {
    probe.lastAction = { name: id, done: false, error: null };
    try {
      const result = await action();
      element(status).textContent = typeof result === 'string' ? result : JSON.stringify(result ?? 'OK');
    } catch (error) {
      probe.lastAction.error = error instanceof Error ? error.message : String(error);
      element(status).textContent = probe.lastAction.error;
    } finally { probe.lastAction.done = true; }
  });
}

bind('start', () => audio.start(probe.nextAudioConfig), 'audio-status');
bind('pause', () => audio.pause(), 'audio-status');
bind('resume', () => audio.resume(), 'audio-status');
bind('stop', () => audio.stop(), 'audio-status');
bind('tempo', () => audio.setBpm(Number(element<HTMLInputElement>('bpm').value)), 'audio-status');
bind('seed', () => storage.seed(), 'storage-status');
bind('export', async () => {
  element<HTMLTextAreaElement>('backup').value = await storage.exportBackup();
  return 'Копия синтетических данных готова';
}, 'storage-status');
bind('preview', () => {
  const preview = storage.previewImport(element<HTMLTextAreaElement>('backup').value);
  return { presets: preview.presets, history: preview.history, replacement: preview.replacement };
}, 'storage-status');
bind('restore', () => storage.restore(element<HTMLTextAreaElement>('backup').value, {
  confirmed: element<HTMLInputElement>('confirm').checked,
}), 'storage-status');

function frame() {
  element('diagnostics').textContent = JSON.stringify(audio.getSnapshot(), null, 2);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.addEventListener('pagehide', () => { audio.dispose(); storage.close(); });

const style = document.createElement('style');
style.textContent = `
  :root{font:16px/1.5 system-ui,sans-serif;color:#172238;background:#f2f4f8}
  body{margin:0} main{max-width:1000px;margin:24px auto;padding:0 24px}
  section,details{background:white;border:1px solid #cad1dd;border-radius:10px;padding:18px;margin:18px 0}
  h1{font-size:1.7rem} h2{font-size:1.2rem;margin-top:0}
  button,input,textarea{font:inherit} button{margin:4px;padding:8px 14px;cursor:pointer}
  label{display:inline-block;margin:8px}textarea{display:block;max-width:100%}
  output{display:block;overflow-wrap:anywhere;margin-top:10px}pre{max-height:350px;overflow:auto;font-size:12px}
  :focus-visible{outline:3px solid #2d64dd;outline-offset:2px}
`;
document.head.append(style);
