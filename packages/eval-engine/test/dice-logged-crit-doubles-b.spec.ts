import { afterAll, vi } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { CRIT_CASES, registerKindRows, writeSummaries } from './dice-logged-sweep-rows';

await loadSimMods('gen9championsou');
vi.setConfig({ testTimeout: 900_000 });

afterAll(() => writeSummaries('crit-doubles-b'));

registerKindRows(CRIT_CASES.doublesB, ['crit']);
