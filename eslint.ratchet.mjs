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
      "src/**/*.{ts,tsx}"
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
      "e2e-feedback/**/*.ts"
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
          "max": 1120,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ]
    }
  },
  {
    "files": [
      "regression/doubles-branch.spec.ts"
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
      "regression/eval-analysis.spec.ts"
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
      "regression/eval-calibration.spec.ts"
    ],
    "rules": {
      "complexity": [
        "error",
        62
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
  },
  {
    "files": [
      "regression/eval-function.spec.ts"
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
      "regression/eval-search.spec.ts"
    ],
    "rules": {
      "max-lines": [
        "error",
        {
          "max": 900,
          "skipBlankLines": true,
          "skipComments": true
        }
      ]
    }
  },
  {
    "files": [
      "regression/eval-summary.spec.ts"
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
      "regression/reconstruction.spec.ts"
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
      "regression/stats-panel-quality.spec.ts"
    ],
    "rules": {
      "max-lines-per-function": [
        "error",
        {
          "max": 390,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ]
    }
  },
  {
    "files": [
      "regression/team-builder.spec.ts"
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
      "src/lib/branch-choices.ts"
    ],
    "rules": {
      "complexity": [
        "error",
        18
      ]
    }
  },
  {
    "files": [
      "src/lib/choice-lock.ts"
    ],
    "rules": {
      "complexity": [
        "error",
        17
      ]
    }
  },
  {
    "files": [
      "src/lib/damage-calc.ts"
    ],
    "rules": {
      "max-lines-per-function": [
        "error",
        {
          "max": 70,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ],
      "complexity": [
        "error",
        22
      ]
    }
  },
  {
    "files": [
      "src/lib/eval/analysis.ts"
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
          "max": 350,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ],
      "complexity": [
        "error",
        178
      ]
    }
  },
  {
    "files": [
      "src/lib/eval/cell-blend.ts"
    ],
    "rules": {
      "complexity": [
        "error",
        33
      ]
    }
  },
  {
    "files": [
      "src/lib/eval/eval-function.ts"
    ],
    "rules": {
      "max-lines": [
        "error",
        {
          "max": 690,
          "skipBlankLines": true,
          "skipComments": true
        }
      ],
      "max-lines-per-function": [
        "error",
        {
          "max": 130,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ],
      "complexity": [
        "error",
        21
      ]
    }
  },
  {
    "files": [
      "src/lib/eval/forward-model.ts"
    ],
    "rules": {
      "max-lines": [
        "error",
        {
          "max": 450,
          "skipBlankLines": true,
          "skipComments": true
        }
      ],
      "max-lines-per-function": [
        "error",
        {
          "max": 90,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ],
      "complexity": [
        "error",
        56
      ]
    }
  },
  {
    "files": [
      "src/lib/eval/ko-odds.ts"
    ],
    "rules": {
      "complexity": [
        "error",
        40
      ]
    }
  },
  {
    "files": [
      "src/lib/eval/mcts-merge.ts"
    ],
    "rules": {
      "max-lines-per-function": [
        "error",
        {
          "max": 90,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ],
      "complexity": [
        "error",
        23
      ]
    }
  },
  {
    "files": [
      "src/lib/eval/mcts.ts"
    ],
    "rules": {
      "max-lines-per-function": [
        "error",
        {
          "max": 70,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ],
      "complexity": [
        "error",
        24
      ]
    }
  },
  {
    "files": [
      "src/lib/eval/null-moves.ts"
    ],
    "rules": {
      "complexity": [
        "error",
        33
      ]
    }
  },
  {
    "files": [
      "src/lib/eval/opponent-model.ts"
    ],
    "rules": {
      "complexity": [
        "error",
        18
      ]
    }
  },
  {
    "files": [
      "src/lib/eval/orchestrator.ts"
    ],
    "rules": {
      "max-lines-per-function": [
        "error",
        {
          "max": 130,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ],
      "complexity": [
        "error",
        29
      ]
    }
  },
  {
    "files": [
      "src/lib/eval/played.ts"
    ],
    "rules": {
      "complexity": [
        "error",
        38
      ]
    }
  },
  {
    "files": [
      "src/lib/eval/rank.ts"
    ],
    "rules": {
      "max-lines": [
        "error",
        {
          "max": 390,
          "skipBlankLines": true,
          "skipComments": true
        }
      ],
      "max-lines-per-function": [
        "error",
        {
          "max": 80,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ],
      "complexity": [
        "error",
        26
      ]
    }
  },
  {
    "files": [
      "src/lib/eval/report.ts"
    ],
    "rules": {
      "max-lines-per-function": [
        "error",
        {
          "max": 110,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ],
      "complexity": [
        "error",
        22
      ]
    }
  },
  {
    "files": [
      "src/lib/eval/search.ts"
    ],
    "rules": {
      "max-lines": [
        "error",
        {
          "max": 680,
          "skipBlankLines": true,
          "skipComments": true
        }
      ],
      "max-lines-per-function": [
        "error",
        {
          "max": 120,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ],
      "complexity": [
        "error",
        45
      ]
    }
  },
  {
    "files": [
      "src/lib/eval/speed.ts"
    ],
    "rules": {
      "complexity": [
        "error",
        24
      ]
    }
  },
  {
    "files": [
      "src/lib/eval/streaks.ts"
    ],
    "rules": {
      "complexity": [
        "error",
        34
      ]
    }
  },
  {
    "files": [
      "src/lib/eval/summary.ts"
    ],
    "rules": {
      "max-lines-per-function": [
        "error",
        {
          "max": 130,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ],
      "complexity": [
        "error",
        54
      ]
    }
  },
  {
    "files": [
      "src/lib/eval/tera.ts"
    ],
    "rules": {
      "complexity": [
        "error",
        16
      ]
    }
  },
  {
    "files": [
      "src/lib/eval/worker-client.ts"
    ],
    "rules": {
      "max-lines-per-function": [
        "error",
        {
          "max": 80,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ]
    }
  },
  {
    "files": [
      "src/lib/hax-alignment.ts"
    ],
    "rules": {
      "complexity": [
        "error",
        36
      ]
    }
  },
  {
    "files": [
      "src/lib/opponent-inferrer.ts"
    ],
    "rules": {
      "complexity": [
        "error",
        19
      ]
    }
  },
  {
    "files": [
      "src/lib/picker-state.ts"
    ],
    "rules": {
      "max-lines-per-function": [
        "error",
        {
          "max": 90,
          "skipBlankLines": true,
          "skipComments": true,
          "IIFEs": true
        }
      ]
    }
  },
  {
    "files": [
      "src/lib/set-coherence.ts"
    ],
    "rules": {
      "complexity": [
        "error",
        25
      ]
    }
  },
  {
    "files": [
      "src/lib/sets-io.ts"
    ],
    "rules": {
      "complexity": [
        "error",
        18
      ]
    }
  },
  {
    "files": [
      "src/lib/smogon-sets.ts"
    ],
    "rules": {
      "complexity": [
        "error",
        18
      ]
    }
  },
  {
    "files": [
      "src/lib/team-builder.ts"
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
      "src/lib/team-info.ts"
    ],
    "rules": {
      "complexity": [
        "error",
        41
      ]
    }
  }
];
