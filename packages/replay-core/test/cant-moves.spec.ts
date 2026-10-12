import { test, expect, describe } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { inferOpponentTeam } from '../src/opponent-inferrer';

/**
 * Round 69, T175 (decision 36): a `|cant|` line that names a move is a move of that Pokémon's set, as a `|move|` line is.
 * The move never ran (Taunt, Imprison, Disable, Heal Block and Throat Chop stop it before the `|move|` line), so the
 * log shows it only here; 752301 t1 to t3 and the 16 Taunt lines of the fit corpus are the case. A blocker's line
 * (Dazzling, Queenly Majesty, Armor Tail, Damp) carries `[of]`, reaches the inference as the protocol's `-block` and follows the
 * stopped attacker's own `|move|` line: it books that move once for the attacker and nothing for the blocker. A reason without a move (sleep, paralysis, flinch, recharge, Truant) books nothing, and so does a
 * blocked move of a transformed Pokémon. Every log comes from @pkmn/sim; each scene first checks the line the sim
 * writes, so a wrong shape fails here and not in a game.
 */

function mon(species: string, ability: string, moves: string[], spe = 0, item = 'Leftovers'): PokemonSet {
  return {
    name: species, species, item, ability, moves, nature: 'Serious', gender: '', level: 100,
    evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 0, spe }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  };
}

type Format = 'singles' | 'doubles';
const FORMATS: Format[] = ['singles', 'doubles'];

/** The battle's log as a viewer reads it. */
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
/** p1 leads with a fast `lead`; in doubles its partner splashes, and p2 gets `mate` beside the tested body. */
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

describe('a move a blocker stopped is booked from the |cant| line (T175)', () => {
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
    // Sucker Punch is Kingambit's; Bruxish shows only its own Psychic Fangs.
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
    // Imposter copies the Taunter at once (in doubles the Pokémon across, which is p1b); the Taunter is faster, so Ditto is
    // taunted before it uses the copied Taunt itself, and the move is the copy's, not a move of Ditto's set.
    const doubles = format === 'doubles';
    const log = play(format, doubles ? [SPLASH, taunter] : [taunter], doubles ? [ditto, mon('Skarmory', 'Sturdy', ['Splash'])] : [ditto],
      [doubles ? ['move splash, move taunt 1', 'move taunt 1, move splash'] : ['move taunt', 'move taunt']]);

    expect(log).toMatch(/\|cant\|p2a: Ditto\|move: Taunt\|Taunt/);
    expect(movesOf(log, 'Ditto')).toEqual([]);
  });
});
