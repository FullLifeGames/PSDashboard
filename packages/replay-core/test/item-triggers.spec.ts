import { test, expect, describe } from 'vitest';
import { Battle, Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { Protocol } from '@pkmn/protocol';
import * as championsMod from '@pkmn/mods/champions';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { sitrusEatsAt } from '../src/inference/item-triggers';

/**
 * Round 69, T168 (decision 34): four items whose trigger the protocol shows without the item's line are ruled out, as
 * R5 does for Air Balloon, Booster Energy and Eject Pack (trigger-evidence.spec.ts). A Lum Berry holder eats on a status or
 * a confusion, a Sitrus Berry holder at half HP, an Eject Button holder survives a damaging hit from another Pokémon and
 * leaves, a Red Card holder sends the attacker away. Every log comes from @pkmn/sim: each case first checks what a real
 * holder shows (so a wrong trigger fails here, not in a game), then what the inference reads for the side p2 from the
 * same battle with a neutral item. A guard is a case where the real holder shows nothing and the inference rules nothing out.
 */

function set(species: string, item: string, ability: string, moves: string[], level = 100): PokemonSet {
  return {
    name: species, species, item, ability, moves, nature: 'Hardy', level, gender: '',
    evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  };
}

type Format = 'singles' | 'doubles';
const FORMATS: Format[] = ['singles', 'doubles'];

interface Scene {
  attacker?: Partial<PokemonSet> & { moves?: string[] };
  /** The second attacker of the doubles side (default: a Ground-immune Skarmory that splashes). */
  partner?: PokemonSet;
  holder?: Partial<PokemonSet>;
  mate?: PokemonSet;
  /** Pokémon on each side beyond the leads. */
  p1Bench?: number;
  p2Bench?: number;
  /** The turns as the p1 move ids with targets: 'earthquake' (the holder is target 1 in doubles), 'splash'. */
  turns: string[][];
  /** The holder's move per turn (default: Splash). */
  p2Turns?: string[];
  gen?: number;
}

const ATTACK_MOVES = ['Earthquake', 'Dragon Claw', 'Toxic', 'Confuse Ray', 'Embargo', 'Magic Room', 'Heal Block', 'Substitute', 'Dragon Tail', 'U-turn', 'Flamethrower', 'Leech Seed', 'Splash'];

function side1(scene: Scene, format: Format): PokemonSet[] {
  const attacker = { ...set('Garchomp', 'Leftovers', 'Rough Skin', ATTACK_MOVES), ...scene.attacker };
  const bench = Array.from({ length: scene.p1Bench ?? 1 }, () => set('Chansey', 'Leftovers', 'Natural Cure', ['Splash']));
  const partner = scene.partner ?? set('Skarmory', 'Leftovers', 'Sturdy', ['Splash', ...ATTACK_MOVES.slice(0, 3)]);
  return format === 'doubles' ? [attacker, partner, ...bench] : [attacker, ...bench];
}

function side2(scene: Scene, format: Format, item: string): PokemonSet[] {
  const holder = { ...set('Blissey', item, 'Natural Cure', ['Splash', 'Substitute']), ...scene.holder, item };
  const mate = scene.mate ?? set('Chansey', 'Leftovers', 'Natural Cure', ['Splash']);
  const bench = Array.from({ length: scene.p2Bench ?? 1 }, () => set('Heatran', 'Leftovers', 'Flash Fire', ['Splash']));
  return format === 'doubles' ? [holder, mate, ...bench] : [holder, ...bench];
}

/** The battle's log as a viewer reads it (the split lines keep their public form). */
function playTeams(p1: PokemonSet[], p2: PokemonSet[], options: { doubles: boolean; gen?: number }, turns: [string, string][]): string {
  const { doubles, gen = 9 } = options;
  const battle = new Battle({
    formatid: toID(`gen${gen}${doubles ? 'doubles' : ''}ou`), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  for (const [first, second] of turns) {
    battle.choose('p1', first);
    battle.choose('p2', second);
  }
  // A pivot, an Eject Button or a Red Card asks for a switch: the first Pokémon on the bench comes in.
  if (battle.requestState === 'switch') {
    for (const side of [battle.p1, battle.p2]) {
      const forced = (side.activeRequest as { forceSwitch?: boolean[] } | null)?.forceSwitch;
      if (forced?.some(Boolean)) battle.choose(side.id, forced.map(flag => (flag ? `switch ${doubles ? 3 : 2}` : 'pass')).join(', '));
    }
  }
  const lines = battle.log;
  return lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
}

function play(scene: Scene, format: Format, item: string): string {
  const doubles = format === 'doubles';
  const turns = scene.turns.map((turn, index): [string, string] => {
    const holder = scene.p2Turns?.[index] ?? 'move splash';
    return [doubles ? turn.join(', ') : turn[0], doubles ? `${holder}, move splash` : holder];
  });
  return playTeams(side1(scene, format), side2(scene, format, item), { doubles, gen: scene.gen }, turns);
}

const mv = (id: string, target?: number) => `move ${id}${target ? ` ${target}` : ''}`;
/** One turn of p1: the lead uses `id` on the holder (target 1 where the move picks a target), the partner splashes in doubles. */
const hit = (id: string): string[] => [mv(id, ['normal', 'any', 'adjacentFoe'].includes(Dex.moves.get(id).target) ? 1 : undefined), mv('splash')];
const quiet: string[] = [mv('splash'), mv('splash')];
/** An item that shows nothing in a log, so the holder stays unknown. */
const NEUTRAL = 'Mystic Water';

const ruledOut = (log: string, species: string) =>
  inferOpponentTeam(log, 'p2').pokemon.find(mon => mon.species === species)?.ruledOut?.items ?? [];

/** What the real holder shows, and what the inference rules out when the holder's item is a neutral one. */
function read(scene: Scene, format: Format, item: string, species = 'Blissey') {
  const withItem = play(scene, format, item);
  const shown = new RegExp(`\\|-enditem\\|p2a: ${species}\\|${item}`).test(withItem);
  return { shown, out: ruledOut(play(scene, format, NEUTRAL), species).includes(toID(item)) };
}

describe('Lum Berry is eaten on a status or a confusion (T168)', () => {
  const toxic: Scene = { turns: [hit('toxic')] };
  const confusion: Scene = { turns: [hit('confuseray')] };

  test.each(FORMATS)('%s: a Toxic that leaves no Lum Berry line rules the item out', format => {
    expect(read(toxic, format, 'Lum Berry')).toEqual({ shown: true, out: true });
  });

  test.each(FORMATS)('%s: a confusion without the line rules it out', format => {
    expect(read(confusion, format, 'Lum Berry')).toEqual({ shown: true, out: true });
  });

  test('doubles: the partner\'s Lum Berry line does not stand in for the holder\'s own', () => {
    const scene: Scene = {
      partner: set('Toxapex', 'Leftovers', 'Regenerator', ['Toxic', 'Splash']), mate: set('Chansey', 'Leftovers', 'Natural Cure', ['Splash']),
      turns: [[mv('toxic', 1), mv('toxic', 2)]],
    };
    const real = play({ ...scene, mate: set('Chansey', 'Lum Berry', 'Natural Cure', ['Splash']) }, 'doubles', 'Lum Berry');
    expect(real).toMatch(/\|-enditem\|p2a: Blissey\|Lum Berry/);
    expect(real).toMatch(/\|-enditem\|p2b: Chansey\|Lum Berry/);
    const mixed = play({ ...scene, mate: set('Chansey', 'Lum Berry', 'Natural Cure', ['Splash']) }, 'doubles', NEUTRAL);
    expect(ruledOut(mixed, 'Blissey')).toContain('lumberry');
    expect(ruledOut(mixed, 'Chansey')).not.toContain('lumberry');
  });

  const guards: [string, Scene, string?][] = [
    ['Embargo', { turns: [hit('embargo'), hit('toxic')] }],
    ['Magic Room', { turns: [hit('magicroom'), hit('toxic')] }],
    ['a holder that may have Klutz', { holder: set('Lopunny', 'Leftovers', 'Klutz', ['Splash']), turns: [hit('toxic')] }, 'Lopunny'],
    ['a foe with Unnerve', { attacker: set('Tyranitar', 'Leftovers', 'Unnerve', ATTACK_MOVES), turns: [hit('toxic')] }],
  ];
  test.each(FORMATS.flatMap(format => guards.map(guard => [format, ...guard] as const)))('%s guard: %s shows nothing, so nothing is ruled out', (format, _name, scene, species) => {
    expect(read(scene, format, 'Lum Berry', species)).toEqual({ shown: false, out: false });
  });
});

describe('Sitrus Berry is eaten at half HP (T168)', () => {
  const low = { level: 70 };
  const strike: Scene = { holder: low, turns: [hit('earthquake')] };

  test.each(FORMATS)('%s: a hit that leaves less than half without the line rules the item out', format => {
    expect(read(strike, format, 'Sitrus Berry')).toEqual({ shown: true, out: true });
  });

  test.each(FORMATS)('%s: a hit that leaves more than half judges nothing', format => {
    expect(read({ turns: [hit('earthquake')] }, format, 'Sitrus Berry')).toEqual({ shown: false, out: false });
  });

  test('doubles: one spread move, one holder ate and one did not', () => {
    const scene: Scene = { holder: low, mate: set('Chansey', 'Sitrus Berry', 'Natural Cure', ['Splash'], 60), turns: [[mv('earthquake'), mv('splash')]] };
    const real = play(scene, 'doubles', 'Sitrus Berry');
    expect(real).toMatch(/\|-enditem\|p2a: Blissey\|Sitrus Berry/);
    expect(real).toMatch(/\|-enditem\|p2b: Chansey\|Sitrus Berry/);
    const mixed = play(scene, 'doubles', NEUTRAL);
    expect(ruledOut(mixed, 'Blissey')).toContain('sitrusberry');
    expect(ruledOut(mixed, 'Chansey')).not.toContain('sitrusberry');
  });

  // Leech Seed's drain is the residual phase: the simulator eats the berry in its last update, after the upkeep line (level 90 holds above half after the Earthquake and below it after the drain).
  test.each(FORMATS)('%s: a berry eaten after the upkeep line is no miss, and a drain below half without it rules the item out', format => {
    const scene: Scene = { holder: { level: 90 }, turns: [hit('earthquake'), hit('leechseed')] };
    const real = play(scene, format, 'Sitrus Berry');
    expect(real).toMatch(/\|upkeep\n\|-enditem\|p2a: Blissey\|Sitrus Berry/);
    expect(ruledOut(real, 'Blissey')).not.toContain('sitrusberry');
    expect(ruledOut(play(scene, format, NEUTRAL), 'Blissey')).toContain('sitrusberry');
  });

  const guards: [string, Scene, string?][] = [
    ['a hit that faints the holder', { holder: { level: 40 }, turns: [hit('earthquake')] }],
    ['Heal Block', { holder: low, turns: [hit('healblock'), hit('earthquake')] }],
    ['Embargo', { holder: low, turns: [hit('embargo'), hit('earthquake')] }],
    ['Magic Room', { holder: low, turns: [hit('magicroom'), hit('earthquake')] }],
    ['a holder that may have Klutz', { holder: set('Lopunny', 'Leftovers', 'Klutz', ['Splash'], 70), turns: [hit('earthquake')] }, 'Lopunny'],
    ['a foe with Unnerve', { holder: low, attacker: set('Tyranitar', 'Leftovers', 'Unnerve', ATTACK_MOVES), turns: [hit('earthquake')] }],
  ];
  test.each(FORMATS.flatMap(format => guards.map(guard => [format, ...guard] as const)))('%s guard: %s shows nothing, so nothing is ruled out', (format, _name, scene, species) => {
    expect(read(scene, format, 'Sitrus Berry', species)).toEqual({ shown: false, out: false });
  });
});

describe('the shown HP bounds the real HP, so Sitrus Berry is judged only where rounding cannot hide it (T168)', () => {
  const mod = championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>;
  Dex.mod('champions', mod);

  /** Every HP of a 400 HP Pokémon, shown the way the simulator shows it: the upper bound of the true ratio never undercuts the real one. */
  test.each(['gen9ou', 'gen6ou', 'gen5ou', 'gen9championsou'])('%s: a berry judged to eat at the shown HP eats at every real HP that shows it', formatid => {
    const battle = new Battle({ formatid: toID(formatid), seed: '1,2,3,4', p1: { name: 'A', team: Teams.pack([set('Blissey', 'Sitrus Berry', 'Natural Cure', ['Splash'])]) }, p2: { name: 'B', team: Teams.pack([set('Chansey', 'Leftovers', 'Natural Cure', ['Splash'])]) } });
    if (battle.requestState === 'teampreview') { battle.choose('p1', 'team 1'); battle.choose('p2', 'team 1'); }
    const mon = battle.p1.active[0];
    const gen = battle.gen;
    let judged = 0;
    for (let hp = 1; hp <= mon.maxhp; hp++) {
      mon.hp = hp;
      const shown = mon.getHealth().shared;
      if (sitrusEatsAt(gen, shown)) {
        judged++;
        expect(hp <= mon.maxhp / 2, `${formatid} hp ${hp}/${mon.maxhp} shown ${shown}`).toBe(true);
      }
    }
    expect(judged).toBeGreaterThan(0);
    expect(Protocol.parseHealth('0 fnt').fainted).toBe(true);
    expect(sitrusEatsAt(gen, '0 fnt')).toBe(false);
  });
});

describe('Eject Button switches its holder out after a damaging hit (T168)', () => {
  const attack = (id: string): Scene => ({ turns: [hit(id)] });
  test.each(FORMATS)('%s: a hit that leaves no Eject Button line rules the item out (Hatterene 2663112821 t4 shape)', format => {
    expect(read(attack('earthquake'), format, 'Eject Button')).toEqual({ shown: true, out: true });
    expect(read(attack('uturn'), format, 'Eject Button')).toEqual({ shown: true, out: true });
  });

  test('doubles: one spread move ejects one holder and the other holds', () => {
    const scene: Scene = { mate: set('Chansey', 'Eject Button', 'Natural Cure', ['Splash']), turns: [[mv('earthquake'), mv('splash')]] };
    const real = play(scene, 'doubles', 'Eject Button');
    expect(real).toMatch(/\|-enditem\|p2a: Blissey\|Eject Button/);
    expect(real).not.toMatch(/\|-enditem\|p2b: Chansey\|Eject Button/);
    // The holder that held on has its item: the other holder's line is in its window.
    expect(ruledOut(real, 'Chansey')).not.toContain('ejectbutton');
    expect(ruledOut(play(scene, 'doubles', NEUTRAL), 'Blissey')).not.toContain('ejectbutton');
  });

  test('doubles: the same spread move on two neutral items rules both out', () => {
    const log = play({ turns: [[mv('earthquake'), mv('splash')]] }, 'doubles', NEUTRAL);
    expect(ruledOut(log, 'Blissey')).toContain('ejectbutton');
    expect(ruledOut(log, 'Chansey')).toContain('ejectbutton');
  });

  const guards: [string, Scene, string?][] = [
    ['no Pokémon to come in', { p2Bench: 0, turns: [hit('earthquake')] }],
    ['Sheer Force on a move with a secondary effect', { attacker: set('Nidoking', 'Leftovers', 'Sheer Force', ATTACK_MOVES), turns: [hit('flamethrower')] }],
    ['a Substitute that took the hit', { turns: [quiet, hit('earthquake')], p2Turns: ['move substitute', 'move splash'] }],
    ['a hit that faints the holder', { holder: { level: 40 }, turns: [hit('earthquake')] }],
    ['Dragon Tail, which drags the holder out itself', { turns: [hit('dragontail')] }],
    ['Embargo', { turns: [hit('embargo'), hit('earthquake')] }],
    ['Magic Room', { turns: [hit('magicroom'), hit('earthquake')] }],
    ['a holder that may have Klutz', { holder: set('Lopunny', 'Leftovers', 'Klutz', ['Splash']), turns: [hit('earthquake')] }, 'Lopunny'],
  ];
  test.each(FORMATS.flatMap(format => guards.map(guard => [format, ...guard] as const)))('%s guard: %s shows nothing, so nothing is ruled out', (format, _name, scene, species) => {
    expect(read(scene, format, 'Eject Button', species)).toEqual({ shown: false, out: false });
  });
});

describe('Commander and a fainting attacker (T168)', () => {
  const p1 = (lead: PokemonSet) => [lead, set('Skarmory', 'Leftovers', 'Sturdy', ['Splash']), set('Chansey', 'Leftovers', 'Natural Cure', ['Splash'])];
  const bench = set('Heatran', 'Leftovers', 'Flash Fire', ['Splash']);

  test('doubles: a Dondozo that Tatsugiri commands does not eject, so nothing is ruled out (Commander does not exist in singles)', () => {
    const team = (item: string) => [set('Tatsugiri', 'Leftovers', 'Commander', ['Splash']), set('Dondozo', item, 'Unaware', ['Splash']), bench];
    const turns: [string, string][] = [['move dragonclaw 2, move splash', 'pass, move splash']];
    const lead = set('Garchomp', 'Leftovers', 'Rough Skin', ATTACK_MOVES);
    const real = playTeams(p1(lead), team('Eject Button'), { doubles: true }, turns);
    expect(real).toMatch(/Commander\|\[of\] p2b: Dondozo/);
    expect(real).not.toMatch(/\|-enditem\|p2b: Dondozo\|Eject Button/);
    expect(ruledOut(playTeams(p1(lead), team(NEUTRAL), { doubles: true }, turns), 'Dondozo')).not.toContain('ejectbutton');
  });

  test('doubles: an attacker that faints on the holder Rough Skin is no longer there to send away (Red Card)', () => {
    const team = (item: string) => [set('Garchomp', item, 'Rough Skin', ['Splash']), set('Chansey', 'Leftovers', 'Natural Cure', ['Splash']), bench];
    const turns: [string, string][] = [['move shadowsneak 1, move splash', 'move splash, move splash']];
    const lead = set('Shedinja', 'Leftovers', 'Wonder Guard', ['Shadow Sneak', 'Splash']);
    const real = playTeams(p1(lead), team('Red Card'), { doubles: true }, turns);
    expect(real).toMatch(/\|faint\|p1a: Shedinja/);
    expect(real).not.toMatch(/\|-enditem\|p2a: Garchomp\|Red Card/);
    expect(ruledOut(playTeams(p1(lead), team(NEUTRAL), { doubles: true }, turns), 'Garchomp')).not.toContain('redcard');
  });
});

describe('Red Card sends the attacker away after a damaging hit (T168)', () => {
  const attack = (id: string): Scene => ({ turns: [hit(id)] });
  test.each(FORMATS)('%s: a hit that leaves no Red Card line rules the item out (Glimmora 751443 t10 shape)', format => {
    expect(read(attack('earthquake'), format, 'Red Card')).toEqual({ shown: true, out: true });
    expect(read(attack('uturn'), format, 'Red Card')).toEqual({ shown: true, out: true });
  });

  test('doubles: one spread move sends the attacker away once, the second holder holds', () => {
    const scene: Scene = { mate: set('Chansey', 'Red Card', 'Natural Cure', ['Splash']), turns: [[mv('earthquake'), mv('splash')]] };
    const real = play(scene, 'doubles', 'Red Card');
    expect(real).toMatch(/\|-enditem\|p2a: Blissey\|Red Card/);
    expect(real).not.toMatch(/\|-enditem\|p2b: Chansey\|Red Card/);
    expect(ruledOut(real, 'Chansey')).not.toContain('redcard');
    expect(ruledOut(play(scene, 'doubles', NEUTRAL), 'Blissey')).not.toContain('redcard');
  });

  const guards: [string, Scene, string?][] = [
    ['an attacker whose side has no Pokémon to come in', { p1Bench: 0, turns: [hit('earthquake')] }],
    ['Sheer Force on a move with a secondary effect', { attacker: set('Nidoking', 'Leftovers', 'Sheer Force', ATTACK_MOVES), turns: [hit('flamethrower')] }],
    ['a Substitute that took the hit', { turns: [quiet, hit('earthquake')], p2Turns: ['move substitute', 'move splash'] }],
    ['a hit that faints the holder', { holder: { level: 40 }, turns: [hit('earthquake')] }],
    ['Embargo', { turns: [hit('embargo'), hit('earthquake')] }],
    ['Magic Room', { turns: [hit('magicroom'), hit('earthquake')] }],
    ['a holder that may have Klutz', { holder: set('Lopunny', 'Leftovers', 'Klutz', ['Splash']), turns: [hit('earthquake')] }, 'Lopunny'],
  ];
  test.each(FORMATS.flatMap(format => guards.map(guard => [format, ...guard] as const)))('%s guard: %s shows nothing, so nothing is ruled out', (format, name, scene, species) => {
    const adjusted: Scene = format === 'doubles' && name.startsWith('an attacker') ? { ...scene, p1Bench: 0, partner: set('Skarmory', 'Leftovers', 'Sturdy', ['Splash']) } : scene;
    expect(read(adjusted, format, 'Red Card', species)).toEqual({ shown: false, out: false });
  });
});
