// Import zones: the package layering as lint errors.
//
//   app (src: components, hooks, App, workers, the lazy facades)
//     -> @fulllifegames/eval-engine (packages/eval-engine)
//       -> @fulllifegames/replay-core (packages/replay-core)
//
// The ratchet next to this file is generated; this file is maintained by
// hand. Packages import each other by name; nothing in a package reaches
// src/; the app imports the packages by name, never their files.

const UI_LAYER = '(^|/)(hooks|components|workers|App|main)(/|$)';
const OUT_OF_PACKAGE = '^(\\.\\./)+(src|packages)/';

const zone = (files, regex, message) => ({
  files,
  rules: { 'no-restricted-imports': ['error', { patterns: [{ regex, message }] }] },
});

export const importZones = [
  zone(['packages/*/src/**/*.ts'], `${UI_LAYER}|${OUT_OF_PACKAGE}`,
    'Packages import each other by name and never reach src/ or the UI layer.'),
  zone(['packages/replay-core/src/**/*.ts'], '^@fulllifegames/eval-engine',
    'replay-core sits below the engine.'),
  zone(['src/**/*.{ts,tsx}'], '^(\\.\\./)+packages/',
    'The app imports the packages by name (@fulllifegames/replay-core, @fulllifegames/eval-engine), never their files.'),
  zone(['src/lib/**/*.{ts,tsx}'], UI_LAYER,
    'Library code must not import the UI layer (hooks, components, App, workers).'),
  zone(['src/components/**/*.{ts,tsx}'], '(^|/)(hooks/branch|hooks/controller|hooks/evaluation)(/|$)',
    'Components use the facades (useBranch, useEvaluation, useAppController), not their internals.'),
];
