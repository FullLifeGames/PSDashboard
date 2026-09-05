// GENERATED FILE - regenerate with `node scripts/update-lint-ratchet.mjs`.
//
// Size and complexity ceilings. `ratchetBase` holds the target values every
// file should meet. `ratchetOverrides` is the refactor worklist: each entry
// pins a legacy file at its current measured worst, so the file can only
// shrink. Refactor a file below its pin, rerun the script, and the pin
// tightens or disappears. The script refuses to raise a pin.

export const ratchetBase = [
  {
    "files": [
      "src/**/*.{ts,tsx}",
      "packages/*/src/**/*.ts"
    ],
    "rules": {
      "max-lines": [
        "error",
        {
          "max": 300,
          "skipBlankLines": true,
          "skipComments": true
        }
      ],
      "max-lines-per-function": [
        "error",
        {
          "max": 60,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ],
      "complexity": [
        "error",
        15
      ]
    }
  },
  {
    "files": [
      "regression/**/*.ts",
      "e2e/**/*.ts",
      "e2e-feedback/**/*.ts",
      "packages/*/test/**/*.ts"
    ],
    "rules": {
      "max-lines": [
        "error",
        {
          "max": 600,
          "skipBlankLines": true,
          "skipComments": true
        }
      ],
      "max-lines-per-function": [
        "error",
        {
          "max": 300,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ],
      "complexity": [
        "error",
        20
      ]
    }
  }
];

export const ratchetOverrides = [
  {
    "files": [
      "e2e-feedback/claims.ts"
    ],
    "rules": {
      "complexity": [
        "error",
        30
      ]
    }
  },
  {
    "files": [
      "e2e/app.spec.ts"
    ],
    "rules": {
      "max-lines": [
        "error",
        {
          "max": 1300,
          "skipBlankLines": true,
          "skipComments": true
        }
      ],
      "max-lines-per-function": [
        "error",
        {
          "max": 1100,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ]
    }
  },
  {
    "files": [
      "packages/eval-engine/test/doubles-branch.spec.ts"
    ],
    "rules": {
      "max-lines": [
        "error",
        {
          "max": 700,
          "skipBlankLines": true,
          "skipComments": true
        }
      ]
    }
  },
  {
    "files": [
      "packages/eval-engine/test/eval-analysis.spec.ts"
    ],
    "rules": {
      "max-lines": [
        "error",
        {
          "max": 1280,
          "skipBlankLines": true,
          "skipComments": true
        }
      ],
      "max-lines-per-function": [
        "error",
        {
          "max": 470,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ]
    }
  },
  {
    "files": [
      "packages/eval-engine/test/eval-function.spec.ts"
    ],
    "rules": {
      "max-lines": [
        "error",
        {
          "max": 930,
          "skipBlankLines": true,
          "skipComments": true
        }
      ],
      "max-lines-per-function": [
        "error",
        {
          "max": 470,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ]
    }
  },
  {
    "files": [
      "packages/eval-engine/test/eval-search.spec.ts"
    ],
    "rules": {
      "max-lines": [
        "error",
        {
          "max": 760,
          "skipBlankLines": true,
          "skipComments": true
        }
      ]
    }
  },
  {
    "files": [
      "packages/eval-engine/test/eval-summary.spec.ts"
    ],
    "rules": {
      "max-lines": [
        "error",
        {
          "max": 890,
          "skipBlankLines": true,
          "skipComments": true
        }
      ],
      "max-lines-per-function": [
        "error",
        {
          "max": 400,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ]
    }
  },
  {
    "files": [
      "packages/eval-engine/test/reconstruction.spec.ts"
    ],
    "rules": {
      "max-lines-per-function": [
        "error",
        {
          "max": 380,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ]
    }
  },
  {
    "files": [
      "packages/eval-engine/test/team-builder.spec.ts"
    ],
    "rules": {
      "max-lines-per-function": [
        "error",
        {
          "max": 330,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ]
    }
  },
  {
    "files": [
      "packages/replay-core/test/stats-panel-quality.spec.ts"
    ],
    "rules": {
      "max-lines-per-function": [
        "error",
        {
          "max": 380,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ]
    }
  },
  {
    "files": [
      "regression/eval-calibration.spec.ts"
    ],
    "rules": {
      "complexity": [
        "error",
        55
      ]
    }
  },
  {
    "files": [
      "regression/eval-fit.spec.ts"
    ],
    "rules": {
      "complexity": [
        "error",
        32
      ]
    }
  }
];
