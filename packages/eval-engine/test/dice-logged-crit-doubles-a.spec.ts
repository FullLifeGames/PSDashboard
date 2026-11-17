import { afterAll, vi } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { CRIT_CASES, registerKindRows, writeSummaries } from './dice-logged-sweep-rows';

/**
 * D9b (#125): the crit rows of the logged sweep for Champions, Gen 8, Gen 5 and Gen 4 in doubles, a part of the former
 * `dice-logged-sweep.spec.ts` under the same titles (the other doubles rule sets are `dice-logged-crit-doubles-b.spec.ts`, singles are
 * `dice-logged-crit-singles.spec.ts`). The sweep is described there; its helpers are in `dice-logged-sweep-rows.ts`.
 */
await loadSimMods('gen9championsou');
// a full sweep plays every Dex move of a rule set in one test (about two minutes for the crits of a doubles cell)
vi.setConfig({ testTimeout: 900_000 });

afterAll(() => writeSummaries('crit-doubles-a'));

registerKindRows(CRIT_CASES.doublesA, ['crit']);
