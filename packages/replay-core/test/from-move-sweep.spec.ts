import { describe, expect, test } from 'vitest';
import { Battle, Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { CHAMPIONS_MOD, dexOf, inferOpponentTeam } from '../src/index';
import type { GameRules } from '../src/index';

/**
 * Round 89 (#140): which move a `|move|` line books on its user. A move line names its source in `[from]`, and the simulator prints
 * `[from] <effect.fullname>`: a move effect prints `move: X`, a condition its bare name. Three cases hold every `[from]` the corpus has:
 *
 *  - A caller (Metronome, Copycat, Nature Power and the rest of the Dex's `callsMove` set): the line shows the CALLED move, which the
 *    user does not know; the caller is the user's own move.
 *  - A pull (a Pledge combination, Round): the line shows the user's OWN move, and the effect names the PARTNER's move that pulled it
 *    forward (`|move|p1a: Primarina|Water Pledge|...|[from] move: Grass Pledge`). The partner's move is no move of the user.
 *  - A condition (Magic Coat, Snatch, Pursuit's switch hit, a locked move): the type is missing; the line shows a move the user does
 *    not know when the condition reflected or stole it, and the user's own move for Pursuit and the locked move.
 *
 * The oracle is the simulator's own body: the moves it was built with (`baseMoveSlots`). The inference must book no move the body does
 * not know, and every move line without `[from]` must be booked. The sweep plays every Dex move that calls, pulls or reflects another
 * move (found by reading the Dex: `callsMove`, and the handlers that call `useMove`, `runMove` or `queue.prioritizeAction`), in every
 * generation the corpus plays (1 to 9) and the Champions mod, singles and, from Generation 3, doubles; its alone pass plays every
 * other move of the generation in doubles to see that no further move writes a `[from] move:` line. No species or move name stands in
 * the code that is under test.
 */
Dex.mod(CHAMPIONS_MOD, championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);
Dex.formats.extend(championsMod.Formats);

type Kind = 'singles' | 'doubles';
interface Scene { label: string; gen: number; champions: boolean; rules: GameRules }

const SCENES: Scene[] = [
  ...Array.from({ length: 9 }, (_, index) => ({ label: `Generation ${index + 1}`, gen: index + 1, champions: false, rules: { gen: index + 1, mod: undefined } as GameRules })),
  { label: 'Champions', gen: 9, champions: true, rules: { gen: 9, mod: CHAMPIONS_MOD } as GameRules },
];
const kindsOf = (scene: Scene): Kind[] => (scene.gen >= 3 ? ['singles', 'doubles'] : ['singles']);
const formatOf = (scene: Scene, kind: Kind) => `gen${scene.gen}${scene.champions ? 'champions' : ''}${kind === 'doubles' ? 'doubles' : ''}customgame`;

type Dexish = ReturnType<typeof dexOf>;
type MoveData = ReturnType<Dexish['moves']['get']>;

const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const body = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy', evs, ivs, level: 50, gender: '',
});

const publicLog = (battle: Battle) => battle.log.filter((line, index) => !line.startsWith('|split|') && !battle.log[index - 1]?.startsWith('|split|')).join('\n');

/** The moves of the generation the Dex lists (a move of a later generation is `Future`; Z-moves and Max moves need an item or a form). */
function movesOf(dex: Dexish, scene: Scene): MoveData[] {
  return dex.moves.all().filter(move => move.exists && move.gen <= scene.gen && move.isNonstandard !== 'Future' && !move.isZ && !move.isMax);
}

/** The text of a move's handlers (the move and its condition), read from the Dex's functions. */
function handlerText(move: MoveData): string {
  const seen = new Set<unknown>();
  const texts: string[] = [];
  const read = (value: unknown) => {
    if (typeof value === 'function') texts.push(String(value));
    else if (value && typeof value === 'object' && !seen.has(value)) {
      seen.add(value);
      Object.values(value).forEach(read);
    }
  };
  read({ ...move });
  return texts.join('\n');
}
/** Whether a move's handlers call another move or pull an action of the queue forward. */
const movesAMove = (move: MoveData): boolean => /useMove|runMove|prioritizeAction/.test(handlerText(move));
/** Whether a move's handlers pull an action of the queue forward (a Pledge, Round, After You, Instruct, Shell Trap). */
const pullsAnAction = (move: MoveData): boolean => /prioritizeAction/.test(handlerText(move));

/** The first species of the scene that is a plain body: a base species of this generation with no forme of its own. */
function fillersOf(dex: Dexish, scene: Scene, count: number): string[] {
  return dex.species.all()
    .filter(species => species.exists && species.gen <= scene.gen && !species.isNonstandard && species.num > 0 && species.baseSpecies === species.name && !species.otherFormes)
    .slice(0, count).map(species => species.name);
}

interface Plan {
  /** What p1's two slots use in turn 2 (singles reads slot 1). */
  own: string[];
  /** What p2's two slots use in turn 2. */
  foe: string[];
  /** What p2's two slots use in turn 1: the first puts p1's second slot to sleep when it is Spore, and the foe's last move is the one a copier reads. */
  opening: string[];
}
interface Played { log: string; battle: Battle; unplayable: string[] }

/** A foe for most moves (the opposing slot of the same position), the partner for a move that names an ally; self targets take none, singles never do. */
function targetOf(battle: Battle, move: MoveData, kind: Kind, slot: number, partner: boolean): string {
  if (kind === 'singles' || !battle.actions.targetTypeChoices(move.target)) return '';
  if (/ally/i.test(move.target)) return ` -${2 - slot}`;
  return ` ${partner ? 2 - slot : slot + 1}`;
}

/**
 * Plays two turns. Turn 1: p1 waits, p2 plays `opening`. Turn 2: both play their plan. A choice the simulator refuses is no scene: it goes
 * to `unplayable` and the game stops there, so a row never passes on a battle that did not play.
 */
function play(scene: Scene, kind: Kind, plan: Plan): Played {
  const dex = dexOf(scene.rules);
  const fillers = fillersOf(dex, scene, 6);
  const width = kind === 'doubles' ? 2 : 1;
  // A body on the field knows Splash, Tackle (p2 the opening too) and the move of its slot; the bench body knows every move of the plan (Assist reads it).
  const team = (offset: number, slotMoves: string[], bench: string[], extra: string[] = []) => fillers.slice(offset, offset + 3).map((species, index) => body(species,
    [...new Set(['splash', 'tackle', ...(index < width ? [...extra, slotMoves[index % slotMoves.length]] : bench)])]));
  const battle = new Battle({
    formatid: toID(formatOf(scene, kind)) as never, seed: [3, 1, 4, 1],
    p1: { name: 'Alpha', team: Teams.pack(team(0, plan.own, plan.own)) },
    p2: { name: 'Beta', team: Teams.pack(team(3, plan.foe, [...plan.opening, ...plan.foe], plan.opening)) },
  });
  const unplayable: string[] = [];
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', 'team 123');
    battle.choose('p2', 'team 123');
  }
  const choose = (sideId: 'p1' | 'p2', moves: string[]) => {
    const side = battle.sides[sideId === 'p1' ? 0 : 1];
    const picks = Array.from({ length: width }, (_, slot) => {
      const id = toID(moves[slot % moves.length]);
      const index = side.active[slot]?.moveSlots.findIndex(entry => entry.id === id) ?? -1;
      // The opening's second move hits the first slot of p1, and the first hits the second slot: the sleeper is p1's second body.
      return index < 0 ? 'move 1' : `move ${index + 1}${targetOf(battle, dex.moves.get(id), kind, slot, true)}`;
    });
    if (!battle.choose(sideId, picks.join(', '))) unplayable.push(`${sideId}: ${picks.join(', ')}`);
  };
  choose('p1', ['splash']);
  choose('p2', plan.opening);
  choose('p1', plan.own);
  choose('p2', plan.foe);
  return { log: publicLog(battle), battle, unplayable };
}

interface Gap { side: string; species: string; booked: string; why: string }

/** The inference against the simulator's bodies: no booked move the body does not know, and every plain move line booked. */
function gapsOf(played: Played): Gap[] {
  const gaps: Gap[] = [];
  for (const side of ['p1', 'p2'] as const) {
    const info = inferOpponentTeam(played.log, side);
    const sim = played.battle.sides[side === 'p1' ? 0 : 1].pokemon;
    for (const entry of info.pokemon) {
      const known = new Set(sim.find(mon => mon.baseSpecies.name === entry.species || mon.name === entry.species)?.baseMoveSlots.map(slot => slot.id) ?? []);
      for (const move of entry.moves.filter(move => move.source === 'revealed')) {
        if (!known.has(toID(move.name))) gaps.push({ side, species: entry.species, booked: move.name, why: 'a booked move the body does not know' });
      }
    }
    for (const line of played.log.split('\n').filter(text => text.startsWith('|move|') && text.split('|')[2].startsWith(side) && !text.includes('[from]'))) {
      const [, , ident, shown] = line.split('|');
      if (toID(shown) === 'struggle') continue;
      const entry = info.pokemon.find(candidate => ident.endsWith(candidate.species));
      if (!entry?.moves.some(move => toID(move.name) === toID(shown))) gaps.push({ side, species: entry?.species ?? ident, booked: shown, why: 'a plain move line that is not booked' });
    }
  }
  return gaps;
}

/** The effects the log's move lines name after `[from]`, typed or not. */
const fromEffects = (log: string) => log.split('\n').filter(text => text.startsWith('|move|'))
  .flatMap(text => text.split('|').filter(part => part.startsWith('[from]')).map(part => part.replace(/^\[from\] ?/, '')));

/** An effect after `[from]`: `move: Grass Pledge` is typed, a condition has its bare name. */
type Effect = { text: string; name: string; typed: boolean };
const effectOf = (text: string): Effect => ({ text, name: text.replace(/^move: /, ''), typed: text.startsWith('move: ') });

describe('the scenes of the issue', () => {
  const movesOfSide = (log: string, side: 'p1' | 'p2', species: string) => inferOpponentTeam(log, side).pokemon.find(entry => entry.species === species)?.moves.map(move => move.name).sort();

  test('singles: a Magic Coat user and a Snatch user keep the reflected and the stolen move off their set', () => {
    const coat = play(SCENES[8], 'singles', { own: ['magiccoat'], foe: ['stealthrock'], opening: ['tackle'] });
    expect(fromEffects(coat.log), 'the reflection names the condition, no move type').toEqual(['Magic Coat']);
    expect(movesOfSide(coat.log, 'p1', 'Bulbasaur')).toEqual(['Magic Coat', 'Splash']);
    const snatch = play(SCENES[8], 'singles', { own: ['snatch'], foe: ['swordsdance'], opening: ['tackle'] });
    expect(fromEffects(snatch.log)).toEqual(['Snatch']);
    expect(movesOfSide(snatch.log, 'p1', 'Bulbasaur')).toEqual(['Snatch', 'Splash']);
  });

  test('doubles: Round pulled by Round books one Round on each body', () => {
    const played = play(SCENES[8], 'doubles', { own: ['round', 'round'], foe: ['splash'], opening: ['tackle', 'tackle'] });
    expect(fromEffects(played.log)).toEqual(['move: Round']);
    expect(movesOfSide(played.log, 'p1', 'Bulbasaur')).toEqual(['Round', 'Splash']);
  });

  test('singles: a caller books the caller, in both forms of the line', () => {
    const played = play(SCENES[8], 'singles', { own: ['naturepower'], foe: ['splash'], opening: ['tackle'] });
    expect(fromEffects(played.log)).toEqual(['move: Nature Power']);
    expect(movesOfSide(played.log, 'p1', 'Bulbasaur')).toEqual(['Nature Power', 'Splash']);
    // The older servers wrote `[from]Nature Power` (smogtours-gen7ou-546696): the same set.
    const older = oldForm(played.log, new Set(['naturepower']));
    expect(fromEffects(older)).toEqual(['Nature Power']);
    expect(movesOfSide(older, 'p1', 'Bulbasaur')).toEqual(['Nature Power', 'Splash']);
  });

  test('doubles: a Pledge combination books the move each body shows, not the partner\'s Pledge', () => {
    const played = play(SCENES[8], 'doubles', { own: ['grasspledge', 'waterpledge'], foe: ['splash'], opening: ['tackle', 'tackle'] });
    expect(played.unplayable).toEqual([]);
    expect(fromEffects(played.log), 'the second Pledge names the first').toEqual([expect.stringMatching(/^move: (Grass|Water) Pledge$/)]);
    expect(gapsOf(played)).toEqual([]);
  });
});

/** The moves each side's bodies are booked with, as one string per side. */
const bookedOf = (log: string) => (['p1', 'p2'] as const).map(side => inferOpponentTeam(log, side).pokemon
  .map(entry => `${entry.species}: ${entry.moves.map(move => toID(move.name)).sort().join(',')}`).join(' | '));

/** The older servers wrote a caller's called move with the caller's bare name: `[from]Nature Power`, no `move:` (corpus: smogtours-gen7ou-546696). */
const oldForm = (log: string, callers: Set<string>) => log.split('\n')
  .map(text => text.startsWith('|move|') ? text.replace(/\[from\] ?move: ([^|]*)/, (whole, name: string) => (callers.has(toID(name)) ? `[from]${name}` : whole)) : text).join('\n');

describe.each(SCENES)('$label', scene => {
  const dex = dexOf(scene.rules);
  const moves = movesOf(dex, scene);
  const callers = new Set(moves.filter(move => move.callsMove).map(move => move.id));
  const pullers = moves.filter(move => !move.callsMove && pullsAnAction(move));
  const movers = moves.filter(move => move.callsMove || movesAMove(move));
  const moverIds = new Set(movers.map(move => move.id));
  const reflectable = moves.find(move => move.flags.reflectable && move.category === 'Status' && move.target === 'normal');
  const snatchable = moves.find(move => move.flags.snatch && move.category === 'Status' && move.target === 'self');

  test('the Dex lists the movers of the generation', () => {
    expect(callers.size).toBeGreaterThan(0);
    for (const id of callers) expect(moverIds.has(id), id).toBe(true);
    // Pledges, Round and the rest of the pullers arrived in Generation 5.
    expect(pullers.length > 0, 'pullers').toBe(scene.gen >= 5);
  });

  for (const kind of kindsOf(scene)) {
    test(`${kind}: every mover books only the moves its bodies know`, () => {
      const openings = [['spore', 'tackle'], ['tackle', 'tackle']];
      const foes = ['tackle', reflectable?.id ?? 'tackle', snatchable?.id ?? 'tackle'];
      const plans: Plan[] = [];
      for (const move of movers) for (const opening of openings) for (const foe of foes) plans.push({ own: [move.id], foe: [foe], opening });
      // Doubles: every ordered pair of pullers in the two slots, so each Pledge meets each other Pledge and Round meets Round.
      if (kind === 'doubles') for (const first of pullers) for (const second of pullers) plans.push({ own: [first.id, second.id], foe: ['splash'], opening: ['tackle', 'tackle'] });
      const gaps: string[] = [];
      const unknown: string[] = [];
      const effects = new Set<string>();
      let withFrom = 0;
      for (const plan of plans) {
        const played = play(scene, kind, plan);
        const seen = fromEffects(played.log);
        if (!seen.length) continue;
        withFrom++;
        for (const text of seen) {
          effects.add(text);
          const effect = effectOf(text);
          // A move effect calls (the Dex's `callsMove`) or pulls (a handler that calls the queue); a bare name is a condition that is a mover itself.
          if (effect.typed ? !callers.has(toID(effect.name)) && !pullers.some(move => move.id === toID(effect.name)) : !moverIds.has(toID(effect.name))) unknown.push(`${plan.own} vs ${plan.foe}: ${text}`);
        }
        for (const gap of gapsOf(played)) gaps.push(`${plan.own} vs ${plan.foe} after ${plan.opening[0]}: ${gap.side} ${gap.species} ${gap.why}: ${gap.booked}`);
        // The older form of every call (`[from]Nature Power`) books what the typed form books.
        if (seen.some(text => effectOf(text).typed && callers.has(toID(effectOf(text).name)))) {
          expect(bookedOf(oldForm(played.log, callers)), `${plan.own} vs ${plan.foe} in the older form`).toEqual(bookedOf(played.log));
        }
      }
      expect(withFrom, 'games with a [from] on a move line').toBeGreaterThan(0);
      expect(unknown, 'effects that neither call nor pull').toEqual([]);
      expect(gaps).toEqual([]);
      const pulls = [...effects].filter(text => effectOf(text).typed && !callers.has(toID(effectOf(text).name)));
      // A pull needs an ally: singles writes none; doubles writes them wherever the generation has a puller of an ally's action.
      if (kind === 'singles') expect(pulls, 'singles writes no pull').toEqual([]);
      else expect(pulls.length > 0, 'doubles writes a pull').toBe(pullers.length > 0);
    }, 600_000);
  }

  // The alone pass: no other move of the generation writes a `[from] move:` line (a mechanism the reading of the Dex missed would show here).
  if (scene.gen >= 3) {
    test('doubles: no other move of the generation writes a [from] move line', () => {
      const surprises: string[] = [];
      for (const move of moves.filter(candidate => !moverIds.has(candidate.id))) {
        const played = play(scene, 'doubles', { own: [move.id], foe: [move.id], opening: ['tackle', 'tackle'] });
        for (const text of fromEffects(played.log)) {
          if (effectOf(text).typed ? !callers.has(toID(effectOf(text).name)) && !pullers.some(entry => entry.id === toID(effectOf(text).name)) : !moverIds.has(toID(text))) surprises.push(`${move.name}: ${text}`);
        }
      }
      expect(surprises).toEqual([]);
    }, 600_000);
  }
});
