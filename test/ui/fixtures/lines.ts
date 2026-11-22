import type { BranchSlotChoice, DieName, EvalLine, ForcedDie, LineChoice, LineDie, LineStep } from '@fulllifegames/eval-engine';

/** Hand-built lines for the Lines section and the line history: a singles line and a doubles line with a replacement. */

const move = (moveId: string, moveName: string, dice: ForcedDie[] = [], extra: Partial<Extract<BranchSlotChoice, { kind: 'move' }>> = {}): BranchSlotChoice =>
  ({ kind: 'move', moveId, moveName, ...extra, ...(dice.length > 0 ? { dice } : {}) });
const swap = (speciesId: string, pokemonName: string): BranchSlotChoice => ({ kind: 'switch', speciesId, pokemonName });

const name = (slot: string, moveId: string, kind: DieName['kind'], rest: Partial<DieName> = {}): DieName => ({ slot, moveId, kind, ...rest });
const happens = (die: DieName, value: boolean): ForcedDie => ({ name: die, result: { happens: value } });

const choice = (label: string, slots: (BranchSlotChoice | null)[], command = label): LineChoice => ({ choice: command, label, slots });
const waiting = (slots: number): LineChoice => ({ choice: 'wait', label: '(waiting)', slots: Array.from({ length: slots }, () => null) });

const hit = (die: ForcedDie, chance: number, shown: boolean): LineDie => ({ die, chance, shown });

/** Singles, p2 (Pepitopalotin) engine line: Hydro Pump hits (80%), Moonblast, then a knock-out that depends on the damage roll. */
const accuracy = happens(name('p2a', 'hydropump', 'accuracy', { targetSlot: 'p1a' }), true);
const crit = happens(name('p2a', 'hydropump', 'crit', { targetSlot: 'p1a' }), false);
const secondary = happens(name('p2a', 'moonblast', 'secondary', { targetSlot: 'p1a', effectId: 'boosts:spa' }), false);
const roll: ForcedDie = { name: name('p1a', 'bravebird', 'damage-roll', { targetSlot: 'p2a' }), result: { step: 7 } };

export const SINGLES_NAMES: [string, string] = ['Tzon', 'Pepitopalotin'];

export const singlesLine: EvalLine = {
  side: 'p2', label: 'Hydro Pump', choice: 'move 1', for: ['engine'], visits: 90, end: 0.06, endFainted: 0.1,
  steps: [
    { p1: choice('Draining Kiss', [move('drainingkiss', 'Draining Kiss')]), p2: choice('Hydro Pump', [move('hydropump', 'Hydro Pump', [accuracy, crit])]),
      dice: [hit(accuracy, 0.8, true), hit(crit, 0.9583, false)] },
    { p1: choice('→ Corviknight', [swap('corviknight', 'Corviknight')]), p2: choice('Moonblast', [move('moonblast', 'Moonblast', [secondary])]),
      dice: [hit(secondary, 0.7, false)] },
    { p1: choice('Brave Bird', [move('bravebird', 'Brave Bird', [roll])]), p2: choice('Moonblast', [move('moonblast', 'Moonblast')]),
      dice: [{ die: roll, shown: true, ko: { rolls: 10, of: 16 } }] },
  ],
};

/** The same player's played line, and a player who played the engine's move (both roles on one line). */
export const playedLine: EvalLine = {
  ...singlesLine, label: 'Hyper Voice', choice: 'move 2', for: ['played'], end: -0.24,
  steps: [{ p1: singlesLine.steps[0].p1, p2: choice('Hyper Voice', [move('hypervoice', 'Hyper Voice')]), dice: [] }],
};
export const bothRolesLine: EvalLine = {
  side: 'p1', label: 'Draining Kiss', choice: 'move 1', for: ['engine', 'played'], visits: 120, end: 0.1, endFainted: 0.1,
  steps: [{ p1: singlesLine.steps[0].p1, p2: choice('Hydro Pump', [move('hydropump', 'Hydro Pump')]), dice: [] }],
};

/** Doubles, p1 (pixelfrost): four choices a turn, a faint after the first turn, and the opponent's replacement as its own step. */
const tie: ForcedDie = { name: name('p1a', '', 'speed-tie'), result: { first: 'p2a' } };
const bash: ForcedDie = { name: name('p2a', 'behemothbash', 'damage-roll', { targetSlot: 'p1b' }), result: { step: 11 } };
const spore = happens(name('p1b', 'spore', 'accuracy', { targetSlot: 'p2b' }), true);

export const doublesLine: EvalLine = {
  side: 'p1', label: 'Fake Out → Rillaboom + Spore → Zamazenta', choice: 'move 1, move 2', for: ['engine'], visits: 200, end: 0.37, endFainted: 0.3,
  steps: [
    {
      p1: choice('Fake Out → Rillaboom + Spore → Zamazenta', [move('fakeout', 'Fake Out', [tie], { targetLoc: 1 }), move('spore', 'Spore', [spore], { targetLoc: 2 })]),
      p2: choice('Sucker Punch → Terapagos + Protect', [move('suckerpunch', 'Sucker Punch', [], { targetLoc: -1 }), move('protect', 'Protect')]),
      dice: [hit(tie, 0.5, true), hit(spore, 0.75, true)],
    },
    {
      replacement: 'p2',
      p1: waiting(2),
      p2: choice('→ Zamazenta-Crowned', [swap('zamazentacrowned', 'Zamazenta-Crowned'), null]),
      dice: [],
    },
    {
      p1: choice('Fake Out → Zamazenta-Crowned + Protect', [move('fakeout', 'Fake Out', [], { targetLoc: 1 }), move('protect', 'Protect')]),
      p2: choice('Behemoth Bash → Rillaboom + Protect', [move('behemothbash', 'Behemoth Bash', [bash], { targetLoc: -2 }), move('protect', 'Protect')]),
      dice: [{ die: bash, shown: true, ko: { rolls: 12, of: 16 } }],
    },
  ] as LineStep[],
};
export const DOUBLES_NAMES: [string, string] = ['pixelfrost', 'Mstr_Hawk'];
