import { runTracksBrowserChecks } from './helpers/tracks-browser-harness.mjs';
import { browserCases } from './helpers/browser-case.mjs';
import { pcmChecks } from './rhythm/browser-pcm.mjs';
import { controlsChecks } from './rhythm/browser-controls.mjs';
import { projectsChecks } from './rhythm/browser-projects.mjs';
import { layoutChecks } from './rhythm/browser-layout.mjs';
import { nativeChecks } from './rhythm/browser-native.mjs';

const checks = [...pcmChecks, ...controlsChecks, ...projectsChecks, ...layoutChecks, ...nativeChecks];
const selection = browserCases(checks);
await runTracksBrowserChecks(selection.checks, {
  scope: 'Product rhythm in Edge: VIS-05 r2 controls and layout, isolated offline PCM, live signal, native visibility, schema 10 migration and restore.',
  reportFile: selection.filtered ? 'p10-rhythm-case-edge.json' : 'p10-rhythm-edge.json',
});
