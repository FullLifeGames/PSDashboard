import { afterAll, vi } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { CRIT_CASES, registerKindRows, writeSummaries } from './dice-logged-sweep-rows';

await loadSimMods('gen9championsou');
// a full sweep plays every Dex move of a rule set in one test (about two minutes for the crits of a doubles cell)
vi.setConfig({ testTimeout: 900_000 });

afterAll(() => writeSummaries('crit-doubles-a'));

registerKindRows(CRIT_CASES.doublesA, ['crit']);
