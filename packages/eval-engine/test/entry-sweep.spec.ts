import { describe, expect, test } from 'vitest';
import { Battle as LiveBattle, Teams, type Battle, type PokemonSet } from '@pkmn/sim';
import { correctActivesFromProtocol } from '../src/branch/corrections';

/**
 * Round 78 (@pkmn 0.10.12): Gens 1 to 4 play their entry inside BattleActions#switchIn now; the gen 4 mod's runSwitch,
 * which ran EntryHazard and SwitchIn, is gone. EntryHazard brings the hazards, Healing Wish and Lunar Dance,
 * AfterSwitchInSelf the gen 1 and 2 status conditions, AfterEntryHazard the gen 3 weather abilities after turn 0, and a
 * Knocked-Off Pokémon drops a regained item. A body the boundary correction puts in (playEntry in entry-effects.ts) ran
 * only runSwitch, so in Gens 3 and 4 it took no Spikes or Stealth Rock. The sweep plays every Dex entry these events
 * reach, in each generation, two ways: the simulator's own entry (a replacement after a faint, or a switch at the
 * boundary), and the correction of a protocol that shows the same entry. The entering body and its side must match.
 * Gen 9 rows hold the path of Gens 5 on, where runSwitch plays the entry. (Gen 1 and 2 `residualdmg` is a volatile that a
 * switch-out clears, so no entering body carries it.)
 */

type Body = Battle['sides'][number]['pokemon'][number];

interface Row {
  gen: number;
  label: string;
  entering?: Partial<PokemonSet>;
  /** Run on both battles right before the entry: the side conditions, the weather, the entering body's state. */
  setup?: (battle: Battle, entering: Body) => void;
}

const set = (gen: number, species: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet => ({
  name: species, species, item: '', ability: gen >= 3 ? 'Keen Eye' : '', moves, nature: gen >= 3 ? 'Serious' : '', gender: '', level: 100,
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, ...extra,
});

const enteringName = (row: Row) => row.entering?.species ?? 'Snorlax';
const enteringBody = (row: Row, battle: Battle) => battle.sides[0].pokemon.find(body => body.species.name === enteringName(row))!;

/** Turn 1 played (Growl on both sides): the board stands at a boundary. */
function make(row: Row): Battle {
  const p1 = [set(row.gen, 'Tauros', ['Growl']), set(row.gen, enteringName(row), ['Growl', 'Rest'], row.entering)];
  const p2 = [set(row.gen, 'Starmie', ['Swift', 'Growl'])];
  const battle = new LiveBattle({
    formatid: `gen${row.gen}customgame` as never, seed: [1, 2, 3, 4],
    p1: { name: 'A', team: Teams.pack(p1) }, p2: { name: 'B', team: Teams.pack(p2) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 12');
    battle.choose('p2', 'team 1');
  }
  battle.choose('p1', 'move 1');
  battle.choose('p2', 'move 2');
  return battle;
}

/** Turn 2 with Tauros at 1 HP: Starmie's Swift K.O.s it, or Growl leaves it standing. */
function playTurnTwo(battle: Battle, knockOut: boolean) {
  battle.sides[0].active[0]!.hp = 1;
  battle.choose('p1', 'move 1');
  battle.choose('p2', knockOut ? 'move 1' : 'move 2');
}

const drain = (battle: Battle) => {
  while (battle.queue.list.length > 0) battle.runAction(battle.queue.shift()!);
};

/** The simulator's own entry: the replacement after Tauros's faint, or a switch at the boundary. */
function simulatorEntry(row: Row, afterFaint: boolean): Battle {
  const battle = make(row);
  if (afterFaint) {
    playTurnTwo(battle, true);
    expect(battle.sides[0].requestState, `${row.label}: Tauros fainted`).toBe('switch');
    row.setup?.(battle, enteringBody(row, battle));
    battle.choose('p1', 'switch 2');
  } else {
    row.setup?.(battle, enteringBody(row, battle));
    battle.actions.switchIn(enteringBody(row, battle), 0);
    drain(battle);
  }
  return battle;
}

/** The correction: the simulator kept Tauros on the field, the protocol shows the entry (after Tauros's faint). */
function correctedEntry(row: Row, afterFaint: boolean): Battle {
  const battle = make(row);
  if (afterFaint) playTurnTwo(battle, false);
  row.setup?.(battle, enteringBody(row, battle));
  const name = enteringName(row);
  correctActivesFromProtocol(battle as never, [...(afterFaint ? ['|faint|p1a: Tauros'] : []), `|switch|p1a: ${name}|${name}|100/100`]);
  return battle;
}

/** What an entry can change: the entering body and the side it entered. */
function entryState(battle: Battle) {
  const body = battle.sides[0].active[0]!;
  const side = battle.sides[0];
  return {
    species: body.species.name, hp: body.hp, status: body.status, statusStage: (body.statusState as { stage?: number }).stage ?? null,
    item: body.item, pp: body.moveSlots.map(slot => slot.pp), boosts: { ...body.boosts },
    sideConditions: Object.fromEntries(Object.entries(side.sideConditions).map(([id, state]) => [id, (state as { layers?: number }).layers ?? 1])),
    weather: battle.field.weather,
    // Gens 1 and 2 forget every active Pokémon's last move at an entry; later the foe's last move is the harness's own
    // (Swift for the faint, Growl where the correction keeps Tauros alive).
    foeLastMove: battle.gen <= 2 ? battle.sides[1].active[0]?.lastMove?.id ?? null : 'not an entry effect',
  };
}

const hazard = (id: string) => (battle: Battle) => {
  battle.sides[0].addSideCondition(id, battle.sides[1].active[0]!);
};
const wish = (id: string) => (battle: Battle, entering: Body) => {
  battle.sides[0].addSideCondition(id, battle.sides[0].active[0]!);
  entering.hp = Math.floor(entering.maxhp / 2);
  entering.status = 'par' as Body['status'];
  entering.statusState = battle.initEffectState({ id: 'par', target: entering });
  entering.moveSlots[0].pp = 0;
};
const status = (id: string) => (battle: Battle, entering: Body) => {
  entering.status = id as Body['status'];
  entering.statusState = battle.initEffectState({ id, target: entering });
  (entering.statusState as { stage?: number }).stage = 3;
};
const rain = (battle: Battle) => {
  battle.field.setWeather('raindance', 'debug' as never);
};
const knockedOff = (_battle: Battle, entering: Body) => {
  entering.itemKnockedOff = true;
};

const ROWS: Row[] = [
  ...[1, 2].flatMap(gen => ['brn', 'psn', 'tox'].map(id => ({ gen, label: `gen ${gen} ${id}`, setup: status(id) }))),
  { gen: 2, label: 'gen 2 spikes', setup: hazard('spikes') },
  { gen: 3, label: 'gen 3 spikes', setup: hazard('spikes') },
  ...['Drizzle', 'Drought'].map(ability => ({ gen: 3, label: `gen 3 ${ability}`, entering: { ability } })),
  // A Gen 3 replacement after a faint enters before the turn's residuals, so the sand would hit a body it can hurt in the
  // simulator's turn and not at the correction's boundary: Tyranitar, the Sand Stream holder, is immune to it.
  { gen: 3, label: 'gen 3 Sand Stream: Tyranitar', entering: { species: 'Tyranitar', ability: 'Sand Stream' } },
  ...['Air Lock', 'Cloud Nine'].map(ability => ({ gen: 3, label: `gen 3 ${ability} in rain`, entering: { ability }, setup: rain })),
  { gen: 3, label: 'gen 3 Forecast: Castform in rain', entering: { species: 'Castform', ability: 'Forecast' }, setup: rain },
  ...[3, 4].map(gen => ({ gen, label: `gen ${gen} a Knocked-Off body regained Leftovers`, entering: { item: 'Leftovers' }, setup: knockedOff })),
  ...['spikes', 'stealthrock', 'toxicspikes'].map(id => ({ gen: 4, label: `gen 4 ${id}`, setup: hazard(id) })),
  ...['healingwish', 'lunardance'].map(id => ({ gen: 4, label: `gen 4 ${id}`, setup: wish(id) })),
  ...['spikes', 'stealthrock', 'toxicspikes', 'stickyweb'].map(id => ({ gen: 9, label: `gen 9 ${id}`, setup: hazard(id) })),
  { gen: 9, label: 'gen 9 Drizzle', entering: { ability: 'Drizzle' } },
];

describe('a body the correction puts in plays the entry the simulator plays (round 78, @pkmn 0.10.12)', () => {
  for (const afterFaint of [true, false]) {
    test.each(ROWS.map(row => [row.label, row] as const))(`${afterFaint ? 'after a faint' : 'a switch at the boundary'}: %s`, (_label, row) => {
      expect(entryState(correctedEntry(row, afterFaint))).toEqual(entryState(simulatorEntry(row, afterFaint)));
    });
  }

  // Air Lock and Cloud Nine only announce themselves on a Gen 3 entry (their weather suppression is read later), so
  // their rows hold the entry to the simulator without changing a field of the board.
  const ANNOUNCING = ['gen 3 Air Lock in rain', 'gen 3 Cloud Nine in rain'];

  test('the rows are not empty: in every other row of Gens 1 to 4 the simulator\'s entry changes the body, its side or the field', () => {
    const bodyState = (battle: Battle) => ({ ...entryState(battle), pp: undefined });
    const quiet = ROWS.filter(row => row.gen <= 4 && !ANNOUNCING.includes(row.label)).flatMap(row => [true, false]
      .filter(afterFaint => {
        const before = make(row);
        if (afterFaint) playTurnTwo(before, true);
        row.setup?.(before, enteringBody(row, before));
        const body = enteringBody(row, before);
        const benched = {
          species: body.species.name, hp: body.hp, status: body.status, statusStage: (body.statusState as { stage?: number }).stage ?? null,
          item: body.item, boosts: { ...body.boosts }, sideConditions: bodyState(before).sideConditions, weather: before.field.weather,
          foeLastMove: bodyState(before).foeLastMove,
        };
        const entered = bodyState(simulatorEntry(row, afterFaint));
        return JSON.stringify({ ...entered, pp: undefined }) === JSON.stringify({ ...benched, pp: undefined })
          && JSON.stringify(entryState(simulatorEntry(row, afterFaint)).pp) === JSON.stringify(body.moveSlots.map(slot => slot.pp));
      })
      .map(afterFaint => `${row.label} (${afterFaint ? 'after a faint' : 'boundary'})`));
    expect(quiet).toEqual([]);
  });
});
