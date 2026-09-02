// Import zones: the target package layering as lint errors.
//
//   app (components, hooks, App, workers)
//     -> engine (src/lib/eval plus the reconstruction libs)
//       -> replay core (src/types, src/lib/ids, src/lib/calc-field, ...)
//
// The ratchet next to this file is generated; this file is maintained by
// hand. A new engine-to-core edge means adding the core module's name to
// CORE_FROM_EVAL; a new app module never becomes importable from src/lib.

const UI_LAYER = '(^|/)(hooks|components|workers|App|main)(/|$)';
const CORE_FROM_EVAL = '(\\.\\./types|ids|calc-field)$';
const ENGINE_MESSAGE =
  'The engine imports only replay-core modules (types, ids, calc-field) from outside src/lib/eval.';

const zone = (files, regex, message) => ({
  files,
  rules: { 'no-restricted-imports': ['error', { patterns: [{ regex, message }] }] },
});

export const importZones = [
  zone(['src/lib/**/*.{ts,tsx}', 'src/types/**/*.ts'], UI_LAYER,
    'Library code must not import the UI layer (hooks, components, App, workers).'),
  zone(['src/lib/eval/*.ts'], `^\\.\\./(?!${CORE_FROM_EVAL})`, ENGINE_MESSAGE),
  zone(['src/lib/eval/*/*.ts'], `^\\.\\./\\.\\./(?!${CORE_FROM_EVAL})`, ENGINE_MESSAGE),
  zone(['src/components/**/*.{ts,tsx}'], '(^|/)(lib/branch|hooks/branch|hooks/controller|hooks/evaluation)(/|$)',
    'Components use the facades (branch-engine, useBranch, useEvaluation, useAppController), not their internals.'),
];
