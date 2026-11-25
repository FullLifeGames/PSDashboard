import { test, expect, describe } from 'vitest';
import { Battle, Teams, toID, type PokemonSet, Dex } from '@pkmn/sim';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import type { LoggedHit } from '../src/types';
import { buildTeamsFromReplay } from '../src/team-builder';

// A `|cant|` line that names a move books it like a `|move|` line: the move never ran, so the log shows it only there.
// A blocker's `[of]` line (Dazzling, Queenly Majesty, Armor Tail, Damp) books the move once for the stopped attacker.

function mon(species: string, ability: string, moves: string[], spe = 0, item = 'Leftovers'): PokemonSet {
  return {
    name: species, species, item, ability, moves, nature: 'Serious', gender: '', level: 100,
    evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 0, spe }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  };
}

type Format = 'singles' | 'doubles';
const FORMATS: Format[] = ['singles', 'doubles'];

function play(format: Format, p1: PokemonSet[], p2: PokemonSet[], turns: [string, string][]): string {
  const battle = new Battle({
    formatid: toID(format === 'doubles' ? 'gen9doublescustomgame' : 'gen9customgame'), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  for (const [first, second] of turns) {
    battle.choose('p1', first);
    battle.choose('p2', second);
  }
  const lines = battle.log;
  return lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
}

const SPLASH = mon('Chansey', 'Natural Cure', ['Splash']);
function scene(format: Format, lead: PokemonSet, tested: PokemonSet, turns: [string, string][]) {
  const doubles = format === 'doubles';
  const p1 = doubles ? [lead, SPLASH] : [lead];
  const p2 = doubles ? [tested, mon('Skarmory', 'Sturdy', ['Splash'])] : [tested];
  const fit = (choices: [string, string]): [string, string] => (doubles
    ? [`${choices[0]}, move splash`, `${choices[1]}, move splash`] : choices);
  return play(format, p1, p2, turns.map(fit));
}

const movesOf = (log: string, species: string) =>
  inferOpponentTeam(log, 'p2').pokemon.find(entry => entry.species === species)?.moves.map(move => move.name) ?? [];

describe('a move a blocker stopped is booked from the |cant| line', () => {
  const taunter = mon('Landorus-Therian', 'Intimidate', ['Taunt', 'Earthquake'], 252);

  test.each(FORMATS)('%s: Taunt stops Stealth Rock before it is used, and the set has it', format => {
    const body = mon('Landorus-Therian', 'Intimidate', ['Stealth Rock', 'U-turn']);
    const log = scene(format, taunter, body, [[format === 'doubles' ? 'move taunt 1' : 'move taunt', 'move stealthrock']]);
    expect(log).toMatch(/\|cant\|p2a: Landorus\|move: Taunt\|Stealth Rock/);
    expect(log).not.toMatch(/\|move\|p2a: Landorus\|/);
    expect(movesOf(log, 'Landorus-Therian')).toEqual(['Stealth Rock']);
  });

  test.each(FORMATS)('%s: Imprison stops the move both sides carry', format => {
    const imprisoner = mon('Alakazam', 'Magic Guard', ['Imprison', 'Psychic'], 252);
    const body = mon('Garchomp', 'Rough Skin', ['Psychic', 'Earthquake']);
    const log = scene(format, imprisoner, body, [['move imprison', 'move psychic' + (format === 'doubles' ? ' 1' : '')]]);
    expect(log).toMatch(/\|cant\|p2a: Garchomp\|move: Imprison\|Psychic/);
    expect(movesOf(log, 'Garchomp')).toEqual(['Psychic']);
  });

  test.each(FORMATS)('%s: a blocked move that was used before stays one entry', format => {
    const body = mon('Landorus-Therian', 'Intimidate', ['Stealth Rock', 'U-turn']);
    const blocker = mon('Landorus-Therian', 'Intimidate', ['Taunt', 'Earthquake'], 252);
    const log = scene(format, blocker, body, [
      ['move earthquake', 'move stealthrock'],
      [format === 'doubles' ? 'move taunt 1' : 'move taunt', 'move stealthrock'],
    ]);
    expect(log).toMatch(/\|move\|p2a: Landorus\|Stealth Rock/);
    expect(log).toMatch(/\|cant\|p2a: Landorus\|move: Taunt\|Stealth Rock/);
    expect(movesOf(log, 'Landorus-Therian')).toEqual(['Stealth Rock']);
  });
});

describe('a blocker\'s line books the stopped move for the attacker and nothing for the blocker', () => {
  test.each(FORMATS)('%s: Dazzling stops Sucker Punch; Sucker Punch is Kingambit\'s, not Bruxish\'s', format => {
    const bruxish = mon('Bruxish', 'Dazzling', ['Psychic Fangs'], 252);
    const kingambit = mon('Kingambit', 'Defiant', ['Sucker Punch', 'Iron Head']);
    const log = scene(format, bruxish, kingambit, [['move psychicfangs' + (format === 'doubles' ? ' 1' : ''), 'move suckerpunch' + (format === 'doubles' ? ' 1' : '')]]);
    expect(log).toMatch(/\|cant\|p1a: Bruxish\|ability: Dazzling\|Sucker Punch\|\[of\] p2a: Kingambit/);
    expect(movesOf(log, 'Kingambit')).toEqual(['Sucker Punch']);
  });

  test('the blocker is the opponent: the move it stopped is not a move of its set', () => {
    const bruxish = mon('Bruxish', 'Dazzling', ['Psychic Fangs'], 252);
    const kingambit = mon('Kingambit', 'Defiant', ['Sucker Punch', 'Iron Head']);
    const log = play('singles', [kingambit], [bruxish], [['move suckerpunch', 'move psychicfangs']]);
    expect(log).toMatch(/\|cant\|p2a: Bruxish\|ability: Dazzling\|Sucker Punch\|\[of\] p1a: Kingambit/);
    expect(movesOf(log, 'Bruxish')).toEqual(['Psychic Fangs']);
  });

  test('doubles: Armor Tail on the partner\'s side books Fake Out for the attacker', () => {
    const p1 = [mon('Farigiraf', 'Armor Tail', ['Protect', 'Hyper Voice'], 0), SPLASH];
    const p2 = [mon('Incineroar', 'Blaze', ['Fake Out', 'Flare Blitz'], 252), mon('Skarmory', 'Sturdy', ['Splash'])];
    const log = play('doubles', p1, p2, [['move hypervoice, move splash', 'move fakeout 1, move splash']]);
    expect(log).toMatch(/\|cant\|p1a: Farigiraf\|ability: Armor Tail\|Fake Out\|\[of\] p2a: Incineroar/);
    expect(movesOf(log, 'Incineroar')).toEqual(['Fake Out']);
  });
});

describe('a |cant| line without a move books nothing', () => {
  test.each(FORMATS)('%s: a sleeping Pokémon', format => {
    const spore = mon('Amoonguss', 'Regenerator', ['Spore', 'Protect'], 252);
    const body = mon('Snorlax', 'Thick Fat', ['Body Slam', 'Crunch']);
    const log = scene(format, spore, body, [['move spore' + (format === 'doubles' ? ' 1' : ''), 'move bodyslam' + (format === 'doubles' ? ' 1' : '')]]);
    expect(log).toMatch(/\|cant\|p2a: Snorlax\|slp/);
    expect(movesOf(log, 'Snorlax')).toEqual([]);
  });

  test.each(FORMATS)('%s: a flinch', format => {
    const fakeOut = mon('Incineroar', 'Blaze', ['Fake Out', 'Flare Blitz'], 252);
    const body = mon('Garchomp', 'Rough Skin', ['Earthquake', 'Dragon Claw']);
    const log = scene(format, fakeOut, body, [['move fakeout' + (format === 'doubles' ? ' 1' : ''), 'move earthquake']]);
    expect(log).toMatch(/\|cant\|p2a: Garchomp\|flinch/);
    expect(movesOf(log, 'Garchomp')).toEqual([]);
  });

  test.each(FORMATS)('%s: a Pokémon that Transform copied does not book the copied move it could not use', format => {
    const taunter = mon('Landorus-Therian', 'Intimidate', ['Taunt', 'Earthquake'], 252, 'Choice Scarf');
    const ditto = mon('Ditto', 'Imposter', ['Transform']);
    const doubles = format === 'doubles';
    const log = play(format, doubles ? [SPLASH, taunter] : [taunter], doubles ? [ditto, mon('Skarmory', 'Sturdy', ['Splash'])] : [ditto],
      [doubles ? ['move splash, move taunt 1', 'move taunt 1, move splash'] : ['move taunt', 'move taunt']]);

    expect(log).toMatch(/\|cant\|p2a: Ditto\|move: Taunt\|Taunt/);
    expect(movesOf(log, 'Ditto')).toEqual([]);
  });
});

describe('battle-formes', () => {
  function log(gen: number, species: [string, string][], lines: string[], doubles = false): string {
    return [
      '|player|p1|Alice|', '|player|p2|Bob|', ...(doubles ? ['|gametype|doubles'] : []), `|gen|${gen}`, '|tier|test',
      '|poke|p1|Skarmory|', ...species.map(([preview]) => `|poke|p2|${preview}|`), '|start',
      '|switch|p1a: Skarmory|Skarmory|100/100', ...lines,
    ].join('\n');
  }

  const team = (text: string) => inferOpponentTeam(text, 'p2').pokemon;
  const movesOf = (text: string, species: string) =>
    team(text).find(mon => mon.species === species)?.moves.map(move => move.name);

  describe('a battle-only forme on a later switch-in is the same body', () => {
    test('singles: Mimikyu-Busted joins Mimikyu, the moves after the change book on it', () => {
      const text = log(9, [['Mimikyu, F', ''], ['Heatran', '']], [
        '|switch|p2a: Kyu|Mimikyu, F|100/100', '|turn|1', '|move|p2a: Kyu|Play Rough|p1a: Skarmory',
        '|detailschange|p2a: Kyu|Mimikyu-Busted, F', '|turn|2', '|switch|p2a: Tran|Heatran|100/100', '|turn|3',
        '|switch|p2a: Kyu|Mimikyu-Busted, F|88/100', '|turn|4', '|move|p2a: Kyu|Shadow Claw|p1a: Skarmory',
      ]);
      expect(team(text).map(mon => mon.species)).toEqual(['Mimikyu', 'Heatran']);
      expect(movesOf(text, 'Mimikyu')).toEqual(['Play Rough', 'Shadow Claw']);
    });

    test('singles: Zygarde-Complete joins the Zygarde-10% the preview showed (a list in the Dex)', () => {
      const text = log(7, [['Zygarde-10%', ''], ['Heatran', '']], [
        '|switch|p2a: Zyg|Zygarde-10%|100/100', '|turn|1', '|detailschange|p2a: Zyg|Zygarde-Complete',
        '|switch|p2a: Tran|Heatran|100/100', '|turn|2', '|switch|p2a: Zyg|Zygarde-Complete|50/100', '|turn|3',
        '|move|p2a: Zyg|Thousand Arrows|p1a: Skarmory',
      ]);
      expect(team(text).map(mon => mon.species)).toEqual(['Zygarde-10%', 'Heatran']);
      expect(movesOf(text, 'Zygarde-10%')).toEqual(['Thousand Arrows']);
    });

    test('singles: Necrozma-Ultra joins Necrozma-Dusk-Mane, not a new "Necrozma"', () => {
      const text = log(7, [['Necrozma-Dusk-Mane', ''], ['Heatran', '']], [
        '|switch|p2a: Nec|Necrozma-Dusk-Mane|100/100', '|turn|1', '|-burst|p2a: Nec|Necrozma-Ultra|Ultranecrozium Z',
        '|detailschange|p2a: Nec|Necrozma-Ultra', '|switch|p2a: Tran|Heatran|100/100', '|turn|2',
        '|switch|p2a: Nec|Necrozma-Ultra|70/100', '|turn|3',
      ]);
      expect(team(text).map(mon => mon.species)).toEqual(['Necrozma-Dusk-Mane', 'Heatran']);
    });

    test('singles: Greninja-Ash joins the Greninja the preview showed (same Dex number)', () => {
      const text = log(7, [['Greninja', ''], ['Heatran', '']], [
        '|switch|p2a: Gren|Greninja|100/100', '|turn|1', '|detailschange|p2a: Gren|Greninja-Ash',
        '|switch|p2a: Tran|Heatran|100/100', '|turn|2', '|switch|p2a: Gren|Greninja-Ash|60/100', '|turn|3',
      ]);
      expect(team(text).map(mon => mon.species)).toEqual(['Greninja', 'Heatran']);
    });

    test('doubles: Palafin-Hero joins Palafin', () => {
      const text = log(9, [['Palafin, M', ''], ['Heatran', ''], ['Amoonguss', '']], [
        '|switch|p1b: Skarmory|Skarmory|100/100', '|switch|p2a: Fin|Palafin, M|100/100', '|switch|p2b: Tran|Heatran|100/100', '|turn|1',
        '|switch|p2a: Goss|Amoonguss|100/100', '|turn|2', '|switch|p2a: Fin|Palafin-Hero, M|100/100', '|turn|3',
        '|move|p2a: Fin|Jet Punch|p1a: Skarmory',
      ], true);
      expect(team(text).map(mon => mon.species)).toEqual(['Palafin', 'Heatran', 'Amoonguss']);
      expect(movesOf(text, 'Palafin')).toEqual(['Jet Punch']);
    });

    test('a forme the preview names itself stays (gen 8 Zacian-Crowned)', () => {
      const text = log(8, [['Zacian-Crowned', ''], ['Heatran', '']], [
        '|switch|p2a: Zac|Zacian-Crowned|100/100', '|turn|1', '|move|p2a: Zac|Behemoth Blade|p1a: Skarmory',
      ]);
      expect(team(text).map(mon => mon.species)).toEqual(['Zacian-Crowned', 'Heatran']);
    });
  });
});

const trickLog = [
  '|player|p1|Alice|', '|player|p2|Bob|', '|gen|6', '|tier|[Gen 6] OU',
  '|poke|p1|Bisharp, F|item', '|poke|p1|Clefable, F|item', '|poke|p2|Latias, F|item', '|poke|p2|Heatran, M|item',
  '|start', '|switch|p1a: Bisharp|Bisharp, F|100/100', '|switch|p2a: Latias|Latias, F|100/100', '|turn|1',
  '|', '|move|p2a: Latias|Trick|p1a: Bisharp',
  '|-activate|p2a: Latias|move: Trick|[of] p1a: Bisharp',
  '|-item|p1a: Bisharp|Choice Scarf|[from] move: Trick',
  '|-item|p2a: Latias|Life Orb|[from] move: Trick',
  '|move|p1a: Bisharp|Knock Off|p2a: Latias', '|-supereffective|p2a: Latias', '|-damage|p2a: Latias|0 fnt',
  '|-enditem|p2a: Latias|Life Orb|[from] move: Knock Off|[of] p1a: Bisharp', '|faint|p2a: Latias', '|turn|2',
].join('\n');

const itemOf = (log: string, side: 'p1' | 'p2', species: string) =>
  inferOpponentTeam(log, side).pokemon.find(mon => mon.species === species)?.item;

describe('a shown item replaces the preview flag (has item)', () => {
  test('the Trick giver is credited with the item it handed over, on both sides (655336 t5)', () => {
    expect(itemOf(trickLog, 'p2', 'Latias')).toMatchObject({ value: 'Choice Scarf', source: 'revealed' });
    expect(itemOf(trickLog, 'p1', 'Bisharp')).toMatchObject({ value: 'Life Orb', source: 'revealed' });
  });

  test('an item knocked off a flagged holder is its set item', () => {
    const log = [
      '|player|p1|Alice|', '|player|p2|Bob|', '|gen|6', '|tier|[Gen 6] OU',
      '|poke|p1|Bisharp, F|item', '|poke|p2|Heatran, M|item',
      '|start', '|switch|p1a: Bisharp|Bisharp, F|100/100', '|switch|p2a: Heatran|Heatran, M|100/100', '|turn|1',
      '|', '|move|p1a: Bisharp|Knock Off|p2a: Heatran', '|-resisted|p2a: Heatran', '|-damage|p2a: Heatran|90/100',
      '|-enditem|p2a: Heatran|Leftovers|[from] move: Knock Off|[of] p1a: Bisharp', '|turn|2',
    ].join('\n');
    expect(itemOf(log, 'p2', 'Heatran')).toMatchObject({ value: 'Leftovers (consumed)', source: 'revealed' });
  });
});

type Kind = 'singles' | 'doubles';
const FORMAT: Record<Kind, string> = { singles: 'gen9ou', doubles: 'gen9doublesou' };
const ALL_31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

interface Build { species: string; item?: string; ability: string; moves: string[]; nature?: string; evs?: Partial<typeof ALL_31> }
const set = (build: Build): PokemonSet => ({
  name: build.species, species: build.species, item: build.item ?? 'Leftovers', ability: build.ability, moves: build.moves,
  nature: build.nature ?? 'Hardy', evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...build.evs }, ivs: ALL_31, level: 100, gender: '',
}) as PokemonSet;

const torkoal = () => set({ species: 'Torkoal', ability: 'Drought', moves: ['Flamethrower', 'Protect'], evs: { hp: 252 } });
const koko = () => set({ species: 'Tapu Koko', ability: 'Electric Surge', moves: ['Dazzling Gleam', 'Protect'], evs: { hp: 252 } });
const garchomp = () => set({ species: 'Garchomp', ability: 'Rough Skin', moves: ['Dragon Claw', 'Protect'], evs: { hp: 252 } });
const tusk = (item: string) => set({ species: 'Great Tusk', item, ability: 'Protosynthesis', moves: ['Rapid Spin', 'Protect'] });
const treads = () => set({ species: 'Iron Treads', item: 'Leftovers', ability: 'Quark Drive', moves: ['Earthquake', 'Protect'] });
const blissey = () => set({ species: 'Blissey', ability: 'Natural Cure', moves: ['Soft-Boiled'], evs: { hp: 252 } });
const chansey = () => set({ species: 'Chansey', ability: 'Natural Cure', moves: ['Soft-Boiled'], evs: { hp: 252 } });

function turnLog(kind: Kind, p1: PokemonSet, p2: PokemonSet, moves: [string, string], seed: number): string | null {
  const doubles = kind === 'doubles';
  const battle = new Battle({
    formatid: toID(FORMAT[kind]), seed: [1, 2, 3, seed],
    p1: { name: 'Alpha', team: Teams.pack(doubles ? [p1, blissey()] : [p1]) },
    p2: { name: 'Beta', team: Teams.pack(doubles ? [p2, chansey()] : [p2]) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  const choice = (move: string) => (doubles ? `move ${move}${['normal', 'any', 'adjacentFoe'].includes(Dex.moves.get(move).target) ? ' 1' : ''}, move softboiled` : `move ${move}`);
  battle.choose('p1', choice(moves[0]));
  battle.choose('p2', choice(moves[1]));
  const lines = battle.log;
  const log = lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
  return /\|-crit\|/.test(log) ? null : log;
}

interface Scene { log: string; stat: string; tuskHits: LoggedHit[]; foeHits: LoggedHit[] }

function sceneOf(kind: Kind, foe: PokemonSet, holder: PokemonSet, moves: [string, string]): Scene {
  for (let seed = 1; seed <= 80; seed++) {
    const log = turnLog(kind, foe, holder, moves, seed);
    if (!log) continue;
    const stat = /\|-start\|p2a: [^|]+\|(?:protosynthesis|quarkdrive)(atk|def|spa|spd|spe)/.exec(log)?.[1];
    const tuskHits = inferOpponentTeam(log, 'p2').pokemon.find(mon => mon.species === holder.species)?.hits ?? [];
    const foeHits = inferOpponentTeam(log, 'p1').pokemon.find(mon => mon.species === foe.species)?.hits ?? [];
    if (stat && tuskHits.length > 0 && foeHits.length > 0) return { log, stat, tuskHits, foeHits };
  }
  throw new Error('no clean scene in 80 seeds');
}

describe('the stat a Protosynthesis or Quark Drive holder has raised, read at the hit', () => {
  const holders: Array<[string, () => PokemonSet, () => PokemonSet, [string, string]]> = [
    ['Protosynthesis from Sun', torkoal, () => tusk('Leftovers'), ['flamethrower', 'rapidspin']],
    ['Protosynthesis from Booster Energy', garchomp, () => tusk('Booster Energy'), ['dragonclaw', 'rapidspin']],
    ['Quark Drive from Electric Terrain', koko, treads, ['dazzlinggleam', 'earthquake']],
  ];
  for (const kind of ['singles', 'doubles'] as const) {
    for (const [name, foe, holder, moves] of holders) {
      test(`${kind}: ${name}`, () => {
        const scene = sceneOf(kind, foe(), holder(), moves);
        expect(scene.tuskHits[0]!.attacker.boostedStat).toBe(scene.stat);
        expect(scene.foeHits[0]!.defender.boostedStat).toBe(scene.stat);
        expect(scene.tuskHits[0]!.defender.boostedStat).toBe('');
        expect(scene.foeHits[0]!.attacker.boostedStat).toBe('');
      });
    }
    test(`${kind}: no boost without Sun or Booster Energy reads ''`, () => {
      const log = turnLog(kind, garchomp(), tusk('Leftovers'), ['dragonclaw', 'rapidspin'], 7) ?? turnLog(kind, garchomp(), tusk('Leftovers'), ['dragonclaw', 'rapidspin'], 8)!;
      expect(log).not.toMatch(/protosynthesis/);
      const hits = inferOpponentTeam(log, 'p2').pokemon.find(mon => mon.species === 'Great Tusk')?.hits ?? [];
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every(hit => hit.attacker.boostedStat === '')).toBe(true);
    });
  }
});

describe('illusion-lookup', () => {
  type Format = 'singles' | 'doubles';

  const mon = (species: string, ability: string, moves: string[]): PokemonSet => ({
    name: species, species, item: '', ability, moves, nature: 'Serious', gender: '', level: 100,
    evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  });
  const ZOROARK = mon('Zoroark', 'Illusion', ['Night Daze', 'Flamethrower', 'Sludge Bomb', 'Nasty Plot']);
  const HAWLUCHA = mon('Hawlucha', 'Limber', ['Splash']);
  const SLOWBRO = mon('Slowbro', 'Regenerator', ['Splash']);
  const TOXAPEX = mon('Toxapex', 'Regenerator', ['Tackle', 'Splash']);

  function play(format: Format): string {
    const doubles = format === 'doubles';
    const p1 = doubles ? [TOXAPEX, TOXAPEX] : [TOXAPEX];
    const p2 = doubles ? [ZOROARK, SLOWBRO, HAWLUCHA] : [ZOROARK, HAWLUCHA];
    const battle = new Battle({
      formatid: toID(`gen7${doubles ? 'doubles' : ''}customgame`) as never, seed: [1, 2, 3, 4],
      p1: { name: 'Alpha', team: Teams.pack(p1.map((body, index) => ({ ...body, name: `${body.species}${index}` }))) },
      p2: { name: 'Beta', team: Teams.pack(p2) },
    });
    if (battle.requestState === 'teampreview') {
      battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
      battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
    }
    const hit = doubles ? 'move 1 1, move 1 1' : 'move 1';
    const clicks = [1, 2, 3, 4].map(index => (doubles ? `move ${index}${index < 4 ? ' 1' : ''}, move 1` : `move ${index}`));
    clicks.forEach(click => {
      expect(battle.choose('p1', hit)).toBe(true);
      expect(battle.choose('p2', click)).toBe(true);
    });
    const lines = battle.log;
    return lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
  }

  describe('the Zoroark behind an ended Illusion books its moves', () => {
    for (const format of ['singles', 'doubles'] as const) {
      test(`${format}: the replace line makes the Zoroark name known`, () => {
        const log = play(format);
        expect(log).toMatch(/\|replace\|p2a: Zoroark\|Zoroark/);
        expect(log).toContain('|switch|p2a: Hawlucha|Hawlucha');
        const zoroark = inferOpponentTeam(log, 'p2').pokemon.find(entry => entry.species === 'Zoroark')!;
        const names = zoroark.moves.map(move => move.name);
        expect(names).toEqual(expect.arrayContaining(['Flamethrower', 'Sludge Bomb', 'Nasty Plot']));
      });
    }
  });
});

describe('transform-booking', () => {
  function set(species: string, ability: string, moves: string[]): PokemonSet {
    return {
      name: species, species, item: '', ability, moves, nature: 'Hardy', level: 100, gender: '',
      evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    };
  }

  function play(format: 'gen9ou' | 'gen9doublesou', p1: PokemonSet[], p2: PokemonSet[], turns: [string, string][]): string {
    const battle = new Battle({
      formatid: toID(format), seed: [1, 2, 3, 4], p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
    });
    if (battle.requestState === 'teampreview') { battle.choose('p1', 'default'); battle.choose('p2', 'default'); }
    for (const [first, second] of turns) {
      battle.choose('p1', first);
      battle.choose('p2', second);
    }
    return battle.log.filter((line, index) => !line.startsWith('|split|') && !battle.log[index - 1]?.startsWith('|split|')).join('\n');
  }

  const movesOf = (log: string, side: 'p1' | 'p2', species: string) => inferOpponentTeam(log, side).pokemon.find(entry => entry.species === species)?.moves.map(move => move.name).sort() ?? [];
  const bench = () => set('Blissey', 'Natural Cure', ['Soft-Boiled', 'Protect']);

  describe('a transformed body books its moves to the body it copied', () => {
    const garchomp = () => set('Garchomp', 'Rough Skin', ['Earthquake', 'Swords Dance', 'Protect', 'Dragon Claw']);

    test('singles: an Imposter Ditto uses Earthquake and Swords Dance; the inference of the target holds both, the copy none', () => {
      const ditto = set('Ditto', 'Imposter', ['Transform']);
      const log = play('gen9ou', [ditto, bench()], [garchomp(), bench()], [['move earthquake', 'move swordsdance'], ['move swordsdance', 'move swordsdance']]);
      expect(log).toMatch(/\|-transform\|p1a: Ditto\|p2a: Garchomp\|\[from\] ability: Imposter/);
      expect(log).toMatch(/\|move\|p1a: Ditto\|Earthquake/);
      expect(movesOf(log, 'p2', 'Garchomp')).toEqual(['Earthquake', 'Swords Dance']);
      expect(movesOf(log, 'p1', 'Ditto')).toEqual([]);
    });

    test('singles: the Transform move books Transform on the Ditto and the copy\'s moves on the target', () => {
      const ditto = set('Ditto', 'Limber', ['Transform']);
      const log = play('gen9ou', [ditto, bench()], [garchomp(), bench()], [['move transform', 'move protect'], ['move dragonclaw', 'move swordsdance']]);
      expect(log).toMatch(/\|move\|p1a: Ditto\|Transform\|p2a: Garchomp/);
      expect(movesOf(log, 'p1', 'Ditto')).toEqual(['Transform']);
      expect(movesOf(log, 'p2', 'Garchomp')).toEqual(['Dragon Claw', 'Protect', 'Swords Dance']);
    });

    test('doubles: a copy of the foe across Protects; the foe holds Protect, the other foe none of it', () => {
      const dragonite = set('Dragonite', 'Multiscale', ['Protect', 'Extreme Speed']);
      const ditto = set('Ditto', 'Imposter', ['Transform']);
      const log = play('gen9doublesou', [ditto, bench(), set('Chansey', 'Natural Cure', ['Soft-Boiled'])], [bench(), dragonite, set('Chansey', 'Natural Cure', ['Soft-Boiled'])],
        [['move protect, move softboiled', 'move softboiled, move extremespeed 1']]);
      expect(log).toMatch(/\|-transform\|p1a: Ditto\|p2b: Dragonite\|\[from\] ability: Imposter/);
      expect(log).toMatch(/\|move\|p1a: Ditto\|Protect\|p1a: Ditto/);
      expect(movesOf(log, 'p2', 'Dragonite')).toEqual(['Extreme Speed', 'Protect']);
      expect(movesOf(log, 'p2', 'Blissey')).toEqual(['Soft-Boiled']);
      expect(movesOf(log, 'p1', 'Ditto')).toEqual([]);
    });

    test('doubles: a copy of the partner books on the partner (a same-side Transform)', () => {
      const ditto = set('Ditto', 'Limber', ['Transform']);
      const log = play('gen9doublesou', [ditto, garchomp(), bench()], [bench(), set('Chansey', 'Natural Cure', ['Soft-Boiled']), bench()],
        [['move transform -2, move protect', 'move softboiled, move softboiled'], ['move earthquake, move protect', 'move softboiled, move softboiled']]);
      expect(log).toMatch(/\|-transform\|p1a: Ditto\|p1b: Garchomp/);
      expect(log).toMatch(/\|move\|p1a: Ditto\|Earthquake/);
      expect(movesOf(log, 'p1', 'Garchomp')).toEqual(['Earthquake', 'Protect']);
      expect(movesOf(log, 'p1', 'Ditto')).toEqual(['Transform']);
    });

    test('Struggle by a copy is no move of the target', () => {
      const lowPp = set('Ditto', 'Imposter', ['Transform']);
      const target = set('Garchomp', 'Rough Skin', ['Splash']);
      const turns: [string, string][] = Array.from({ length: 12 }, () => ['move 1', 'move 1']);
      const log = play('gen9ou', [lowPp, bench()], [target, bench()], turns);
      expect(log).toMatch(/\|move\|p1a: Ditto\|Struggle/);
      expect(movesOf(log, 'p2', 'Garchomp')).toEqual(['Splash']);
    });
  });
});

const urshifuLog = [
  '|player|p1|Alice|',
  '|player|p2|Bob|',
  '|gametype|doubles',
  '|gen|9',
  '|tier|[Gen 9] VGC 2026 Reg I',
  '|clearpoke',
  '|poke|p1|Miraidon, L50|item',
  '|poke|p2|Miraidon, L50|item',
  '|poke|p2|Urshifu-*, L50, M|item',
  '|poke|p2|Incineroar, L50, F|item',
  '|teampreview',
  '|start',
  '|switch|p1a: Miraidon|Miraidon, L50|100/100',
  '|switch|p2a: Miraidon|Miraidon, L50|100/100',
  '|switch|p2b: Urshifu|Urshifu-Rapid-Strike, L50, M|100/100',
  '|turn|1',
  '|move|p2b: Urshifu|Surging Strikes|p1a: Miraidon',
  '|-item|p2b: Urshifu|Focus Sash|[from] ability: Frisk|[of] p1a: Miraidon',
  '|turn|2',
].join('\n');

describe('unknown-forme marker from team preview', () => {
  test('the revealed forme takes the marker entry over instead of joining the team as a seventh body', () => {
    const info = inferOpponentTeam(urshifuLog, 'p2');
    expect(info.pokemon.map(pokemon => pokemon.species)).toEqual(['Miraidon', 'Urshifu-Rapid-Strike', 'Incineroar']);
    const urshifu = info.pokemon[1];
    expect(urshifu.item).toEqual(expect.objectContaining({ value: 'Focus Sash', source: 'revealed' }));
    expect(urshifu.moves.map(move => move.name)).toEqual(['Surging Strikes']);
    expect(urshifu.gender).toBe('M');
    expect(urshifu.level).toBe(50);
  });

  test('the base forme itself is a reveal too (Zamazenta without the Rusted Shield)', () => {
    const log = urshifuLog
      .replace('|poke|p2|Urshifu-*, L50, M|item', '|poke|p2|Zamazenta-*, L50|item')
      .replace('|switch|p2b: Urshifu|Urshifu-Rapid-Strike, L50, M|100/100', '|switch|p2b: Zamazenta|Zamazenta, L50|100/100')
      .replace('|move|p2b: Urshifu|Surging Strikes|p1a: Miraidon', '|move|p2b: Zamazenta|Body Press|p1a: Miraidon')
      .replace('|-item|p2b: Urshifu|Focus Sash|[from] ability: Frisk|[of] p1a: Miraidon', '');
    const info = inferOpponentTeam(log, 'p2');
    expect(info.pokemon.map(pokemon => pokemon.species)).toEqual(['Miraidon', 'Zamazenta', 'Incineroar']);
    expect(info.pokemon[1].moves.map(move => move.name)).toEqual(['Body Press']);
  });

  test('a marker that never enters the field stays a marker', () => {
    const log = urshifuLog.split('\n').filter(line => !line.includes('p2b: Urshifu')).join('\n');
    const info = inferOpponentTeam(log, 'p2');
    expect(info.pokemon.map(pokemon => pokemon.species)).toEqual(['Miraidon', 'Urshifu-*', 'Incineroar']);
  });

  test('a team sheet names the forme of a marker that never entered the field', () => {
    const sheet = '|showteam|p2|Miraidon||ChoiceSpecs|HadronEngine|ElectroDrift,DracoMeteor,VoltSwitch,Protect|Timid||||50|]' +
      'Urshifu-Rapid-Strike||FocusSash|UnseenFist|SurgingStrikes,CloseCombat,AquaJet,Protect|Jolly||M|||50|]' +
      'Incineroar||SafetyGoggles|Intimidate|FakeOut,KnockOff,FlareBlitz,PartingShot|Careful||F|||50|';
    const log = urshifuLog.split('\n').filter(line => !line.includes('p2b: Urshifu'))
      .map(line => (line === '|teampreview' ? `${sheet}\n|teampreview` : line)).join('\n');
    const info = inferOpponentTeam(log, 'p2');
    expect(info.pokemon.map(pokemon => pokemon.species)).toEqual(['Miraidon', 'Urshifu-Rapid-Strike', 'Incineroar']);
    expect(info.pokemon[1].moves.map(move => move.name)).toEqual(['Surging Strikes', 'Close Combat', 'Aqua Jet', 'Protect']);
  });

  test('the built team holds six bodies, the revealed forme among them', () => {
    const { p2Team } = buildTeamsFromReplay(urshifuLog);
    expect(p2Team.map(set => set.species)).toEqual(['Miraidon', 'Urshifu-Rapid-Strike', 'Incineroar']);
    expect(p2Team[1].moves).toContain('Surging Strikes');
  });
});
