import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import type { Battle, Pokemon, PokemonSet, Side } from '@pkmn/sim';
import { canSwitchOut, stageStands } from '../src/score/switch-out';
import { createRootPosition, legalChoices } from '../src/forward-model';
import { serializeLiveBattle } from '../src/serialize';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf, fingerprint } from './power-oracle';

/**
 * A stat drop stops counting while its holder can leave the field by its own switch. The simulator clears every stage on switch-out, so a drop is a liability only for
 * a holder that cannot leave: a trapped body (`pokemon.trapped`, written at the end of every turn and for a hard-locked move when the request is written) or a side with
 * no living bench (`battle.canSwitch(side) > 0`). `canSwitchOut` (score/switch-out.ts) is the one reading of that rule; this sweep holds it to the simulator.
 *
 * Every question runs on a twin battle in debug-free custom games, singles and doubles, in every generation the corpus plays (3 to 9) and on the Champions mod, and every
 * reading leaves the battle as it was (`fingerprint`). Every Dex entry with a trap handler must be one the sweep names (a new entry turns the census red); every Dex move
 * is clicked once by the foe at the holder and once by the holder and the simulator's answer (`switch N` accepted or refused) is held against `canSwitchOut` and against the
 * legal choices of the search (`forward/choices.ts` keeps its own reading of the request: a deliberate copy, held here). A drop that lands with a living bench does not stand
 * (the switch leaves every stage at 0); with the bench fainted, or behind Shadow Tag, it stands and the simulator refuses the switch. One Intimidate row shows that the rule
 * reads stages, whatever made them. `DICE_SWEEPS=full` plays every generation; a plain run plays Gen 9 and Champions, singles and doubles.
 */

await loadSimMods('gen9championscustomgame');

const FULL = process.env.DICE_SWEEPS === 'full';
const SP = { hp: 32, atk: 32, def: 0, spa: 0, spd: 0, spe: 0 };

interface Mode { name: string; format: string; gen: number; doubles: boolean; champions: boolean }

const GENS = [3, 4, 5, 6, 7, 8, 9];
const ALL_MODES: Mode[] = [
  ...GENS.flatMap(gen => [
    { name: `Gen ${gen} singles`, format: `gen${gen}customgame`, gen, doubles: false, champions: false },
    { name: `Gen ${gen} doubles`, format: `gen${gen}doublescustomgame`, gen, doubles: true, champions: false },
  ]),
  { name: 'Champions singles', format: 'gen9championscustomgame', gen: 9, doubles: false, champions: true },
  { name: 'Champions doubles', format: 'gen9championsdoublescustomgame', gen: 9, doubles: true, champions: true },
];
const MODES = FULL ? ALL_MODES : ALL_MODES.filter(mode => mode.gen === 9);
const dexOf = (mode: Mode) => (mode.champions ? battleOf(mode.format, [set('Pikachu', ['splash']), set('Pikachu', ['splash'])], [set('Pikachu', ['splash']), set('Pikachu', ['splash'])]).dex : Dex.forGen(mode.gen));

// The trap handlers of the Dex (sim/battle.js endTurn runs TrapPokemon, then MaybeTrapPokemon; the Foe variants are the foe's).
const OWN = ['onTrapPokemon', 'onMaybeTrapPokemon'] as const;
const FOE = ['onFoeTrapPokemon', 'onFoeMaybeTrapPokemon'] as const;
const has = (entry: unknown, names: readonly string[]): boolean => !!entry && names.some(name => typeof (entry as Record<string, unknown>)[name] === 'function');
const traps = (entry: unknown): boolean => has(entry, OWN) || has(entry, FOE);

/** What the census names. A Dex entry with a trap handler that is not here fails the census: add its row to the sweep first. */
const DECLARED = {
  abilities: ['arenatrap', 'magnetpull', 'runaway', 'shadowtag'],
  items: ['shedshell'],
  moves: ['fairylock', 'ingrain', 'octolock', 'skydrop'],
  conditions: ['commanded', 'commanding', 'partiallytrapped', 'trapped'],
};

function census(mode: Mode) {
  const dex = dexOf(mode);
  return {
    abilities: dex.abilities.all().filter(traps).map(entry => entry.id).sort(),
    // an ability that traps the foes (Shadow Tag) and one that frees its own holder (Champions' Run Away, as Shed Shell does)
    trappers: dex.abilities.all().filter(entry => has(entry, FOE)).map(entry => entry.name),
    escapes: dex.abilities.all().filter(entry => has(entry, OWN)).map(entry => entry.name),
    items: dex.items.all().filter(traps).map(entry => entry.id).sort(),
    moves: dex.moves.all().filter(move => traps(move) || traps(move.condition)).map(move => move.id).sort(),
    conditions: Object.keys(dex.data.Conditions).filter(id => traps(dex.conditions.get(id))).sort(),
  };
}

const playable = (move: { exists: boolean; gen: number; isMax?: unknown; isZ?: unknown; id: string }) =>
  move.exists && move.gen <= 9 && !move.isMax && !move.isZ && move.id !== 'struggle';

type Bench = 'living' | 'fainted' | 'none';
interface BoardOptions {
  holder?: string; holderMoves?: string[]; holderExtra?: Partial<PokemonSet>; holderLevel?: number;
  foe?: string; foeMoves?: string[]; foeExtra?: Partial<PokemonSet>; foe2Extra?: Partial<PokemonSet>; foeLevel?: number;
  bench?: Bench;
}
interface Board { battle: Battle; mode: Mode }

const sets = (mode: Mode, species: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet =>
  set(species, moves, mode.champions ? { evs: SP, level: 50, ...extra } : extra);

/** Holder = p1 slot 0, foe = p2 slot 0; a Splashing Snorlax stands next to each in doubles, and one body waits on each bench. */
function board(mode: Mode, o: BoardOptions = {}): Board {
  const mine = [sets(mode, o.holder ?? 'Snorlax', [...(o.holderMoves ?? []), 'splash'], { ...(o.holderLevel ? { level: o.holderLevel } : {}), ...o.holderExtra })];
  const foes = [sets(mode, o.foe ?? 'Snorlax', [...(o.foeMoves ?? []), 'splash'], { ...(o.foeLevel ? { level: o.foeLevel } : {}), ...o.foeExtra })];
  if (mode.doubles) {
    mine.push(sets(mode, 'Snorlax', ['splash']));
    foes.push(sets(mode, 'Snorlax', ['splash'], o.foe2Extra));
  }
  const bench = o.bench ?? 'living';
  if (bench !== 'none') mine.push(sets(mode, 'Blissey', ['splash']));
  foes.push(sets(mode, 'Blissey', ['splash']));
  const battle = battleOf(mode.format, mine, foes);
  if (bench === 'fainted') {
    const body = battle.sides[0].pokemon[mine.length - 1];
    body.hp = 0;
    body.fainted = true;
    battle.sides[0].pokemonLeft--;
  }
  // a drop with a chance lands: randomChance (accuracy, crits) is forced on, and the secondary roll (`random(100)`) reads 0
  battle.forceRandomChance = true;
  (battle as unknown as { random: () => number }).random = () => 0;
  return { battle, mode };
}

const splashSlot = (mon: Pokemon): number => mon.moveSlots.findIndex(slot => slot.id === 'splash') + 1;

/** A click that keeps `slot`'s body where it is: Splash, or the first move its request offers (a locked move is its only one). */
function stay(side: Side, slot: number): string {
  const request = side.activeRequest as { active?: { moves: { id: string; disabled?: boolean }[] }[] } | null;
  const list = request?.active?.[slot]?.moves ?? [];
  const splash = list.findIndex(move => move.id === 'splash' && !move.disabled);
  return `move ${(splash >= 0 ? splash : Math.max(0, list.findIndex(move => !move.disabled))) + 1}`;
}

function click(side: Side, attacks: boolean, target: string): string {
  const lead = side.active[0];
  const first = attacks ? `move 1${target}` : `move ${splashSlot(lead)}`;
  return side.active.length > 1 ? `${first}, move ${splashSlot(side.active[1])}` : first;
}

function playTurn(b: Board, attacker: 'p1' | 'p2' | null): boolean {
  const targets = b.mode.doubles ? ['', ' 1', ' -2'] : [''];
  for (const [index, id] of (['p1', 'p2'] as const).entries()) {
    const side = b.battle.sides[index];
    let accepted = false;
    for (const target of attacker === id ? targets : ['']) {
      if (b.battle.choose(id, click(side, attacker === id, target))) { accepted = true; break; }
    }
    if (!accepted) return false;
  }
  return true;
}

/** Both sides at an ordinary move request again (a pivot or a faint raised a forced switch: the default answers it). */
function settle(b: Board): boolean {
  for (let round = 0; round < 4; round++) {
    if (b.battle.ended) return false;
    const pending = b.battle.sides.filter(side => side.requestState === 'switch');
    if (pending.length === 0) return b.battle.sides.every(side => side.requestState === 'move');
    for (const side of pending) b.battle.choose(side.id, 'default');
  }
  return false;
}

function switchClick(side: Side, slot: number): string {
  const bench = side.pokemon.findIndex((mon, index) => index >= side.active.length && !mon.fainted) + 1 || side.active.length + 1;
  if (side.active.length === 1) return `switch ${bench}`;
  return slot === 0 ? `switch ${bench}, ${stay(side, 1)}` : `${stay(side, 0)}, switch ${bench}`;
}

/**
 * The legal choices of the search offer a switch to this side (a deliberate copy of the rule, forward/choices.ts). Singles: the
 * choice list holds a switch. Doubles: some choice holds a switch for some slot; the list pairs the slots, so one slot's switch
 * depends on the other (a partner whose moves a live Imprison bars can only switch itself), and a slot-wise comparison would
 * read the pairing, not the rule.
 */
function offersSwitch(battle: Battle, id: 'p1' | 'p2'): boolean | null {
  const choices = legalChoices(createRootPosition(serializeLiveBattle(battle), 'standard'), id).map(option => option.choice);
  if (choices.length === 0) return null;
  return choices.some(choice => choice.split(', ').some(part => part.startsWith('switch')));
}

interface Reading { label: string; ours: boolean; sim: boolean; legal: boolean | null; pure: boolean }

/** Our reading, the legal choices and the simulator's answer for one body. The battle is spent afterwards: it only sees the click. */
function read(b: Board, id: 'p1' | 'p2', slot: number, label: string): Reading {
  const side = b.battle.sides[id === 'p1' ? 0 : 1];
  const mon = side.active[slot];
  const bodies = b.battle.sides.flatMap(s => s.active);
  const before = fingerprint(b.battle, bodies, 'splash');
  const ours = canSwitchOut(b.battle, mon);
  const pure = fingerprint(b.battle, bodies, 'splash') === before;
  const legal = b.mode.doubles ? null : offersSwitch(b.battle, id);
  const sim = b.battle.choose(id, switchClick(side, slot));
  side.clearChoice();
  return { label, ours, sim, legal, pure };
}

function mismatchOf(reading: Reading): string | null {
  if (!reading.pure) return `${reading.label}: the reading changed the battle`;
  if (reading.ours !== reading.sim) return `${reading.label}: canSwitchOut ${reading.ours}, the simulator ${reading.sim ? 'accepts' : 'refuses'} the switch`;
  if (reading.legal !== null && reading.legal !== reading.sim) return `${reading.label}: the search offers a switch ${reading.legal}, the simulator ${reading.sim ? 'accepts' : 'refuses'}`;
  return null;
}

/** Every active body of the board; in doubles the search's side-wide offer is held against the simulator's answer for any slot. */
function readAll(b: Board, label: string): Reading[] {
  const readings: Reading[] = [];
  const slots = b.mode.doubles ? [0, 1] : [0];
  for (const id of ['p1', 'p2'] as const) {
    const offer = b.mode.doubles ? offersSwitch(b.battle, id) : null;
    const mine: Reading[] = [];
    for (const slot of slots) {
      if (b.battle.sides[id === 'p1' ? 0 : 1].active[slot]?.fainted) continue;
      mine.push(read(b, id, slot, `${label} ${id}${slot + 1}`));
    }
    if (offer !== null && mine.length > 0) {
      mine.push({ label: `${label} ${id} (any slot)`, ours: mine.some(reading => reading.ours), sim: mine.some(reading => reading.sim), legal: offer, pure: true });
    }
    readings.push(...mine);
  }
  return readings;
}

const tally = { rows: 0, refused: 0 };
function judge(readings: Reading[], mismatches: string[]): void {
  for (const reading of readings) {
    tally.rows++;
    if (!reading.sim) tally.refused++;
    const bad = mismatchOf(reading);
    if (bad) mismatches.push(bad);
  }
}

describe.each(ALL_MODES.filter(mode => !mode.doubles))('census of the trap handlers: $name', mode => {
  test('every ability, item, move and condition with a trap handler is one the sweep names', () => {
    const found = census(mode);
    expect(found.abilities.filter(id => !DECLARED.abilities.includes(id))).toEqual([]);
    expect(found.items.filter(id => !DECLARED.items.includes(id))).toEqual([]);
    expect(found.moves.filter(id => !DECLARED.moves.includes(id))).toEqual([]);
    expect(found.conditions.filter(id => !DECLARED.conditions.includes(id))).toEqual([]);
    // and the lists the rows below play are the Dex's, not these names: a name that the Dex dropped leaves the sweep with a hole
    expect(found.abilities.length).toBeGreaterThanOrEqual(2);
    expect(found.items).toEqual(['shedshell']);
    expect(found.moves).toEqual(DECLARED.moves);
    expect(found.conditions).toEqual(DECLARED.conditions);
  });
});

const HOLDERS = [['a Ghost', 'Gengar'], ['a flying Steel', 'Skarmory'], ['a grounded Steel', 'Aggron']] as const;

describe.each(MODES)('trap rows by move: $name', mode => {
  const every = dexOf(mode).moves.all().filter(playable);
  // a plain run plays every fourth move (the trapping ones always, they are read from the Dex); `DICE_SWEEPS=full` plays them all
  const sourceOfTrap = (move: (typeof every)[number]) => DECLARED.moves.includes(move.id) || ['trapped', 'partiallytrapped'].some(id =>
    move.volatileStatus === id || move.self?.volatileStatus === id || move.secondary?.volatileStatus === id
    || [move.onHit, move.onTryHit, move.secondary?.onHit, move.self?.onHit].some(handler => String(handler).includes(`'${id}'`)));
  const moves = FULL ? every : every.filter((move, index) => index % 4 === 0 || sourceOfTrap(move));

  test('every move, clicked by the foe at the holder and by the holder: canSwitchOut is the simulator\'s answer', () => {
    expect(every.length).toBeGreaterThan(mode.gen === 3 ? 300 : 500);
    const mismatches: string[] = [];
    let played = 0;
    const trapping = new Set<string>();
    for (const move of moves) {
      for (const attacker of ['p2', 'p1'] as const) {
        const b = board(mode, attacker === 'p1' ? { holderMoves: [move.id] } : { foeMoves: [move.id] });
        let readings: Reading[];
        try {
          if (!playTurn(b, attacker) || !settle(b)) continue;
          readings = readAll(b, `${move.id} by ${attacker}`);
        } catch (error) {
          mismatches.push(`${move.id} by ${attacker}: the twin threw ${(error as Error).message}`);
          continue;
        }
        played++;
        judge(readings, mismatches);
        if (readings.some(reading => !reading.sim)) { trapping.add(move.id); }
      }
    }
    expect(played).toBeGreaterThan(moves.length);
    expect(mismatches).toEqual([]);
    // the declared trapping moves are sources the Dex names: each one leaves a body that cannot switch (Sky Drop needs two turns and a light holder, below)
    for (const id of DECLARED.moves.filter(id => id !== 'skydrop')) if (moves.some(move => move.id === id)) expect(trapping.has(id), `${id} traps`).toBe(true);
    console.info(`${mode.name}: ${moves.length} of ${every.length} moves, ${played} turns played, ${trapping.size} moves leave a body that cannot switch: ${[...trapping].join(' ')}`);
  });

  test('a trapping move replayed on a Ghost, a flying Steel and a grounded Steel, with a living, a fainted and no bench', () => {
    const mismatches: string[] = [];
    const ids = moves.map(move => move.id).filter(id => DECLARED.moves.includes(id) || dexOf(mode).moves.get(id).volatileStatus === 'trapped' || dexOf(mode).moves.get(id).volatileStatus === 'partiallytrapped'
      || dexOf(mode).moves.get(id).self?.volatileStatus === 'trapped' || dexOf(mode).moves.get(id).secondary?.volatileStatus === 'trapped');
    expect(ids.length).toBeGreaterThan(4);
    let rows = 0;
    for (const id of ids) {
      for (const [kind, holder] of HOLDERS) {
        for (const bench of ['living', 'fainted', 'none'] as const) {
          for (const attacker of ['p2', 'p1'] as const) {
            const b = board(mode, { holder, bench, ...(attacker === 'p1' ? { holderMoves: [id] } : { foeMoves: [id] }) });
            if (!playTurn(b, attacker) || !settle(b)) continue;
            rows++;
            judge(readAll(b, `${id} by ${attacker} at ${kind}, ${bench} bench`), mismatches);
          }
        }
      }
    }
    expect(rows).toBeGreaterThan(ids.length * 6);
    expect(mismatches).toEqual([]);
  });
});

describe.each(MODES)('trap rows, Sky Drop: $name', mode => {
  test('a light holder lifted over two turns: the lifted body cannot switch, canSwitchOut is the simulator\'s answer after each turn', () => {
    if (!dexOf(mode).moves.get('skydrop').exists) return;
    const mismatches: string[] = [];
    const b = board(mode, { holder: 'Pikachu', foeMoves: ['skydrop'] });
    let refused = 0;
    for (let turn = 0; turn < 2; turn++) {
      expect(playTurn(b, 'p2') && settle(b)).toBe(true);
      const readings = readAll(b, `skydrop turn ${turn + 1}`);
      refused += readings.filter(reading => !reading.sim).length;
      judge(readings, mismatches);
    }
    expect(mismatches).toEqual([]);
    expect(refused).toBeGreaterThan(0);
  });
});

describe.each(MODES)('trap rows by ability and item: $name', mode => {
  const { trappers: abilities, escapes } = census(mode);
  const idleTurn = (b: Board) => b.battle.choose('p1', click(b.battle.sides[0], false, '')) && b.battle.choose('p2', click(b.battle.sides[1], false, ''));

  test('each trapping ability on the foe (and on its partner), against every holder type, with and without Shed Shell, with a living and a fainted bench', () => {
    expect(abilities.length).toBeGreaterThanOrEqual(2);
    const mismatches: string[] = [];
    let rows = 0;
    for (const ability of abilities) {
      for (const where of mode.doubles ? ['foe', 'partner'] : ['foe']) {
        for (const holder of ['Snorlax', 'Gengar', 'Skarmory', 'Aggron']) {
          for (const [item, own] of [['', ''], ['Shed Shell', ''], ...escapes.map(name => ['', name])]) {
            for (const bench of ['living', 'fainted'] as const) {
              const b = board(mode, {
                holder, bench, holderExtra: { item, ...(own ? { ability: own } : {}) },
                ...(where === 'foe' ? { foeExtra: { ability } } : { foe2Extra: { ability } }),
              });
              if (!idleTurn(b) || !settle(b)) continue;
              rows++;
              judge(readAll(b, `${ability} on the ${where}, ${holder}${item ? ' with Shed Shell' : ''}${own ? ` with ${own}` : ''}, ${bench} bench`), mismatches);
            }
          }
        }
      }
      // the same ability on both sides: a body with the ability is not trapped by it
      const mirror = board(mode, { holderExtra: { ability }, foeExtra: { ability } });
      if (idleTurn(mirror) && settle(mirror)) { rows++; judge(readAll(mirror, `${ability} on both sides`), mismatches); }
    }
    expect(rows).toBeGreaterThan(abilities.length * 8);
    expect(mismatches).toEqual([]);
    console.info(`${mode.name}: ${abilities.length} trapping abilities, ${rows} boards`);
  });
});

describe.each(MODES.filter(mode => mode.doubles && mode.gen === 9 && !mode.champions))('the Commander pair: $name', mode => {
  test('Tatsugiri riding Dondozo, either slot: canSwitchOut is the simulator\'s answer for both bodies', () => {
    const mismatches: string[] = [];
    for (const order of [['Tatsugiri', 'Dondozo'], ['Dondozo', 'Tatsugiri']]) {
      const mine = order.map(species => set(species, ['splash'], species === 'Tatsugiri' ? { ability: 'Commander' } : { ability: 'Unaware' }));
      const battle = battleOf(mode.format, [...mine, set('Blissey', ['splash'])], [set('Snorlax', ['splash']), set('Snorlax', ['splash']), set('Blissey', ['splash'])]);
      const b: Board = { battle, mode };
      expect(battle.sides[0].active.some(mon => mon.volatiles['commanding'] || mon.volatiles['commanded'])).toBe(true);
      // the commanding Tatsugiri has no choice of its own: the default answers for p1
      expect(battle.choose('p1', 'default') && battle.choose('p2', click(battle.sides[1], false, '')) && settle(b)).toBe(true);
      for (const slot of [0, 1]) {
        const mon = battle.sides[0].active[slot];
        const ours = canSwitchOut(battle, mon);
        const sim = battle.choose('p1', switchClick(battle.sides[0], slot));
        battle.sides[0].clearChoice();
        if (ours !== sim) mismatches.push(`${order.join(' + ')} slot ${slot + 1} (${mon.species.name}): canSwitchOut ${ours}, the simulator ${sim ? 'accepts' : 'refuses'}`);
        if (mon.species.name === 'Tatsugiri' || mon.volatiles['commanded']) expect(ours).toBe(false);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

type Role = 'self' | 'target';
interface Drop { role: Role; stats: string[] }

const negatives = (boosts: unknown): string[] =>
  Object.entries((boosts ?? {}) as Record<string, number>).filter(([, stage]) => stage < 0).map(([stat]) => stat);

/** The negative stages a move can write, by who gets them, read from the Dex entry (never listed by name). */
function dropsOf(move: ReturnType<typeof Dex.moves.get>): Drop[] {
  const drops: Drop[] = [];
  const add = (role: Role, boosts: unknown) => { const stats = negatives(boosts); if (stats.length) drops.push({ role, stats }); };
  add(move.target === 'self' ? 'self' : 'target', move.boosts);
  add('self', move.self?.boosts);
  add('self', move.selfBoost?.boosts);
  for (const secondary of [move.secondary, ...(move.secondaries ?? [])]) {
    if (!secondary) continue;
    add('target', secondary.boosts);
    add('self', secondary.self?.boosts);
  }
  return drops;
}

function dropMismatches({ b, holder, foe }: { b: Board; holder: Pokemon; foe: Pokemon }, label: string, bench: Bench | 'shadowtag'): string[] {
  const out: string[] = [];
  const stages = Object.entries(holder.boosts).filter(([, stage]) => stage < 0);
  const ours = canSwitchOut(b.battle, holder);
  const standing = stages.every(([, stage]) => stageStands(b.battle, holder, stage));
  const sim = b.battle.choose('p1', switchClick(b.battle.sides[0], 0));
  if (ours !== sim) out.push(`${label}: canSwitchOut ${ours}, the simulator ${sim ? 'accepts' : 'refuses'}`);
  if (standing === ours) out.push(`${label}: the drop ${standing ? 'stands' : 'does not stand'} for a holder that ${ours ? 'can' : 'cannot'} switch out`);
  if (bench === 'living' && !ours && !holder.trapped) out.push(`${label}: free holder read as unable to switch`);
  // Memento: the Shadow Tag holder faints with its move, and its trap with it
  const trapperGone = bench === 'shadowtag' && foe.fainted;
  if (bench !== 'living' && ours && !trapperGone) out.push(`${label}: a holder behind ${bench} read as free`);
  if (sim) {
    // the premise of the rule: the switch clears every stage
    b.battle.choose('p2', 'default');
    if (holder.isActive || Object.values(holder.boosts).some(stage => stage !== 0)) out.push(`${label}: the simulator kept ${JSON.stringify(holder.boosts)} on the switched-out body`);
  }
  return out;
}

const STATS = ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'] as const;

describe.each(MODES)('drop rows: $name', mode => {
  const dex = dexOf(mode);
  const dropMoves = dex.moves.all().filter(playable).map(move => ({ move, drops: dropsOf(move) })).filter(entry => entry.drops.length > 0);
  const trapper = (mode: Mode) => dexOf(mode).abilities.get('shadowtag').name;

  /** The holder is the body that carries the drop: p1 for a drop on the user, p1 as the target of p2's move for a drop on the target. */
  function played(entry: (typeof dropMoves)[number], role: Role, bench: Bench | 'shadowtag'): { b: Board; holder: Pokemon; foe: Pokemon } | null {
    const mover = role === 'self' ? 'p1' : 'p2';
    const b = board(mode, {
      holder: 'Typhlosion', foe: 'Typhlosion', bench: bench === 'shadowtag' ? 'living' : bench,
      ...(mover === 'p1' ? { holderMoves: [entry.move.id], holderLevel: 5 } : { foeMoves: [entry.move.id], foeLevel: 5 }),
      ...(bench === 'shadowtag' ? { foeExtra: { ability: trapper(mode) } } : {}),
    });
    const holder = b.battle.sides[0].active[0];
    const foe = b.battle.sides[1].active[0];
    if (!playTurn(b, mover) || !settle(b)) return null;
    if (b.battle.sides[0].active[0] !== holder || holder.fainted) return null;
    return Object.values(holder.boosts).some(stage => stage < 0) ? { b, holder, foe } : null;
  }

  test('a drop that landed does not stand with a living bench, stands with a fainted bench or behind Shadow Tag, and the switch clears it', () => {
    expect(dropMoves.length).toBeGreaterThan(mode.gen === 3 ? 20 : 50);
    const mismatches: string[] = [];
    const unlanded = new Set<string>();
    const landed = new Set<string>();
    let rows = 0;
    for (const entry of dropMoves) {
      for (const role of new Set(entry.drops.map(drop => drop.role))) {
        for (const bench of ['living', 'fainted', 'shadowtag'] as const) {
          const hit = played(entry, role, bench);
          if (!hit) { unlanded.add(entry.move.id); continue; }
          landed.add(entry.move.id);
          rows++;
          mismatches.push(...dropMismatches(hit, `${entry.move.id} (${role}), ${bench}`, bench));
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(landed.size).toBeGreaterThan(dropMoves.length / 2);
    console.info(`${mode.name}: ${dropMoves.length} moves with a drop, ${landed.size} landed (${rows} rows), ${unlanded.size} never landed on turn 1 of a twin (stage rows below): ${[...unlanded].filter(id => !landed.has(id)).join(' ')}`);
  });

  test('every stat at every drop stage on a holder with a living bench, a fainted bench and a trapped body', () => {
    const mismatches: string[] = [];
    for (const stat of STATS) {
      for (const stage of [-6, -3, -1, 1, 3, 6]) {
        for (const kind of ['living', 'fainted', 'trapped'] as const) {
          const b = board(mode, { bench: kind === 'fainted' ? 'fainted' : 'living', foeExtra: kind === 'trapped' ? { ability: trapper(mode) } : {} });
          const idle = b.battle.choose('p1', click(b.battle.sides[0], false, '')) && b.battle.choose('p2', click(b.battle.sides[1], false, ''));
          if (!idle || !settle(b)) { mismatches.push(`${kind}: the twin did not reach a request`); continue; }
          const holder = b.battle.sides[0].active[0];
          holder.boosts[stat] = stage;
          const free = canSwitchOut(b.battle, holder);
          const expected = stage > 0 || kind !== 'living';
          if (stageStands(b.battle, holder, stage) !== expected) mismatches.push(`${stat} ${stage}, ${kind}: stands ${!expected}`);
          if (free !== (kind === 'living')) mismatches.push(`${kind}: canSwitchOut ${free}`);
          if (stageStands(b.battle, holder, 0)) mismatches.push(`${stat}, ${kind}: stage 0 stands`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  test('a stage made by Intimidate: free with a living bench, held with a fainted bench or Shadow Tag on the foe\'s partner', () => {
    const intimidate = dex.abilities.get('intimidate').name;
    const mismatches: string[] = [];
    const cases: [string, BoardOptions, boolean][] = [
      ['living bench', { foeExtra: { ability: intimidate } }, true],
      ['fainted bench', { foeExtra: { ability: intimidate }, bench: 'fainted' }, false],
      ...(mode.doubles ? [['Shadow Tag on the partner', { foeExtra: { ability: intimidate }, foe2Extra: { ability: trapper(mode) } }, false] as [string, BoardOptions, boolean]] : []),
    ];
    for (const [label, options, free] of cases) {
      const b = board(mode, options);
      expect(b.battle.sides[0].active[0].boosts.atk).toBe(-1);
      const idle = b.battle.choose('p1', click(b.battle.sides[0], false, '')) && b.battle.choose('p2', click(b.battle.sides[1], false, ''));
      expect(idle && settle(b)).toBe(true);
      const holder = b.battle.sides[0].active[0];
      expect(holder.boosts.atk).toBe(-1);
      expect(stageStands(b.battle, holder, -1)).toBe(!free);
      judge(readAll(b, `Intimidate, ${label}`), mismatches);
    }
    expect(mismatches).toEqual([]);
  });
});

describe('the reading is a pure function of the battle', () => {
  test('a positive stage stands whoever holds it; stage 0 and a drop on a free holder do not', () => {
    const b = board(MODES[0], {});
    const holder = b.battle.sides[0].active[0];
    expect(stageStands(b.battle, holder, 2)).toBe(true);
    expect(stageStands(b.battle, holder, 0)).toBe(false);
    expect(stageStands(b.battle, holder, -2)).toBe(false);
  });
});
