import type { Battle, ID, Pokemon } from '@pkmn/sim';
import { copyOf, FixedDice } from '../sim-ask/index.ts';
import { playResiduals, slotsOf } from './residuals.ts';
import { damageOf } from './status-factor.ts';
import { MAX_PRICED_HITS, NO_COST, type HitCost, type StatusCost } from './contact-cost.ts';

// Dice are quantiles: every draw of one hit answers the same u, on the grid u = (k + 1/2) / 20, so a chance fires in
// exactly the share of the grid below its chance. Each hit is played at full HP: the chip is the effect, not a rest.

const GRID = 20;
const PROBES = [1, 18];
const MIDDLE = 9;
const quantileOf = (index: number): number => (index + 0.5) / GRID;

const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

interface Setup { copy: Battle; attacker: Pokemon; defender: Pokemon }

const counterpart = (battle: Battle, copy: Battle, pokemon: Pokemon): Pokemon =>
  copy.sides[battle.sides.indexOf(pokemon.side)].pokemon[pokemon.side.pokemon.indexOf(pokemon)];

// Seats a benched body as the simulator's switch does (team order, positions, active list), without switch-in events.
function bringIn(pokemon: Pokemon): void {
  if (pokemon.isActive) return;
  const { side } = pokemon;
  const slot = Math.max(0, side.active.findIndex(entry => !!entry && !entry.fainted));
  const out = side.active[slot];
  const into = side.pokemon.indexOf(pokemon);
  const outOf = out ? side.pokemon.indexOf(out) : -1;
  if (out && outOf >= 0) {
    side.pokemon[into] = out;
    side.pokemon[outOf] = pokemon;
    out.position = into;
    pokemon.position = outOf;
    out.isActive = false;
  }
  pokemon.isActive = true;
  side.active[slot] = pokemon;
}

// `neutral`: no item, no ability, a foe of the typeless type, so what a move costs its user is its own cost.
function prepare(battle: Battle, attacker: Pokemon, defender: Pokemon, neutral = false): Setup {
  const copy = copyOf(battle);
  (copy as unknown as { debugMode: boolean }).debugMode = false;
  const setup = { copy, attacker: counterpart(battle, copy, attacker), defender: counterpart(battle, copy, defender) };
  bringIn(setup.attacker);
  bringIn(setup.defender);
  // Every body on the field plays at full HP: the memo's key leaves the HP of the actives out (score/board-key.ts).
  for (const side of copy.sides) for (const body of side.active) if (body && !body.fainted) body.hp = body.maxhp;
  setup.attacker.hp = setup.attacker.maxhp;
  setup.defender.hp = setup.defender.maxhp;
  if (neutral) {
    for (const body of [setup.attacker, setup.defender]) {
      body.item = '' as ID;
      body.ability = 'noability' as ID;
    }
    setup.defender.setType('???');
  }
  return setup;
}

interface Run {
  /** The HP the hit took, as a share of the attacker's max HP. */
  lost: number;
  /** The status the hit left on the attacker, or the item it took over (the foe's Sticky Barb), or ''. */
  label: string;
  setup: Setup;
}

const SPREAD = new Set(['allAdjacentFoes', 'allAdjacent']);

// The hit is sure and the move's own precondition is off (Sucker Punch, Fake Out, Poltergeist): races price these.
// A spread move hits the one foe of the pair (a 1v1 race).
function strike({ copy, attacker, defender }: Setup, moveId: string): void {
  const move = copy.dex.getActiveMove(moveId);
  move.accuracy = true;
  move.onTry = undefined;
  if (SPREAD.has(move.target)) move.target = 'normal';
  copy.actions.useMove(move, attacker, { target: defender });
}

function playRun(battle: Battle, attacker: Pokemon, defender: Pokemon, moveId: string, quantile: number, neutral = false): Run {
  const setup = prepare(battle, attacker, defender, neutral);
  const { copy } = setup;
  const mine = setup.attacker;
  copy.prng = new FixedDice({ quantile });
  const hp = mine.hp;
  const status = mine.status;
  const item = mine.item;
  let healed = 0;
  const heal = copy.heal.bind(copy);
  copy.heal = ((...args: Parameters<Battle['heal']>) => {
    const done = heal(...args);
    if (args[1] === mine && typeof done === 'number' && done > 0) healed += done;
    return done;
  }) as Battle['heal'];
  strike(setup, moveId);
  // A charging move (Fly, Dig, Skull Bash) strikes on its second turn: the move finds its own volatile there.
  if (mine.volatiles['twoturnmove'] && !setup.defender.fainted) strike(setup, moveId);
  const label = mine.status !== status ? mine.status : (mine.item && mine.item !== item ? `item:${mine.item}` : '');
  return { lost: Math.max(0, hp - mine.hp + healed) / mine.maxhp, label, setup };
}

function endOfTurn({ copy, attacker }: Setup): number {
  const bodies = slotsOf(copy);
  return playResiduals(copy, bodies)[bodies.indexOf(attacker)] ?? 0;
}

function turnsActed(run: Run, moveId: string, quantile: number): boolean[] {
  const copy = copyOf(run.setup.copy);
  (copy as unknown as { debugMode: boolean }).debugMode = false;
  const attacker = counterpart(run.setup.copy, copy, run.setup.attacker);
  const defender = counterpart(run.setup.copy, copy, run.setup.defender);
  copy.prng = new FixedDice({ quantile });
  // The status is put on again under this play's dice: the hit's own draws would give the same low quantile every time.
  attacker.clearStatus();
  attacker.setStatus(run.label, defender);
  const move = copy.dex.getActiveMove(moveId);
  return Array.from({ length: MAX_PRICED_HITS }, () => !!copy.runEvent('BeforeMove', attacker, defender, move));
}

// undefined where the status never stops a move at the two probes (a burn, a poison).
function actsOf(run: Run, moveId: string): number[] | undefined {
  try {
    const probes = PROBES.map(point => turnsActed(run, moveId, quantileOf(point)));
    if (probes.every(turns => turns.every(Boolean))) return undefined;
    const grid = Array.from({ length: GRID }, (_, point) => (PROBES.includes(point) ? probes[PROBES.indexOf(point)] : turnsActed(run, moveId, quantileOf(point))));
    return Array.from({ length: MAX_PRICED_HITS }, (_, turn) => mean(grid.map(turns => (turns[turn] ? 1 : 0))));
  } catch {
    return undefined;
  }
}

function costOfLabel(run: Run, moveId: string, baseline: () => number): { chip: number; output: number; acts?: number[] } {
  const { copy, attacker, defender } = run.setup;
  let output = 1;
  if (attacker.status && run.label === attacker.status) {
    const statused = damageOf(copy, attacker, defender, moveId);
    const status = attacker.status;
    attacker.status = '';
    const plain = damageOf(copy, attacker, defender, moveId);
    attacker.status = status;
    if (plain > 0) output = statused / plain;
  }
  const acts = attacker.status && run.label === attacker.status ? actsOf(run, moveId) : undefined;
  return { chip: endOfTurn(run.setup) - baseline(), output, ...(acts ? { acts } : {}) };
}

/** Whether the move costs its user HP by itself, found by playing it on a bare pair (Chloroblast has no Dex field). */
export function hurtsItsUser(battle: Battle, attacker: Pokemon, defender: Pokemon, moveId: string): boolean {
  try {
    return playRun(battle, attacker, defender, moveId, quantileOf(MIDDLE), true).lost > 0;
  } catch {
    return false;
  }
}

const deterministic = (probes: readonly Run[], rollsHits: boolean): boolean =>
  !rollsHits && probes.every(run => run.label === probes[0].label);

/** One hit played on copies, unmemoized, unfiltered; NO_COST where the play fails; `onRun` hears copies. */
export function playHit(battle: Battle, attacker: Pokemon, defender: Pokemon, moveId: string, onRun?: () => void): HitCost {
  try {
    const rollsHits = !!battle.dex.moves.getByID(moveId as ID).multihit;
    const run = (point: number): Run => {
      onRun?.();
      return playRun(battle, attacker, defender, moveId, quantileOf(point));
    };
    const probes = PROBES.map(run);
    const runs = deterministic(probes, rollsHits)
      ? probes
      : Array.from({ length: GRID }, (_, point) => (PROBES.includes(point) ? probes[PROBES.indexOf(point)] : run(point)));
    let baseline: number | undefined;
    const before = (): number => (baseline ??= endOfTurn(prepare(battle, attacker, defender)));
    const statuses: StatusCost[] = [];
    for (const label of [...new Set(runs.map(entry => entry.label))].filter(Boolean).sort()) {
      const chance = runs.filter(entry => entry.label === label).length / runs.length;
      statuses.push({ status: label, chance, ...costOfLabel(runs.find(entry => entry.label === label)!, moveId, before) });
    }
    const lost = mean(runs.map(entry => entry.lost));
    return lost === 0 && statuses.length === 0 ? NO_COST : { chip: lost, statuses };
  } catch {
    return NO_COST;
  }
}
