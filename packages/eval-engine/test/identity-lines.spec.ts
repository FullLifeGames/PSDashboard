import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { Battle, Teams } from '@pkmn/sim';
import { buildTeamsFromReplay, getBranchSimulatorFormat, logRules, speciesBaseId, type GameRules } from '@fulllifegames/replay-core';
import { loadSimMods } from '../src/forward/sim-mods';

/**
 * Round 72, T238: the simulator writes the replay's own switch lines. The built set of a body carries the replay's
 * nickname, level, gender and shiny flag, so a switch-in of the branch battle reads
 * `|switch|p1a: NOT ICT|Landorus-Therian, M, shiny|`, the line the game wrote, and the branch needs no translator
 * between the two halves of its log (src/lib/branch-log.ts and branch/protocol-names.ts went with this).
 *
 * The sweep: every fixture replay (singles of generations 3, 6, 7 and 9, doubles, VGC, Champions, draft, Custom Game)
 * builds its teams as the app does and makes the branch battle from them. Every body a `switch`, `drag` or `replace`
 * line shows must exist on its side with the line's name and static flags (level, gender, shiny) and the line's base
 * species. A forme the body takes on in battle (Mega, Terastal, Gigantamax) changes the species and no flag, so the base
 * species is the key; `tera:<type>` is not static and a hidden `-*` marker is not read.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURES = [
  'packages/eval-engine/test/fixtures',
  'packages/eval-engine/test/fixtures/champions',
  'packages/replay-core/test/fixtures',
];

interface Replay { id: string; format: string; formatid?: string; players: string[]; log: string }

function replays(): Array<{ tag: string; replay: Replay }> {
  const found: Array<{ tag: string; replay: Replay }> = [];
  const seen = new Set<string>();
  for (const dir of FIXTURES) {
    if (!existsSync(`${root}${dir}`)) continue;
    for (const name of readdirSync(`${root}${dir}`)) {
      if (!name.endsWith('.json') || seen.has(name)) continue;
      const parsed = JSON.parse(readFileSync(`${root}${dir}/${name}`, 'utf8')) as Partial<Replay>;
      if (typeof parsed.log !== 'string' || !parsed.format) continue;
      seen.add(name);
      found.push({ tag: name.replace(/\.json$/, ''), replay: { id: name, players: [], ...parsed } as Replay });
    }
  }
  return found;
}

const STATIC_FLAG = /^(L\d+|M|F|shiny)$/;
const ENTRY = /^\|(switch|drag|replace)\|(p[12])[a-d]?: ([^|]*)\|([^|]*)/;

/** Species base id and the static flags of a details string, flags in the protocol's order. */
function reading(details: string, rules: GameRules): { base: string; flags: string } {
  const [species, ...flags] = details.split(', ');
  return { base: speciesBaseId(species.trim().replace(/-\*$/, ''), rules), flags: flags.filter(flag => STATIC_FLAG.test(flag)).join(', ') };
}

/** Every distinct body a replay shows: side, the name on its line, base species and static flags. */
function shownBodies(log: string): Array<{ side: 'p1' | 'p2'; name: string; base: string; flags: string; line: string }> {
  const bodies = new Map<string, { side: 'p1' | 'p2'; name: string; base: string; flags: string; line: string }>();
  const rules = logRules(log);
  for (const raw of log.split('\n')) {
    const entry = ENTRY.exec(raw.replace(/\r$/, ''));
    if (!entry) continue;
    const { base, flags } = reading(entry[4], rules);
    const key = [entry[2], entry[3], base, flags].join('|');
    if (!bodies.has(key)) bodies.set(key, { side: entry[2] as 'p1' | 'p2', name: entry[3], base, flags, line: raw });
  }
  return [...bodies.values()];
}

const SWEEP = replays();

describe('the built sets switch in with the lines the replay has', () => {
  test('the sweep covers the fixture replays of both game types, VGC and Champions', () => {
    expect(SWEEP.length).toBeGreaterThanOrEqual(22);
    const formats = SWEEP.map(entry => entry.replay.format);
    expect(formats.some(format => /Doubles/.test(format))).toBe(true);
    expect(formats.some(format => /VGC/.test(format) && !/Champions/.test(format))).toBe(true);
    expect(formats.some(format => /Champions/.test(format))).toBe(true);
    expect(formats.some(format => /\] OU$/.test(format))).toBe(true);
  });

  test.each(SWEEP.map(entry => [entry.tag, entry.replay] as const))('%s: every body of the replay exists in the branch battle as the replay shows it', async (_tag, replay) => {
    const format = getBranchSimulatorFormat(replay as never);
    await loadSimMods(format);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log);
    const battle = new Battle({
      formatid: format as never, seed: [1, 2, 3, 4],
      p1: { name: 'p1', team: Teams.pack(p1Team) }, p2: { name: 'p2', team: Teams.pack(p2Team) },
    });
    const missing = shownBodies(replay.log).filter(shown => {
      const side = battle.sides[shown.side === 'p1' ? 0 : 1];
      return !side.pokemon.some(body => {
        const mine = reading(body.details, logRules(replay.log));
        return body.name === shown.name && mine.base === shown.base && mine.flags === shown.flags;
      });
    }).map(shown => `${shown.side} ${shown.line.split('|').slice(2, 4).join(' | ')}`);
    expect(missing).toEqual([]);
  }, 60_000);
});
