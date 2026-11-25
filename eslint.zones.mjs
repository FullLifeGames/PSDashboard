// Maintained by hand; the ratchet next to this file is generated.

const UI_LAYER = '(^|/)(hooks|components|workers|App|main)(/|$)';
const OUT_OF_PACKAGE = '^(\\.\\./)+(src|packages)/';
const OUT_OF_TEST_DIR = '^(\\.\\./){2,}';

const zone = (files, regex, message) => ({
  files,
  rules: { 'no-restricted-imports': ['error', { patterns: [{ regex, message }] }] },
});

export const importZones = [
  zone(['packages/*/src/**/*.ts'], `${UI_LAYER}|${OUT_OF_PACKAGE}`,
    'Packages import each other by name and never reach src/ or the UI layer.'),
  zone(['packages/replay-core/src/**/*.ts'], '^@fulllifegames/eval-engine',
    'replay-core sits below the engine.'),
  // Replaces the package zone for this file, so it repeats the zone's pattern: typescript-eslint knows `import type`.
  {
    files: ['packages/eval-engine/src/branch/execute.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: [
        { regex: `${UI_LAYER}|${OUT_OF_PACKAGE}`, message: 'Packages import each other by name and never reach src/ or the UI layer.' },
        { regex: '^@pkmn/|(^|/)dice/', allowTypeImports: true,
          message: 'execute.ts loads the simulator and the dice module as types or with a dynamic import, so a turn without a forced die never pays for them.' },
      ] }],
    },
  },
  zone(['packages/*/test/**/*.ts'], OUT_OF_TEST_DIR,
    'Package tests import their own sources relatively (../src/...) and the sibling package by name; nothing outside the package.'),
  zone(['packages/replay-core/test/**/*.ts'], '^@fulllifegames/eval-engine',
    'replay-core sits below the engine.'),
  zone(['src/**/*.{ts,tsx}'], '^(\\.\\./)+packages/',
    'The app imports the packages by name (@fulllifegames/replay-core, @fulllifegames/eval-engine), never their files.'),
  {
    ...zone(['test/regression/**/*.ts'], '^(\\.\\./)+packages/',
      'Root specs import the packages by name (@fulllifegames/replay-core, @fulllifegames/eval-engine); only the measurement chains read package internals.'),
    ignores: ['test/regression/eval-calibration.spec.ts', 'test/regression/eval-fit.spec.ts', 'test/regression/endgame-truth.spec.ts',
      'test/regression/eval-sim-fast-setting.spec.ts', 'test/regression/forced-reconstruction.spec.ts',
      'test/regression/forced-reconstruction-support.ts', 'test/regression/bank-reconstruction-rows.spec.ts',
      'test/regression/rolled-copy.spec.ts', 'test/regression/branch-required-choices-copy.spec.ts'],
  },
  zone(['test/ui/**/*.{ts,tsx}'], '^(\\.\\./)+packages/',
    'The app suite imports components, hooks, and src/lib directly and the packages by name, never their files.'),
  zone(['src/lib/**/*.{ts,tsx}'], UI_LAYER,
    'Library code must not import the UI layer (hooks, components, App, workers).'),
  zone(['src/components/**/*.{ts,tsx}'], '(^|/)(hooks/branch|hooks/controller|hooks/evaluation)(/|$)',
    'Components use the facades (useBranch, useEvaluation, useAppController), not their internals.'),
];
