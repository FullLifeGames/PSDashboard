import { describe, expect, test } from 'vitest';
import { Battle, Dex, type PokemonSet } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { registerChampionsDex, type RulesDex } from '../src/rules-dex';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { contactBreakers } from '../src/inference/contact-tell';

if (!Dex.formats.get('gen9championscustomgame').exists) registerChampionsDex(championsMod as never, championsMod.Formats as never);

interface RuleSet { name: string; prefix: string; gen: number; champions?: boolean }
const RULESETS: RuleSet[] = [5, 6, 7, 8, 9].map(gen => ({ name: `Generation ${gen}`, prefix: `gen${gen}`, gen }))
  .concat([{ name: 'Champions mod', prefix: 'gen9champions', gen: 9, champions: true }]);
const dexOfRules = (rules: RuleSet): RulesDex => (rules.champions ? Dex.dexes.champions : Dex.forGen(rules.gen)) as RulesDex;

const mk = (species: string, o: Partial<PokemonSet> = {}): PokemonSet =>
  ({ name: species, species, ability: 'No Ability', item: '', moves: ['splash'], level: 100, evs: { hp: 252 }, ...o }) as PokemonSet;

const INERT = 'Light Ball';
const PADS = 'Protective Pads';
const HELMET = 'Rocky Helmet';

interface Scene {
  label: string;
  p1: PokemonSet[];
  p2: (item: string) => PokemonSet[];
  turns: [string, string][];
  judged: string;
  rules?: string;
  conservative?: string;
  ifHolderFaints?: boolean;
}

interface Setup {
  holder?: PokemonSet;
  reveal?: PokemonSet;
  judged?: Partial<PokemonSet>;
  bench?: PokemonSet[];
  teammate?: boolean;
  rules?: string;
  middle?: (ctx: Context) => [string, string][];
  strike?: (ctx: Context) => [string, string][];
  conservative?: string;
  ifHolderFaints?: boolean;
}

interface Context {
  pick: (first: string, second?: string) => string;
  aimed: (move: number, target: number) => string;
  swap: (singles: number, doubles: number) => string;
  hits: (move?: number) => [string, string];
}

const HOLDER_MOVES = ['splash', 'knockoff', 'embargo', 'magicroom', 'substitute'];

function scene(doubles: boolean, exists: boolean, label: string, setup: Setup = {}): Scene {
  const pick = (first: string, second = 'move 1') => (doubles ? `${first}, ${second}` : first);
  const aimed = (move: number, target: number) => `move ${move}${doubles ? ` ${target}` : ''}`;
  const swap = (singles: number, other: number) => pick(`switch ${doubles ? other : singles}`);
  const hits = (move = 1): [string, string] => [pick('move 1'), pick(aimed(move, 1))];
  const ctx: Context = { pick, aimed, swap, hits };
  const holder = setup.holder ?? mk('Snorlax', { item: HELMET, ability: 'Immunity', moves: HOLDER_MOVES });
  const reveal = setup.reveal ?? mk('Rattata', { ability: 'Guts', moves: ['tackle', 'knockoff'] });
  const filler = () => mk('Chansey', { moves: ['splash'] });
  const judgedSet = (item: string) => mk(setup.judged?.species ?? 'Raticate', { item, ability: 'Guts', moves: ['tackle', 'embargo'], ...setup.judged });
  const teammate = mk('Persian', { item: exists ? PADS : INERT, ability: 'Limber', moves: ['tackle'] });
  const turns: [string, string][] = [hits(), ...(setup.middle?.(ctx) ?? [[pick('move 1'), swap(2, 3)]]), ...(setup.strike?.(ctx) ?? [hits()])];
  return {
    label, judged: setup.judged?.species ?? 'Raticate', turns, rules: setup.rules, conservative: setup.conservative, ifHolderFaints: setup.ifHolderFaints,
    p1: doubles ? [holder, filler()] : [holder],
    p2: item => [...(doubles ? [reveal, filler(), judgedSet(item)] : [reveal, judgedSet(item)]), ...(setup.teammate ? [teammate] : []), ...(setup.bench ?? [])],
  };
}

function scenesOf(doubles: boolean, rules: RuleSet, exists: boolean): Scene[] {
  const make = (label: string, setup?: Setup) => scene(doubles, exists, label, setup);
  const scenes: Scene[] = [make('a contact hit')];
  scenes.push(make('a punch', {
    judged: { moves: ['machpunch'] },
    ...(rules.gen >= 9 ? { conservative: 'Punching Glove stops a punch too: two items explain it' } : {}),
  }));
  if (rules.gen >= 7) scenes.push(make('a Long Reach attacker', { judged: { species: 'Decidueye', ability: 'Long Reach', moves: ['leafblade'] } }));
  scenes.push(make('a Magic Guard attacker', { judged: { species: 'Clefable', ability: 'Magic Guard', moves: ['playrough'] } }));
  scenes.push(make('a Klutz holder whose helmet Frisk showed', {
    holder: mk('Lopunny', { item: HELMET, ability: 'Klutz', moves: HOLDER_MOVES }), reveal: mk('Banette', { ability: 'Frisk', moves: ['tackle'] }),
  }));
  scenes.push(make('Embargo on the holder', { strike: ({ pick, aimed, hits }) => [[pick('move 1'), pick(aimed(2, 1))], hits()] }));
  scenes.push(make('Magic Room before the hit', { middle: ({ pick, swap }) => [[pick('move 4'), swap(2, 3)]] }));
  scenes.push(make('the holder behind a Substitute', { middle: ({ pick, swap }) => [[pick('move 5'), swap(2, 3)]] }));
  scenes.push(make('the helmet knocked off after the reveal', {
    middle: ({ pick, aimed, swap }) => [[pick('move 1'), pick(aimed(2, 1))], [pick('move 1'), swap(2, 3)]],
  }));
  scenes.push(make('the holder faints in the hit', {
    holder: mk('Skarmory', { level: 1, item: HELMET, ability: 'Sturdy', moves: HOLDER_MOVES }), ifHolderFaints: true,
    conservative: 'a fainted holder gets no verdict',
  }));
  scenes.push(make('a party that may hold an Illusion user', { bench: [mk('Zoroark', { ability: 'Illusion' })], conservative: 'Illusion may hide who attacks' }));
  scenes.push(make('Sky Drop into a holder that does not fly', {
    judged: { moves: ['skydrop'] }, strike: ({ hits, pick, aimed }) => [hits(), [pick('move 1'), pick(rules.gen === 5 ? 'move 1' : aimed(1, 1))]],
  }));
  if (rules.gen >= 8) {
    scenes.push(make('a physical Shell Side Arm', {
      judged: { moves: ['shellsidearm'], evs: { atk: 252 }, nature: 'Adamant' },
      conservative: 'the move has no contact flag until the simulator turns it physical; a missed tell is no harm',
    }));
  }
  scenes.push(make('a later Knock Off that shows the attacker\'s item', {
    strike: ({ hits, pick, aimed }) => [hits(), [pick(aimed(2, 1)), pick(aimed(1, 1))]],
    conservative: 'the Knock Off names the item: it is revealed, never guessed',
  }));
  const shown = ({ pick, aimed, swap }: Context): [string, string][] => [[pick(aimed(2, 1)), swap(3, 4)], [pick('move 1'), swap(2, 3)]];
  scenes.push(make('a teammate showed Protective Pads, no Item Clause', { teammate: true, middle: shown }));
  scenes.push(make('a teammate showed Protective Pads under the Item Clause', {
    teammate: true, middle: shown, rules: 'Item Clause = 1', conservative: 'the Item Clause allows one Protective Pads and a teammate showed it',
  }));
  return scenes;
}

const orderOf = (team: PokemonSet[]) => team.map((_, index) => index + 1).join('');

function play(rules: RuleSet, doubles: boolean, found: Scene, item: string): string {
  const format = `${rules.prefix}${doubles ? 'doubles' : ''}customgame${found.rules ? `@@@${found.rules}` : ''}`;
  const p1 = found.p1;
  const p2 = found.p2(item);
  const battle = new Battle({ formatid: format as never, seed: [1, 2, 3, 4], p1: { name: 'Alpha', team: p1 as never }, p2: { name: 'Beta', team: p2 as never } });
  if (battle.requestState === 'teampreview') battle.makeChoices(`team ${orderOf(p1)}`, `team ${orderOf(p2)}`);
  for (const [first, second] of found.turns) {
    const before = battle.turn;
    battle.makeChoices(first, second);
    if (!battle.ended && battle.turn === before) throw new Error(`choice not taken in ${format}: "${first}" / "${second}"`);
  }
  const lines = battle.log;
  return lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
}

const toldPads = (log: string, species: string) => {
  const info = inferOpponentTeam(log, 'p2').pokemon.find(mon => mon.species === species);
  return info?.item.source === 'guessed' && info.item.value === PADS;
};
const chipped = (log: string, species: string) => new RegExp(`^\\|-damage\\|p2[ab]: ${species}\\|[^|]*\\|\\[from\\] item: ${HELMET}`, 'm').test(log);

describe('a contact hit into a shown Rocky Helmet that leaves the attacker unhurt tells the one item that stops contact', () => {
  for (const rules of RULESETS) {
    for (const doubles of [false, true]) {
      test(`${rules.name}, ${doubles ? 'doubles' : 'singles'}: the tell matches the simulator in every scene`, () => {
        const dex = dexOfRules(rules);
        const padsEntry = dex.items.get(PADS);
        const exists = padsEntry.exists && padsEntry.gen <= rules.gen;
        const problems: string[] = [];
        let told = 0;
        const scenes = scenesOf(doubles, rules, exists);
        for (const found of scenes) {
          let seeded: string;
          let inert: string;
          try {
            seeded = play(rules, doubles, found, exists ? PADS : '');
            inert = play(rules, doubles, found, INERT);
          } catch (error) {
            problems.push(`${found.label}: ${(error as Error).message}`);
            continue;
          }
          const padsTold = toldPads(seeded, found.judged);
          if (padsTold) told++;
          if (toldPads(inert, found.judged)) problems.push(`${found.label}: tells Protective Pads for an attacker that chipped the helmet`);
          const faints = !found.ifHolderFaints || /^\|faint\|p1[ab]: /m.test(seeded);
          const unjudged = rules.champions || (found.conservative && faints);
          const expected = exists && !unjudged && !chipped(seeded, found.judged) && chipped(inert, found.judged);
          if (padsTold !== expected) problems.push(`${found.label}: ${padsTold ? 'tells' : 'does not tell'} Protective Pads, the simulator says ${expected ? 'yes' : 'no'}`);
        }
        expect(problems).toEqual([]);
        if (exists && !rules.champions) expect(told).toBeGreaterThan(0);
      });
    }
  }
});

function silent(rules: RuleSet, attacker: PokemonSet, holder: PokemonSet): boolean {
  const format = `${rules.prefix}customgame`;
  const battle = new Battle({ formatid: format as never, seed: [1, 2, 3, 4], p1: { name: 'Alpha', team: [holder] as never }, p2: { name: 'Beta', team: [attacker] as never } });
  if (battle.requestState === 'teampreview') battle.makeChoices('team 1', 'team 1');
  battle.makeChoices('move 1', 'move 1');
  const hit = battle.log.some(line => line.startsWith('|-damage|p1a: ') && !line.includes('[from]'));
  return hit && !battle.log.some(line => line.includes(`[from] item: ${HELMET}`));
}

const holderOf = (ability = 'Immunity') => mk('Snorlax', { item: HELMET, ability, moves: ['splash'] });
const legal = (rules: RuleSet) => (entry: { exists: boolean; gen: number }) => entry.exists && entry.gen <= rules.gen;

describe('the Dex lists the items that take contact away', () => {
  test.each(RULESETS)('$name: every item of the Dex plays Tackle, and every item that modifies a move plays Mach Punch, against a Rocky Helmet', rules => {
    const dex = dexOfRules(rules);
    const items = dex.items.all().filter(legal(rules));
    const silentFor = (move: string, pool: typeof items) => pool.filter(item => !item.isNonstandard
      && silent(rules, mk('Rattata', { item: item.name, ability: 'Guts', moves: [move] }), holderOf())).map(item => item.id);
    const pads = rules.gen >= 7 && !rules.champions ? ['protectivepads'] : [];
    expect(contactBreakers(dex, 'Tackle')).toEqual(pads);
    expect([...contactBreakers(dex, 'Mach Punch')].sort()).toEqual([...pads, ...(rules.gen >= 9 && !rules.champions ? ['punchingglove'] : [])]);
    expect(contactBreakers(dex, 'Tackle')).toEqual(silentFor('Tackle', items));
    expect(contactBreakers(dex, 'Mach Punch')).toEqual(silentFor('Mach Punch', items.filter(item => 'onModifyMove' in item || contactBreakers(dex, 'Tackle').includes(item.id))));
  });

  test.each(RULESETS)('$name: the abilities that keep the helmet damage off the attacker and off the holder', rules => {
    const dex = dexOfRules(rules);
    const abilities = dex.abilities.all().filter(legal(rules));
    const attackers = abilities.filter(ability => silent(rules, mk('Rattata', { ability: ability.name, moves: ['tackle'] }), holderOf())).map(ability => ability.id);
    const holders = abilities.filter(ability => silent(rules, mk('Rattata', { ability: 'Guts', moves: ['tackle'] }), holderOf(ability.name))).map(ability => ability.id);
    expect({ attackers, holders }).toEqual({ attackers: [...(rules.gen >= 7 ? ['longreach'] : []), 'magicguard'].sort(), holders: ['klutz'] });
  });
});
