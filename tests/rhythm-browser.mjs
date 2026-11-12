import { runTracksBrowserChecks } from './helpers/tracks-browser-harness.mjs';
import { browserCases, markFullOnly, FULL_ONLY } from './helpers/browser-case.mjs';
import { pcmChecks } from './rhythm/browser-pcm.mjs';
import { controlsChecks } from './rhythm/browser-controls.mjs';
import { projectsChecks } from './rhythm/browser-projects.mjs';
import { layoutChecks } from './rhythm/browser-layout.mjs';
import { nativeChecks } from './rhythm/browser-native.mjs';

const checks = [...pcmChecks, ...controlsChecks, ...projectsChecks, ...layoutChecks, ...nativeChecks];
markFullOnly(checks, ['native-real-hidden-tab-pauses-until-explicit-resume'], FULL_ONLY.hiddenTab);
markFullOnly(checks, ['product-layout-keeps-transport-and-local-grid-in-two-themes-at-six-more-viewports'], FULL_ONLY.viewports);
markFullOnly(checks, [
  'live-overlay-pause-keeps-a-future-click-inside-the-current-groove-step',
  'live-fractional-count-in-pause-resumes-tail-and-remaining-interval',
  'live-step-edit-and-tempo-edit-use-different-boundaries-and-seal-practice',
  'live-product-pause-owner-switch-and-explicit-resume',
], FULL_ONLY.liveAudio);
markFullOnly(checks, [
  'native-p12-rhythm-retry-commits-project-while-profile-write-still-fails',
  'native-p12-restore-and-retry-are-exclusive-and-post-commit-hydration-requires-reload',
  'native-current-database-saves-fretboard-sequence-draft-and-rhythmless-preset-keeps-projects',
  'native-project-restore-validates-chain-and-rolls-back-after-project-and-selection-put',
], FULL_ONLY.separateProcess);
markFullOnly(checks, [
  'product-mixer-commits-on-pointer-release-and-persists-sounding-epochs',
  'product-count-in-is-independent-and-applies-only-on-fresh-start',
  'leaving-section-cancels-audition-waiting-for-audio-context',
  'product-amplifier-dials-faders-and-playhead-use-real-rhythm-state',
  'manual-note-keeps-rhythm-material-and-time-after-changing-project',
  'product-step-accents-use-project-owned-channel-defaults',
  'product-layout-keeps-local-grid-and-chain-scrollable-in-narrow-view',
  'product-photo-panel-uses-local-images-and-keeps-shared-controls-compact',
  'product-photo-panel-keeps-controls-and-inline-settings-in-narrow-view',
], FULL_ONLY.smoke);
const selection = browserCases(checks);
await runTracksBrowserChecks(selection.checks, {
  scope: 'Product rhythm in Edge: VIS-05 r2 controls and layout, isolated offline PCM, live signal, native visibility, schema 11 storage and restore.',
  reportFile: selection.filtered ? 'p10-rhythm-case-edge.json' : 'p10-rhythm-edge.json',
});
