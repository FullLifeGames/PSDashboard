import { test, expect } from '@playwright/test';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { advancePosition, createRootPosition, positionBattle, serializeBattleStable } from '../src/lib/eval/forward-model';
import { evaluatePosition } from '../src/lib/eval/eval-function';

/**
 * Mechanics the expert-feedback round put on trial (2026-08-15, 655336
 * t23/t24 anomalies): Intimidate drops, Dragon Dance boosts, Regenerator,
 * Rocky Helmet, and hazard re-entry. All five behave — the verdict
 * anomalies were VALUATION gaps (active-side re-entry blindness, inert
 * sweep weight; ledger + agenda item ④), not broken mechanics. These pins
 * keep the acquittal honest: each mechanic through the search's own
 * advance/round-trip path, plus the static-eval reactions that exist.
 */

function makeSet(name: string, species: string, moves: string[], extra?: Partial<PokemonSet>): PokemonSet {
  return {
    name, species, item: '', ability: 'No Ability', moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50, gender: '',
    ...extra,
  };
}

function makeBattle(p1Sets: PokemonSet[], p2Sets: PokemonSet[]): Battle {
  const battle = new Battle({
    formatid: toID('gen6customgame'),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
    p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1Sets.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2Sets.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

const serialize = (battle: Battle) => JSON.stringify(State.serializeBattle(battle));

test.describe('searched mechanics stay honest', () => {
  test('Intimidate drops the foe attack on a searched switch-in', () => {
    const root = createRootPosition(serialize(makeBattle(
      [makeSet('Snorlax', 'Snorlax', ['Protect']), makeSet('Gyarados', 'Gyarados', ['Protect'], { ability: 'Intimidate' })],
      [makeSet('Lopunny', 'Lopunny', ['Protect'])],
    )));
    const child = positionBattle(advancePosition(root, 'switch 2', 'move protect', '1,2,3,4'));
    expect(child.sides[0].active[0]!.species.name).toBe('Gyarados');
    expect(child.sides[1].active[0]!.boosts.atk).toBe(-1);
  });

  test('Dragon Dance grants +1/+1 through advance and the static eval pays a premium', () => {
    const mkRoot = () => createRootPosition(serialize(makeBattle(
      [makeSet('Dragonite', 'Dragonite', ['Dragon Dance', 'Splash'])],
      [makeSet('Chansey', 'Chansey', ['Protect'])],
    )));
    const afterDD = advancePosition(mkRoot(), 'move dragondance', 'move protect', '1,2,3,4');
    const ddBattle = positionBattle(afterDD);
    expect(ddBattle.sides[0].active[0]!.boosts.atk).toBe(1);
    expect(ddBattle.sides[0].active[0]!.boosts.spe).toBe(1);
    // Isolated 1v1: the boost flips the Chansey matchup — flat stage term
    // plus matchup flip paid ~+0.29 when pinned. Directional guard only,
    // so weight tuning cannot break the pin.
    const afterNoop = advancePosition(mkRoot(), 'move splash', 'move protect', '1,2,3,4');
    expect(evaluatePosition(positionBattle(afterDD))).toBeGreaterThan(evaluatePosition(positionBattle(afterNoop)));
  });

  test('Regenerator heals a third on a searched switch-out', () => {
    const battle = makeBattle(
      [makeSet('Chansey', 'Chansey', ['Protect'])],
      [makeSet('Slowbro', 'Slowbro', ['Protect'], { ability: 'Regenerator' }), makeSet('Lopunny', 'Lopunny', ['Protect'])],
    );
    const bro = battle.sides[1].active[0]!;
    bro.hp = Math.floor(bro.maxhp * 0.4);
    const child = positionBattle(advancePosition(createRootPosition(serialize(battle)), 'move protect', 'switch 2', '1,2,3,4'));
    const benched = child.sides[1].pokemon.find(pokemon => pokemon.species.name === 'Slowbro')!;
    expect(benched.hp).toBe(Math.min(bro.maxhp, Math.floor(bro.maxhp * 0.4) + Math.floor(bro.maxhp / 3)));
  });

  test('Rocky Helmet chips a searched contact attacker by a sixth — and not through Protect', () => {
    const protectedTurn = positionBattle(advancePosition(createRootPosition(serialize(makeBattle(
      [makeSet('Lopunny', 'Lopunny', ['Pound'])],
      [makeSet('Skarmory', 'Skarmory', ['Protect'], { item: 'Rocky Helmet' })],
    ))), 'move pound', 'move protect', '1,2,3,4'));
    const shielded = protectedTurn.sides[0].active[0]!;
    expect(shielded.hp).toBe(shielded.maxhp);

    const contactTurn = positionBattle(advancePosition(createRootPosition(serialize(makeBattle(
      [makeSet('Lopunny', 'Lopunny', ['Pound'])],
      [makeSet('Skarmory', 'Skarmory', ['Roost'], { item: 'Rocky Helmet' })],
    ))), 'move pound', 'move roost', '1,2,3,4'));
    const chipped = contactTurn.sides[0].active[0]!;
    expect(chipped.maxhp - chipped.hp).toBe(Math.floor(chipped.maxhp / 6));
  });

  test('a benched mon below hazard-entry HP stops counting (effHp 0)', () => {
    // SR+Spikes set up for real; the benched Lopunny at 10% sits below its
    // entry damage — the wincon-vs-hazards rule prices it as disabled
    // (pinned at ~0.44 toward p1; directional guard only).
    const build = () => {
      const battle = makeBattle(
        [makeSet('Skarmory', 'Skarmory', ['Stealth Rock', 'Spikes'])],
        [makeSet('Slowbro', 'Slowbro', ['Protect']), makeSet('Lopunny', 'Lopunny', ['Protect'])],
      );
      battle.choose('p1', 'move stealthrock'); battle.choose('p2', 'move protect');
      battle.choose('p1', 'move spikes'); battle.choose('p2', 'move protect');
      return battle;
    };
    const healthy = build();
    const hurt = build();
    const benched = hurt.sides[1].pokemon.find(pokemon => pokemon.species.name === 'Lopunny')!;
    benched.hp = Math.floor(benched.maxhp * 0.10);
    const evHealthy = evaluatePosition(positionBattle(createRootPosition(serializeBattleStable(healthy))));
    const evHurt = evaluatePosition(positionBattle(createRootPosition(serializeBattleStable(hurt))));
    expect(evHurt).toBeGreaterThan(evHealthy);
  });
});
