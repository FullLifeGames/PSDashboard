import { writeFileSync } from 'node:fs';
import { Battle as SimBattle, Teams, toID, type Battle, type Pokemon } from '@pkmn/sim';
import { afterAll, describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { offeredDice, type DieOffer } from '../src/dice/offer';
import { RecordingPRNG } from '../src/dice/prng';
import { dieKey, type ForcedDie } from '../src/dice/types';
import { watchBattle } from '../src/dice/watch';
import { copyOf } from '../src/sim-ask/copy';
import { CHAMPIONS, playClicks, RULES, standing, type Mode, type Rules } from './dice-fixtures';
import { clicksAccepted, dexOfRules, forcedOn, sweepMoves, type DexMove } from './dice-sweep-support';
import { set } from './move-oracle';
import { fingerprint } from './power-oracle';

// Round 88 (T344, #80): a charge move that skips its charge turn fires at once, so its dice belong to the turn of the click.
// For every Dex move with the flag `charge`, in every rule set the corpus plays, singles, doubles and VGC (a team of six), under
// each skip the simulator knows (the move's weather, Primordial Sea and Desolate Land, Power Herb, Mega Sol) and each block of a
// skip (Utility Umbrella, Cloud Nine and Air Lock, Klutz, Embargo, Magic Room): the oracle is the natural turn on a copy (the user
// holds a volatile of the move afterwards when it charged). A move that charged offers no dice; a move that fired offers every die
// the natural turn drew and none the simulator never draws. The offer leaves the live battle as it was.
await loadSimMods('gen9championsou');

const FAST = 'Pikachu';
const NEEDS_AIM = new Set(['normal', 'any', 'adjacentFoe']);
/** The kinds of die the offer covers (a charge turn draws none of them). */
const OFFERED_KINDS = new Set(['accuracy', 'crit', 'damage-roll', 'secondary', 'self-effect', 'hit-count', 'stalling', 'power']);

interface Outfit { ability?: string; item?: string }
interface Scene {
  id: string;
  /** The user's ability and item. */
  a?: Outfit;
  /** The ability of the foe in front (Cloud Nine, Air Lock). */
  foe?: Outfit;
  /** A weather ability on the field from beside the user (the ally in doubles, the foe in singles). */
  setter?: string;
  /** A weather set on the field directly. */
  weather?: string;
  embargo?: boolean;
  magicRoom?: boolean;
}

const SCENES: Scene[] = [
  { id: 'no weather' },
  { id: 'sun', weather: 'sunnyday' },
  { id: 'rain', weather: 'raindance' },
  { id: 'Drought beside', setter: 'Drought' },
  { id: 'Drizzle beside', setter: 'Drizzle' },
  { id: 'Desolate Land beside', setter: 'Desolate Land' },
  { id: 'Primordial Sea beside', setter: 'Primordial Sea' },
  { id: 'Power Herb', a: { item: 'Power Herb' } },
  { id: 'sun with Utility Umbrella', weather: 'sunnyday', a: { item: 'Utility Umbrella' } },
  { id: 'rain with Utility Umbrella', weather: 'raindance', a: { item: 'Utility Umbrella' } },
  { id: 'sun with Cloud Nine on the foe', weather: 'sunnyday', foe: { ability: 'Cloud Nine' } },
  { id: 'rain with Air Lock on the foe', weather: 'raindance', foe: { ability: 'Air Lock' } },
  { id: 'Power Herb with Klutz', a: { item: 'Power Herb', ability: 'Klutz' } },
  { id: 'Power Herb with Embargo', a: { item: 'Power Herb' }, embargo: true },
  { id: 'Power Herb in Magic Room', a: { item: 'Power Herb' }, magicRoom: true },
  { id: 'Mega Sol', a: { ability: 'Mega Sol' } },
  { id: 'Mega Sol with Utility Umbrella', a: { ability: 'Mega Sol', item: 'Utility Umbrella' } },
  { id: 'Mega Sol with Cloud Nine on the foe', a: { ability: 'Mega Sol' }, foe: { ability: 'Cloud Nine' } },
];

const has = (rules: Rules, kind: 'items' | 'abilities' | 'moves', id: string): boolean => {
  const dex = dexOfRules(rules);
  const entry = dex[kind].get(id);
  return entry.exists && entry.gen <= dex.gen && !entry.isNonstandard;
};

/** The names a scene needs from the Dex: the rule set lacks one, the scene does not exist there. */
function playable(rules: Rules, scene: Scene): boolean {
  const names: [Parameters<typeof has>[1], string | undefined][] = [
    ['abilities', scene.a?.ability], ['items', scene.a?.item], ['abilities', scene.foe?.ability], ['abilities', scene.setter], ['moves', scene.embargo ? 'embargo' : undefined],
    ['moves', scene.magicRoom ? 'magicroom' : undefined], ['moves', scene.weather === 'sunnyday' ? 'sunnyday' : scene.weather === 'raindance' ? 'raindance' : undefined],
  ];
  return names.every(([kind, name]) => name === undefined || has(rules, kind, toID(name)));
}

type Mon = ReturnType<typeof set>;
function mon(rules: Rules, species: string, moves: string[], outfit: Outfit = {}, gender: 'M' | 'F' = 'F'): Mon {
  return set(species, moves, {
    level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}), gender: rules.generation >= 2 ? gender : '',
    item: outfit.item ?? '', ability: outfit.ability ?? 'No Ability',
  });
}

/** The board of a row: the user (Pikachu with the move) and the foe in front, in doubles an ally and a second foe beside them, in VGC four more per side. */
function boardOf(rules: Rules, mode: Mode, vgc: boolean, scene: Scene, moveId: string): Battle {
  const doubles = mode === 'doubles';
  const attacker = mon(rules, FAST, [moveId], scene.a ?? {}, 'M');
  const setterOnAlly = doubles ? scene.setter : undefined;
  const ally = mon(rules, 'Blissey', ['splash'], { ability: setterOnAlly });
  const foe = mon(rules, 'Vaporeon', ['splash'], { ...scene.foe, ...(doubles || !scene.setter ? {} : { ability: scene.setter }) });
  const foe2 = mon(rules, 'Vaporeon', ['splash']);
  const bench = (): Mon[] => ['Pikachu', 'Chansey', 'Snorlax', 'Blissey'].map(species => mon(rules, species, ['splash']));
  const p1 = doubles ? [attacker, ally, ...(vgc ? bench() : [])] : [attacker];
  const p2 = doubles ? [foe, foe2, ...(vgc ? bench() : [])] : [foe];
  const battle = new SimBattle({
    formatid: toID(doubles ? rules.doubles! : rules.singles), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  if (scene.weather) battle.field.setWeather(scene.weather, battle.sides[1].active[0]);
  if (scene.magicRoom) battle.field.addPseudoWeather('magicroom', battle.sides[1].active[0]);
  if (scene.embargo) battle.sides[0].active[0].addVolatile('embargo');
  return battle;
}

const chargingOf = (user: Pokemon, moveId: string): boolean => Object.values(user.volatiles).some(volatile => (volatile as { move?: string }).move === moveId);

/** The dice the natural turn draws for the move of the slot, by key, and what the simulator did with the move. */
function naturalTurn(board: Battle, clicks: { p1: string; p2: string }, moveId: string): { keys: string[]; charged: boolean; ran: boolean } {
  const copy = copyOf(board);
  copy.prng ??= board.prng.clone();
  const start = copy.log.length;
  const watch = watchBattle(copy);
  const recording = new RecordingPRNG(copy.prng, watch);
  copy.prng = recording;
  try {
    playClicks(copy, clicks);
  } finally {
    watch.uninstall();
  }
  const lines = copy.log.slice(start);
  // a move the weather or the field stops (Dive under Desolate Land) fails with a line of the user and runs nothing
  const ran = !lines.some(line => /^\|-(fail|notarget)\|p1a/.test(line));
  return { keys: [...recording.record.keys()].filter(key => key.startsWith(`p1a:${moveId}:`)), charged: chargingOf(copy.sides[0].active[0], moveId), ran };
}

const clicksOf = (mode: Mode, move: DexMove): { p1: string; p2: string } =>
  mode === 'singles' ? { p1: 'move 1', p2: 'move 1' } : { p1: `move 1${NEEDS_AIM.has(move.target) ? ' 1' : ''}, move 1`, p2: 'move 1, move 1' };

interface Counts { rows: number; fired: number; charged: number; failed: number; refused: number; offeredOnFire: number }
const sum: Counts = { rows: 0, fired: 0, charged: 0, failed: 0, refused: 0, offeredOnFire: 0 };
const summaries: string[] = [];
afterAll(() => {
  const lines = [...summaries, `total ${JSON.stringify(sum)}`];
  if (process.env.DICE_SWEEP_LOG) writeFileSync(process.env.DICE_SWEEP_LOG, lines.join(String.fromCharCode(10)), 'utf8');
});

function exercise(rules: Rules, mode: Mode, vgc: boolean, scene: Scene, move: DexMove, counts: Counts): string[] {
  const board = boardOf(rules, mode, vgc, scene, move.id);
  const clicks = clicksOf(mode, move);
  counts.rows++;
  if (!clicksAccepted(board, clicks)) {
    counts.refused++;
    return [];
  }
  const choice = { kind: 'move' as const, moveId: move.id, moveName: move.name, ...(mode === 'doubles' && NEEDS_AIM.has(move.target) ? { targetLoc: 1 } : {}) };
  const bodies = board.sides.flatMap(side => side.pokemon);
  const before = `${standing(board)}|${fingerprint(board, bodies, move.id)}`;
  const offers: DieOffer[] = offeredDice(board, 'p1a', choice);
  expect(`${standing(board)}|${fingerprint(board, bodies, move.id)}`, `${move.id} offer leaves the battle as it was`).toBe(before);
  const natural = naturalTurn(board, clicks, move.id);
  const dice = offers.filter(offer => OFFERED_KINDS.has(offer.name.kind));
  const problems: string[] = [];
  if (natural.charged) {
    counts.charged++;
    if (dice.length > 0) problems.push(`charges, but offers ${dice.map(offer => dieKey(offer.name)).join(', ')}`);
    return problems;
  }
  if (!natural.ran) {
    counts.failed++;
    return problems;
  }
  counts.fired++;
  if (dice.length > 0) counts.offeredOnFire++;
  const offered = new Set(offers.map(offer => dieKey(offer.name)));
  for (const key of natural.keys) {
    const [, , target, kind] = key.split(':');
    // a die the state cannot name before the hit stays unoffered: a self effect set in the move's own `onTryHit`, an accuracy aimed at the user
    const lateSelf = kind === 'self-effect' && typeof (dexOfRules(rules).moves.get(move.id) as unknown as { onTryHit?: unknown }).onTryHit === 'function';
    if (OFFERED_KINDS.has(kind) && !offered.has(key) && !lateSelf && target !== 'p1a') problems.push(`fires, but the offer lacks ${key}`);
  }
  if (dice.length === 0) return problems;
  // every offered die, forced, is drawn (the accuracy forced to hit so the dice behind it run)
  const forced: ForcedDie[] = dice.map(offer => ({ name: offer.name, result: offer.name.kind === 'accuracy' ? { happens: true } : offer.results[0] }));
  const { report } = forcedOn(board, clicks, forced);
  for (const shown of report.forced.filter(entry => entry.took === 'no-draw' && /^the simulator drew no/.test(entry.reason ?? ''))) {
    problems.push(`offers ${dieKey(shown.die.name)}, which the simulator never draws (${shown.reason})`);
  }
  return problems;
}

/** Every charge move the rule set plays, through the shared selection (a plain run plays a sample; `DICE_SWEEPS=full` plays all). The reported scenes below name their moves. */
const chargeMoves = (rules: Rules): DexMove[] => sweepMoves(rules, move => !!move.flags.charge, false).moves;

/** The rule sets and game types of the sweep: singles everywhere, doubles from Gen 3, VGC (a team of six) in Scarlet/Violet and Champions. */
const CASES: { rules: Rules; mode: Mode; vgc: boolean; name: string }[] = RULES.flatMap(rules => [
  { rules, mode: 'singles' as const, vgc: false, name: `${rules.name} singles` },
  ...(rules.doubles ? [{ rules, mode: 'doubles' as const, vgc: false, name: `${rules.name} doubles` }] : []),
  ...(rules.doubles && rules.generation === 9 ? [{ rules, mode: 'doubles' as const, vgc: true, name: `${rules.name} VGC` }] : []),
]);

describe.each(CASES)('a charge move that may skip its charge turn: $name', ({ rules, mode, vgc, name }) => {
  const moves = chargeMoves(rules);
  test.each(SCENES.filter(scene => playable(rules, scene)).map(scene => [scene.id, scene] as const))('%s', (_id, scene) => {
    const counts: Counts = { rows: 0, fired: 0, charged: 0, failed: 0, refused: 0, offeredOnFire: 0 };
    const problems = moves.flatMap(move => exercise(rules, mode, vgc, scene, move, counts).map(problem => `${move.id}: ${problem}`));
    for (const key of Object.keys(sum) as (keyof Counts)[]) sum[key] += counts[key];
    summaries.push(`${name} / ${scene.id}: ${moves.length} moves ${JSON.stringify(counts)}`);
    expect(problems).toEqual([]);
    expect(counts.rows).toBe(moves.length);
  });
});

describe('the reported scenes', () => {
  const GEN9 = RULES.find(rules => rules.generation === 9 && rules !== CHAMPIONS)!;
  const GEN4 = RULES.find(rules => rules.generation === 4)!;
  const GEN5 = RULES.find(rules => rules.generation === 5)!;
  const kinds = (offers: DieOffer[]): string[] => offers.map(offer => offer.name.kind);
  const offerOf = (rules: Rules, mode: Mode, vgc: boolean, scene: Scene, moveId: string): DieOffer[] =>
    offeredDice(boardOf(rules, mode, vgc, scene, moveId), 'p1a', {
      kind: 'move', moveId, moveName: moveId, ...(mode === 'doubles' ? { targetLoc: 1 } : {}),
    });
  const RAIN: Scene = { id: 'Drizzle beside', setter: 'Drizzle' };

  test.each([
    ['singles', GEN9, 'singles', false],
    ['doubles', GEN9, 'doubles', false],
    ['VGC', GEN9, 'doubles', true],
    ['Champions VGC', CHAMPIONS, 'doubles', true],
  ] as const)('Electro Shot in rain offers its dice: %s', (_name, rules, mode, vgc) => {
    expect(kinds(offerOf(rules, mode, vgc, RAIN, 'electroshot'))).toEqual(expect.arrayContaining(['accuracy', 'crit', 'damage-roll']));
  });

  test('Electro Shot charges without the rain', () => {
    expect(offerOf(GEN9, 'singles', false, { id: 'none' }, 'electroshot')).toEqual([]);
    expect(offerOf(GEN9, 'doubles', true, { id: 'none' }, 'electroshot')).toEqual([]);
  });

  test('Electro Shot in rain beside Utility Umbrella charges', () => {
    expect(offerOf(GEN9, 'singles', false, { ...RAIN, a: { item: 'Utility Umbrella' } }, 'electroshot')).toEqual([]);
  });

  test('Power Herb, Solar Beam in sun and Mega Sol fire at once', () => {
    expect(kinds(offerOf(GEN9, 'singles', false, { id: 'herb', a: { item: 'Power Herb' } }, 'meteorbeam')).length).toBeGreaterThan(0);
    expect(kinds(offerOf(GEN9, 'singles', false, { id: 'sun', weather: 'sunnyday' }, 'solarblade')).length).toBeGreaterThan(0);
    expect(kinds(offerOf(GEN4, 'singles', false, { id: 'sun', weather: 'sunnyday' }, 'solarbeam')).length).toBeGreaterThan(0);
    expect(kinds(offerOf(CHAMPIONS, 'singles', false, { id: 'mega sol', a: { ability: 'Mega Sol' } }, 'solarbeam')).length).toBeGreaterThan(0);
  });

  test('Sky Drop and the Gen 1 charge moves never skip', () => {
    expect(offerOf(GEN5, 'singles', false, { id: 'herb', a: { item: 'Power Herb' } }, 'skydrop')).toEqual([]);
    expect(offerOf(RULES[0], 'singles', false, { id: 'none' }, 'solarbeam')).toEqual([]);
  });

  test('the sweep saw both outcomes', () => {
    // read after the rows above ran: both a move that fired and a move that charged stood in the sweep
    expect(sum.fired).toBeGreaterThan(0);
    expect(sum.charged).toBeGreaterThan(0);
  });
});
