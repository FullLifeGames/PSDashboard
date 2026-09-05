import { test, expect, describe } from 'vitest';
import { coverageNotice, needsSettingsUpgrade, recordEvalError, resolveAutoTurnSettings, serializedFaintedFraction, supersedesStored, verificationDeepSettings, withEvalGapNotice } from '../src/hooks/useEvaluation';
import { AUTO_MCTS_FAINTED_FRACTION } from '../packages/eval-engine/src/types';

describe('coverage notice (acquisition pass)', () => {
  // The notice describes the RECONSTRUCTION pass — one fast replay of the
  // game that hands out every turn's position, settling seconds after
  // "Analyze game" while the evaluations still stream. Its wording must
  // not claim analysis that has not happened yet ("67 of 68 turns could
  // be analyzed" seconds after the click read as fake), and a missing
  // FINAL turn only — the draft replay, whose simulated line reaches the
  // game's end one turn early — must not be dressed as scary mid-game
  // divergence with set-correction advice that does not apply.
  const pos = (bits: (0 | 1)[]) => bits.map((bit, index) => (bit ? `p${index + 1}` : null));

  test('full coverage stays silent', () => {
    expect(coverageNotice(pos([1, 1, 1, 1]))).toBeNull();
    expect(coverageNotice([])).toBeNull();
  });

  test('nothing reconstructed names the guessed sets', () => {
    expect(coverageNotice(pos([0, 0, 0]))).toContain('could not be reconstructed');
  });

  test('a missing final turn only is the mild ended-early story', () => {
    const notice = coverageNotice(pos([1, 1, 1, 1, 0]))!;
    expect(notice).toContain('one turn early');
    expect(notice).toContain('rest of the line is unaffected');
    expect(notice).not.toContain('Edit Player/Opp');
  });

  test('mid-game gaps are divergence with reconstruction counts', () => {
    const notice = coverageNotice(pos([1, 1, 0, 1, 1, 1]))!;
    expect(notice).toContain('5 of 6 turns could be reconstructed');
    expect(notice).toContain('Edit Player/Opp');
  });

  test('a long trailing run is divergence, not the mild story', () => {
    const notice = coverageNotice(pos([1, 1, 1, 0, 0, 0, 0]))!;
    expect(notice).toContain('3 of 7 turns could be reconstructed');
  });
});

describe('eval-gap visibility helpers', () => {
  test('recordEvalError keeps the reason only while the turn is scoreless', () => {
    const evalErrors: (string | null)[] = [null, null, null];
    const scores: (number | null)[] = [null, 0.4, null];
    recordEvalError(evalErrors, scores, 1, new Error('p1 "move return102": rejected'));
    expect(evalErrors[0]).toBe('p1 "move return102": rejected');
    // A scored turn never records — the earlier pass's number stands.
    recordEvalError(evalErrors, scores, 2, new Error('later pass failed'));
    expect(evalErrors[1]).toBeNull();
    // Non-Error throws stringify.
    recordEvalError(evalErrors, scores, 3, 'worker died');
    expect(evalErrors[2]).toBe('worker died');
  });

  test('withEvalGapNotice combines acquisition and eval-layer stories', () => {
    expect(withEvalGapNotice(null, [null, null])).toBeNull();
    expect(withEvalGapNotice('short line.', [null, null])).toBe('short line.');
    expect(withEvalGapNotice(null, ['boom', null, 'later']))
      .toBe('2 turns had a live position but could not be evaluated (first error: "boom").');
    expect(withEvalGapNotice(null, [null, 'single']))
      .toBe('1 turn had a live position but could not be evaluated (first error: "single").');
    expect(withEvalGapNotice('The reconstruction diverged: 3 of 5.', ['boom']))
      .toBe('The reconstruction diverged: 3 of 5. 1 turn had a live position but could not be evaluated (first error: "boom").');
  });
});

describe('settings upgrade decision (merged flow)', () => {
  const prefs = { depth: 2, samples: 3, mode: 'matrix', auto: false, tera: 'auto' } as const;
  test('shallower stored settings upgrade; deeper never downgrade', () => {
    expect(needsSettingsUpgrade(null, prefs)).toBe(true);
    expect(needsSettingsUpgrade({ depth: 1, samples: 1, mode: 'matrix' }, prefs)).toBe(true);
    expect(needsSettingsUpgrade({ depth: 2, samples: 1, mode: 'matrix' }, prefs)).toBe(true);
    expect(needsSettingsUpgrade({ depth: 2, samples: 3, mode: 'matrix' }, prefs)).toBe(false);
    // Deeper/heavier stored results stay shown under lighter prefs.
    expect(needsSettingsUpgrade({ depth: 2, samples: 5, mode: 'matrix' }, prefs)).toBe(false);
    expect(needsSettingsUpgrade({ depth: 2, samples: 3, mode: 'matrix' }, { ...prefs, depth: 1, samples: 1 })).toBe(false);
    // Engine-mode mismatch always re-runs — the fast pass is matrix even
    // for MCTS users, so their selected turns must still get MCTS.
    expect(needsSettingsUpgrade({ depth: 1, samples: 1, mode: 'matrix' }, { ...prefs, mode: 'mcts' })).toBe(true);
    expect(needsSettingsUpgrade({ depth: 2, samples: 1, mode: 'mcts' }, { ...prefs, mode: 'mcts' })).toBe(false);
  });
});

describe('graph merge monotonicity', () => {
  test('a shallower pass never overwrites deeper stored data', () => {
    // The re-analyze fast pass (d1s1) used to clobber a deepened turn's
    // graph entry until the key-turn pass restored some of them.
    expect(supersedesStored({ depth: 2, samples: 3, mode: 'matrix' }, { depth: 1, samples: 1, mode: 'matrix' }, 'matrix')).toBe(false);
    expect(supersedesStored({ depth: 1, samples: 1, mode: 'matrix' }, { depth: 2, samples: 3, mode: 'matrix' }, 'matrix')).toBe(true);
    expect(supersedesStored(null, { depth: 1, samples: 1, mode: 'matrix' }, 'matrix')).toBe(true);
    // Equal settings refresh in place.
    expect(supersedesStored({ depth: 2, samples: 3, mode: 'matrix' }, { depth: 2, samples: 3, mode: 'matrix' }, 'matrix')).toBe(true);
    // Both dimensions must hold — deeper but fewer samples is not a superset.
    expect(supersedesStored({ depth: 2, samples: 5, mode: 'matrix' }, { depth: 3, samples: 3, mode: 'matrix' }, 'matrix')).toBe(false);
    expect(supersedesStored({ depth: 2, samples: 5, mode: 'matrix' }, { depth: 3, samples: 5, mode: 'matrix' }, 'matrix')).toBe(true);
  });
  test('cross-mode results replace only toward the configured mode', () => {
    // MCTS prefs: the matrix fast pass must not clobber stored MCTS turns…
    expect(supersedesStored({ depth: 2, samples: 1, mode: 'mcts' }, { depth: 1, samples: 1, mode: 'matrix' }, 'mcts')).toBe(false);
    // …but a user who SWITCHED to matrix gets matrix results again.
    expect(supersedesStored({ depth: 2, samples: 1, mode: 'mcts' }, { depth: 1, samples: 1, mode: 'matrix' }, 'matrix')).toBe(true);
    // A d1 matrix leftover is NOT an escalation — the configured MCTS wins.
    expect(supersedesStored({ depth: 1, samples: 1, mode: 'matrix' }, { depth: 1, samples: 1, mode: 'mcts' }, 'mcts')).toBe(true);
    // Same-mode MCTS has no depth ordering — it refreshes.
    expect(supersedesStored({ depth: 1, samples: 1, mode: 'mcts' }, { depth: 1, samples: 1, mode: 'mcts' }, 'mcts')).toBe(true);
  });
  test('an explicit matrix escalation survives an MCTS-target sweep', () => {
    // Think-deeper's cross-engine product (matrix depth ≥ 2) outranks the
    // d1s1-grade MCTS tier — the next sweep must not trample it, whether
    // MCTS is the target via explicit prefs or the auto routing.
    expect(supersedesStored({ depth: 2, samples: 3, mode: 'matrix' }, { depth: 1, samples: 1, mode: 'mcts' }, 'mcts')).toBe(false);
    expect(supersedesStored({ depth: 3, samples: 3, mode: 'matrix' }, { depth: 1, samples: 1, mode: 'mcts' }, 'mcts')).toBe(false);
    expect(supersedesStored({ depth: 2, samples: 3, mode: 'matrix' }, { depth: 1, samples: 1, mode: 'mcts' }, 'auto', 0.5)).toBe(false);
  });
  test('an explicit matrix escalation LANDS on an MCTS-target turn', () => {
    // The other direction of the same rule — the think-deeper click itself.
    // Its d2s3 matrix pass must supersede the stored d1s1-grade MCTS result
    // even though matrix is not the turn's configured engine; without this
    // the sweep skips the turn and the button silently does nothing.
    expect(supersedesStored({ depth: 1, samples: 1, mode: 'mcts' }, { depth: 2, samples: 3, mode: 'matrix' }, 'auto', 0.5)).toBe(true);
    expect(supersedesStored({ depth: 1, samples: 1, mode: 'mcts' }, { depth: 2, samples: 3, mode: 'matrix' }, 'mcts')).toBe(true);
    expect(supersedesStored({ depth: 1, samples: 1, mode: 'mcts' }, { depth: 3, samples: 3, mode: 'matrix' }, 'auto', 1)).toBe(true);
    // The fast matrix sketch (d1) is NOT an escalation — routing still wins.
    expect(supersedesStored({ depth: 1, samples: 1, mode: 'mcts' }, { depth: 1, samples: 1, mode: 'matrix' }, 'auto', 0.5)).toBe(false);
  });
});

describe('auto mode resolution', () => {
  test('auto is the pinned d1s1 line: matrix below the threshold, MCTS at or above', () => {
    expect(resolveAutoTurnSettings(0)).toEqual({ depth: 1, samples: 1, mode: 'matrix' });
    expect(resolveAutoTurnSettings(AUTO_MCTS_FAINTED_FRACTION - 0.001)).toEqual({ depth: 1, samples: 1, mode: 'matrix' });
    expect(resolveAutoTurnSettings(AUTO_MCTS_FAINTED_FRACTION)).toEqual({ depth: 1, samples: 1, mode: 'mcts' });
    expect(resolveAutoTurnSettings(1)).toEqual({ depth: 1, samples: 1, mode: 'mcts' });
  });

  test('serializedFaintedFraction mirrors the engine definition', () => {
    const battle = JSON.stringify({
      sides: [
        { pokemon: [{ hp: 100 }, { hp: 0 }, { hp: 12, fainted: false }] },
        { pokemon: [{ hp: 50, fainted: true }, { hp: 88 }, { hp: 44 }] },
      ],
    });
    expect(serializedFaintedFraction(battle)).toBeCloseTo(2 / 6, 10);
    expect(serializedFaintedFraction(JSON.stringify({ sides: [] }))).toBe(0);
  });

  test('supersedes resolves auto per turn: the fast sketch never downgrades a resolved-MCTS turn', () => {
    const mctsStored = { depth: 1, samples: 1, mode: 'mcts' } as const;
    const fastIncoming = { depth: 1, samples: 1, mode: 'matrix' } as const;
    // Late turn (fraction at/above the threshold): auto's target is MCTS — keep it.
    expect(supersedesStored(mctsStored, fastIncoming, 'auto', 0.5)).toBe(false);
    // Early turn: auto's target is matrix — the sketch may replace the stale engine.
    expect(supersedesStored(mctsStored, fastIncoming, 'auto', 0.1)).toBe(true);
    // Unknown fraction: cross-mode conflicts fail closed (keep stored).
    expect(supersedesStored(mctsStored, fastIncoming, 'auto', null)).toBe(false);
    // Same-mode comparisons never need the fraction.
    expect(supersedesStored({ depth: 2, samples: 3, mode: 'matrix' }, fastIncoming, 'auto', null)).toBe(false);
    expect(supersedesStored(fastIncoming, { depth: 2, samples: 3, mode: 'matrix' }, 'auto', null)).toBe(true);
  });

  test('needsSettingsUpgrade under auto prefs follows the turn resolution', () => {
    const prefs = { depth: 2, samples: 3, mode: 'auto', auto: false, tera: 'auto' } as const;
    // Early turn already holding the pinned d1s1 matrix: settled (depth
    // prefs apply to the explicit matrix modes, not to auto).
    expect(needsSettingsUpgrade({ depth: 1, samples: 1, mode: 'matrix' }, prefs, 0.1)).toBe(false);
    // Late turn still holding matrix: the auto target is MCTS — upgrade.
    expect(needsSettingsUpgrade({ depth: 1, samples: 1, mode: 'matrix' }, prefs, 0.5)).toBe(true);
    // Late turn holding MCTS: settled.
    expect(needsSettingsUpgrade({ depth: 1, samples: 1, mode: 'mcts' }, prefs, 0.5)).toBe(false);
    // Unknown fraction: conservative for stored turns; gaps always analyze.
    expect(needsSettingsUpgrade({ depth: 1, samples: 1, mode: 'matrix' }, prefs, null)).toBe(false);
    expect(needsSettingsUpgrade(null, prefs, null)).toBe(true);
    // A think-deeper'd early turn (deeper matrix) never downgrades under auto.
    expect(needsSettingsUpgrade({ depth: 2, samples: 3, mode: 'matrix' }, prefs, 0.1)).toBe(false);
    // A think-deeper'd LATE turn (matrix depth ≥ 2 above the MCTS tier)
    // is settled too — no badge claims it needs the line engine back.
    expect(needsSettingsUpgrade({ depth: 2, samples: 3, mode: 'matrix' }, prefs, 0.5)).toBe(false);
    expect(needsSettingsUpgrade({ depth: 2, samples: 3, mode: 'matrix' }, { ...prefs, mode: 'mcts' })).toBe(false);
  });
});

describe('verification deep tier', () => {
  test('flags adjudicate one depth up in matrix pair space, from any line engine', () => {
    // Matrix lines rise one depth; the engine cap (3) ends the ladder.
    expect(verificationDeepSettings({ depth: 1, samples: 1, mode: 'matrix' }))
      .toMatchObject({ depth: 2, samples: 1, mode: 'matrix' });
    expect(verificationDeepSettings({ depth: 2, samples: 3, mode: 'matrix' }))
      .toMatchObject({ depth: 3, samples: 3, mode: 'matrix' });
    expect(verificationDeepSettings({ depth: 3, samples: 3, mode: 'matrix' })).toBeNull();
    // MCTS lines verify at the SAME matrix tier the d1 line gets — the
    // verdict statistic (bestDeep − playedDeep) is deep-tier-internal, so
    // the engine that raised the flag is irrelevant.
    expect(verificationDeepSettings({ depth: 1, samples: 1, mode: 'mcts' }))
      .toMatchObject({ depth: 2, samples: 1, mode: 'matrix' });
    expect(verificationDeepSettings({ depth: 2, samples: 3, mode: 'mcts' }))
      .toMatchObject({ depth: 2, samples: 3, mode: 'matrix' });
    // Context rides along; the played-pair restriction never does.
    const deep = verificationDeepSettings({ depth: 1, samples: 1, mode: 'mcts', tera: false, keepPlayed: { p1Slots: ['move tackle'] } as never });
    expect(deep?.tera).toBe(false);
    expect(deep?.keepPlayed).toBeUndefined();
  });
});
import { computeBlunders, selectKeyTurns, BLUNDER_SWING, KEY_TURN_SWING } from '../packages/eval-engine/src/graph';
import { KEY_MOMENT_SWING } from '../packages/eval-engine/src/report';

describe('key-turn coverage matches the report', () => {
  test('every report-worthy swing gets the deepening pass', () => {
    // GPL finding: the report named T14/T36 (+15% ≈ 0.29–0.34 swings) while
    // selectKeyTurns still used the 0.4 blunder threshold — the whole
    // deepening pass skipped the replay and the chips carried d1 badges
    // under MCTS prefs. One constant now feeds both.
    expect(KEY_MOMENT_SWING).toBe(KEY_TURN_SWING);
    expect(selectKeyTurns([-0.16, -0.25, 0.1])).toEqual([2, 3]);
    // Below the report threshold stays on the fast scan.
    expect(selectKeyTurns([0.0, 0.2, 0.1])).toEqual([]);
  });
});

describe('eval graph blunder detection', () => {
  test('flags the turn whose play created the swing, not the turn after', () => {
    const scores = [0.1, 0.15, -0.3, -0.25, 0.4];
    // The -0.45 swing shows between the turn-2 and turn-3 points — it was
    // PLAYED on turn 2 (scores[t-1] is the start of turn t); same for the
    // +0.65 swing played on turn 4. The marker must match the turn whose
    // analysis explains the swing.
    expect(computeBlunders(scores)).toEqual([2, 4]);
  });

  test('ignores gaps and small drifts', () => {
    const scores = [0.0, null, 0.1, 0.15, null, null, 0.2];
    // null gaps break the comparison chain; drifts stay under the threshold.
    expect(computeBlunders(scores)).toEqual([]);
  });

  test('a swing across a gap is not attributed', () => {
    const scores = [0.5, null, -0.5];
    // Two turns passed — the swing cannot be pinned on one decision.
    expect(computeBlunders(scores)).toEqual([]);
  });

  test('threshold is exported and sane', () => {
    expect(BLUNDER_SWING).toBeGreaterThan(0.1);
    expect(BLUNDER_SWING).toBeLessThan(0.5);
  });

  test('key turns cover both sides of every big swing', () => {
    const scores = [0.1, 0.15, -0.3, -0.25, 0.4];
    // Swings land on turns 3 and 5 — deepen the causing turn and the turn after.
    expect(selectKeyTurns(scores)).toEqual([2, 3, 4, 5]);
  });

  test('key turns respect the cap, biggest swings first', () => {
    const scores = [0, 0.3, 0, 0.4, 0, 0.5, 0];
    // Every step is a swing; a cap of 2 keeps only the biggest pair (0.5).
    expect(selectKeyTurns(scores, 2)).toEqual([5, 6]);
  });

  test('a quiet game needs no deepening', () => {
    expect(selectKeyTurns([0.1, 0.12, 0.15, 0.11])).toEqual([]);
  });
});
