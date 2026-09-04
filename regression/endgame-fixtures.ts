import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';

/**
 * Synthetic endgames for the round-34 truth bench: small positions (at
 * most three living bodies) whose exact value the solver can reach and
 * whose shape names one estimator weakness each (fixed-damage races,
 * accuracy kills, walls against breakers, stall, PP locks, priority,
 * level gaps, two against one, and the doubles counterparts). Singles
 * run on gen9customgame, doubles on gen9doublescustomgame.
 */
export interface EndgameFixture {
  name: string;
  about: string;
  gameType: 'singles' | 'doubles';
  build: () => Battle;
}

function makeSet(
  name: string,
  species: string,
  moves: string[],
  level = 100,
  extras: { item?: string; ability?: string } = {},
): PokemonSet {
  return {
    name, species, item: extras.item ?? '', ability: extras.ability ?? 'No Ability', moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level, gender: '',
  };
}

function makeBattle(p1Sets: PokemonSet[], p2Sets: PokemonSet[], formatid = 'gen9customgame'): Battle {
  const battle = new Battle({
    formatid: toID(formatid),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
    p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  return battle;
}

/** Sets the first active's HP per side; null keeps full HP. */
function withHp(battle: Battle, hp: [number | null, number | null]): Battle {
  hp.forEach((value, index) => {
    if (value !== null) battle.sides[index].active[0]!.sethp(value);
  });
  return battle;
}

/** A level-5 partner that faints before the position is taken (the sim refuses one-mon doubles teams). */
const filler = (name: string): PokemonSet => makeSet(name, 'Pikachu', ['Tackle'], 5);

/** Faints the second slot of the named sides so the doubles board holds the living bodies the fixture names. */
function faintPartners(battle: Battle, sides: number[]): Battle {
  for (const index of sides) battle.sides[index].active[1]!.faint();
  battle.faintMessages();
  return battle;
}

/** A doubles 1v1: two-mon teams whose partners are fainted. */
function doublesPair(p1: PokemonSet, p2: PokemonSet, hp: [number | null, number | null] = [null, null]): Battle {
  const battle = makeBattle([p1, filler('Pika')], [p2, filler('Chu')], 'gen9doublescustomgame');
  return withHp(faintPartners(battle, [0, 1]), hp);
}

const singles = (name: string, about: string, build: () => Battle): EndgameFixture => ({ name, about, gameType: 'singles', build });
const doubles = (name: string, about: string, build: () => Battle): EndgameFixture => ({ name, about, gameType: 'doubles', build });

const toss = () => makeSet('Toss', 'Machamp', ['Seismic Toss']);
const shade = () => makeSet('Shade', 'Machamp', ['Night Shade']);
const champ = (name = 'Champ') => makeSet(name, 'Machamp', ['Close Combat']);
const jolt = () => makeSet('Jolt', 'Jolteon', ['Thunder']);
const pexWall = () => makeSet('Pex', 'Toxapex', ['Recover', 'Haze']);
const bandZapdos = () => makeSet('Zap', 'Zapdos-Galar', ['Stomping Tantrum', 'Close Combat'], 100, { item: 'Choice Band' });
const speedNite = () => makeSet('Nite', 'Dragonite', ['Extreme Speed']);
const weavile = () => makeSet('Weav', 'Weavile', ['Icicle Crash']);
const eevee = () => makeSet('Eevee', 'Eevee', ['Tackle'], 30);
const chompQuake = () => makeSet('Chomp', 'Garchomp', ['Earthquake']);
const pexRecover = () => makeSet('Pex', 'Toxapex', ['Recover', 'Scald']);
const blobHeal = () => makeSet('Blob', 'Blissey', ['Soft-Boiled', 'Seismic Toss']);

export const ENDGAME_FIXTURES: EndgameFixture[] = [
  singles('toss-race-2v3', 'Fixed damage, p1 needs two hits, p2 three',
    () => withHp(makeBattle([toss()], [shade()]), [250, 200])),
  singles('toss-race-even', 'Fixed damage, both need two hits, equal speed',
    () => withHp(makeBattle([toss()], [shade()]), [200, 200])),
  singles('ohko-tie', 'Mutual sure OHKO at equal speed',
    () => withHp(makeBattle([champ('A')], [champ('B')]), [1, 1])),
  singles('thunder-70', '70 % kill first, sure kill second',
    () => withHp(makeBattle([jolt()], [champ()]), [1, 1])),
  singles('focus-blast-range', '70 % move in a 2HKO range against a sure 3HKO',
    () => makeBattle([makeSet('Gar', 'Gengar', ['Focus Blast'])], [makeSet('Blob', 'Blissey', ['Seismic Toss'])])),
  singles('healer-vs-band', 'Recover wall against a Choice Band breaker',
    () => makeBattle([pexWall()], [bandZapdos()])),
  singles('healer-burned', 'Same wall, burned', () => {
    const battle = makeBattle([pexWall()], [bandZapdos()]);
    battle.sides[0].active[0]!.setStatus('brn');
    return battle;
  }),
  singles('toxic-stall', 'Toxic plus heal against a breaker without recovery',
    () => makeBattle([makeSet('Blob', 'Blissey', ['Toxic', 'Soft-Boiled'])], [makeSet('Chomp', 'Garchomp', ['Earthquake', 'Swords Dance'])])),
  singles('struggle-lock', 'Last PP of the only attack', () => {
    const battle = makeBattle([makeSet('Zap', 'Zapdos', ['Thunderbolt'])], [makeSet('Pex', 'Toxapex', ['Recover'])]);
    battle.sides[0].active[0]!.moveSlots[0].pp = 1;
    return battle;
  }),
  singles('priority-race', 'Priority beats speed at low HP',
    () => withHp(makeBattle([speedNite()], [weavile()]), [30, 30])),
  singles('speed-tie-2hko', 'Mutual 2HKO at equal speed',
    () => withHp(makeBattle([chompQuake()], [makeSet('Chomp2', 'Garchomp', ['Earthquake'])]), [150, 150])),
  singles('level-gap', 'Level 100 sure OHKO against level 30',
    () => makeBattle([champ()], [eevee()])),
  singles('fixed-vs-ghost', 'Fixed damage into a Ghost',
    () => makeBattle([makeSet('Egg', 'Chansey', ['Seismic Toss'])], [makeSet('Gar', 'Gengar', ['Shadow Ball'])])),
  singles('choice-locked', 'Scarf lock into an immune target', () => {
    // One played turn sets the lock: Earthquake into Corviknight, Roost back.
    const battle = makeBattle(
      [makeSet('Chomp', 'Garchomp', ['Earthquake', 'Stone Edge'], 100, { item: 'Choice Scarf' })],
      [makeSet('Corv', 'Corviknight', ['Brave Bird', 'Roost'])],
    );
    battle.choose('p1', 'move earthquake');
    battle.choose('p2', 'move roost');
    return battle;
  }),
  singles('two-v-one-sack', 'Two bodies, one must be sacrificed',
    () => makeBattle([pexRecover(), blobHeal()], [makeSet('Champ', 'Machamp', ['Close Combat', 'Knock Off'])])),
  singles('two-v-one-switch-loop', 'Switching back and forth is legal but PP-free',
    () => makeBattle([makeSet('Pex', 'Toxapex', ['Recover']), makeSet('Corv', 'Corviknight', ['Roost'])], [chompQuake()])),
  singles('one-v-two-breaker', 'One breaker against two walls',
    () => makeBattle([makeSet('Chomp', 'Garchomp', ['Swords Dance', 'Earthquake'])], [makeSet('Pex', 'Toxapex', ['Recover']), makeSet('Blob', 'Blissey', ['Soft-Boiled'])])),
  singles('setup-vs-heal', 'Setup race against a healer',
    () => makeBattle([makeSet('Nite', 'Dragonite', ['Dragon Dance', 'Dragon Claw'])], [makeSet('Pex', 'Toxapex', ['Recover', 'Toxic'])])),
  doubles('doubles-toss-race', 'Doubles 1v1 fixed-damage race',
    () => doublesPair(toss(), shade(), [250, 200])),
  doubles('doubles-ohko-tie', 'Doubles 1v1 mutual sure KO',
    () => doublesPair(champ('A'), champ('B'), [1, 1])),
  doubles('doubles-thunder-70', 'Doubles 1v1 accuracy kill',
    () => doublesPair(jolt(), champ(), [1, 1])),
  doubles('doubles-healer-vs-band', 'Doubles 1v1 wall against a breaker',
    () => doublesPair(pexWall(), bandZapdos())),
  doubles('doubles-spread-2v1', 'Doubles two against one with a spread move',
    () => faintPartners(makeBattle([chompQuake(), makeSet('Corv', 'Corviknight', ['Roost'])], [champ(), filler('Chu')], 'gen9doublescustomgame'), [1])),
  doubles('doubles-1v2-spread', 'Doubles one against two, Earthquake hits both',
    () => faintPartners(makeBattle([chompQuake(), filler('Pika')], [makeSet('Pex', 'Toxapex', ['Recover']), makeSet('Blob', 'Blissey', ['Soft-Boiled'])], 'gen9doublescustomgame'), [0])),
  doubles('doubles-priority', 'Doubles 1v1 priority at low HP',
    () => doublesPair(speedNite(), weavile(), [30, 30])),
  doubles('doubles-level-gap', 'Doubles 1v1 level gap',
    () => doublesPair(champ(), eevee())),
];
