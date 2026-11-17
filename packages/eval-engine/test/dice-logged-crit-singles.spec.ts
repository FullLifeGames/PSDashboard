import { afterAll, vi } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { CRIT_CASES, registerKindRows, writeSummaries } from './dice-logged-sweep-rows';

/**
 * D9b (#125): the crit rows of the logged sweep in singles (Gens 1 to 9 and Champions), a part of the former `dice-logged-sweep.spec.ts`
 * under the same titles (doubles are `dice-logged-crit-doubles-a.spec.ts` and `-b.spec.ts`). The sweep is described there; its helpers are
 * in `dice-logged-sweep-rows.ts`.
 */
await loadSimMods('gen9championsou');
// a full sweep plays every Dex move of a rule set in one test
vi.setConfig({ testTimeout: 900_000 });

afterAll(() => writeSummaries('crit-singles'));

registerKindRows(CRIT_CASES.singles, ['crit']);
