import { BattleStreams, Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';

export interface BranchChoice {
  type: 'move' | 'switch';
  index: number;
  mega?: boolean;
  zmove?: boolean;
  terastallize?: boolean;
}

export interface SimulatorState {
  p1Moves: { name: string; pp: number; maxpp: number; disabled: boolean; slot: number }[];
  p1Switches: { name: string; species: string; slot: number; hp: string; fainted: boolean }[];
  p2Moves: { name: string; pp: number; maxpp: number; disabled: boolean; slot: number }[];
  p2Switches: { name: string; species: string; slot: number; hp: string; fainted: boolean }[];
  log: string[];
  ended: boolean;
  winner: string | null;
}

/**
 * Reconstructs player choices from the protocol log.
 * Maps |move| and |switch| lines back to "move N" and "switch N" commands.
 */
export function reconstructChoicesFromLog(
  log: string,
  p1Team: PokemonSet[],
  p2Team: PokemonSet[],
): { p1Choices: string[]; p2Choices: string[]; turnBoundaries: number[] } {
  const lines = log.split('\n');
  const p1Choices: string[] = [];
  const p2Choices: string[] = [];
  const turnBoundaries: number[] = [];

  let p1ActiveSpecies = '';
  let p2ActiveSpecies = '';

  let inTeamPreview = false;

  let currentTurnP1Choice = '';
  let currentTurnP2Choice = '';
  let turnStarted = false;

  for (const line of lines) {
    // Team preview
    if (line.startsWith('|teampreview')) {
      inTeamPreview = true;
      continue;
    }

    if (inTeamPreview && line.startsWith('|')) {
      if (line.startsWith('|turn|')) {
        inTeamPreview = false;
        // Default team order if not explicitly chosen
        if (p1Choices.length === 0) {
          p1Choices.push('default');
        }
        if (p2Choices.length === 0) {
          p2Choices.push('default');
        }
      }
    }

    // Track switches to know team order
    if (line.startsWith('|switch|p1') || line.startsWith('|drag|p1')) {
      const parts = line.split('|');
      const details = parts[3];
      if (details) {
        p1ActiveSpecies = details.split(',')[0].trim();
      }
      if (turnStarted && !currentTurnP1Choice) {
        const switchSlot = findSwitchSlot(p1ActiveSpecies, p1Team);
        if (switchSlot >= 0) {
          currentTurnP1Choice = `switch ${switchSlot + 1}`;
        }
      }
    }
    if (line.startsWith('|switch|p2') || line.startsWith('|drag|p2')) {
      const parts = line.split('|');
      const details = parts[3];
      if (details) {
        p2ActiveSpecies = details.split(',')[0].trim();
      }
      if (turnStarted && !currentTurnP2Choice) {
        const switchSlot = findSwitchSlot(p2ActiveSpecies, p2Team);
        if (switchSlot >= 0) {
          currentTurnP2Choice = `switch ${switchSlot + 1}`;
        }
      }
    }

    // Track moves
    if (line.startsWith('|move|p1')) {
      const parts = line.split('|');
      const moveName = parts[3];
      if (turnStarted && !currentTurnP1Choice) {
        const moveSlot = findMoveSlot(moveName, p1ActiveSpecies, p1Team);
        currentTurnP1Choice = `move ${moveSlot + 1}`;
      }
    }
    if (line.startsWith('|move|p2')) {
      const parts = line.split('|');
      const moveName = parts[3];
      if (turnStarted && !currentTurnP2Choice) {
        const moveSlot = findMoveSlot(moveName, p2ActiveSpecies, p2Team);
        currentTurnP2Choice = `move ${moveSlot + 1}`;
      }
    }

    // Turn boundaries
    if (line.startsWith('|turn|')) {
      if (turnStarted) {
        // Save previous turn's choices
        p1Choices.push(currentTurnP1Choice || 'move 1');
        p2Choices.push(currentTurnP2Choice || 'move 1');
        turnBoundaries.push(p1Choices.length);
      }
      turnStarted = true;
      currentTurnP1Choice = '';
      currentTurnP2Choice = '';
    }
  }

  // Save last turn's choices
  if (turnStarted && (currentTurnP1Choice || currentTurnP2Choice)) {
    p1Choices.push(currentTurnP1Choice || 'move 1');
    p2Choices.push(currentTurnP2Choice || 'move 1');
  }

  return { p1Choices, p2Choices, turnBoundaries };
}

function findMoveSlot(moveName: string, activeSpecies: string, team: PokemonSet[]): number {
  const pokemon = team.find(p => {
    const species = p.species.split('-')[0];
    return p.species === activeSpecies ||
           species === activeSpecies.split('-')[0] ||
           p.name === activeSpecies;
  });
  if (!pokemon) return 0;
  const idx = pokemon.moves.findIndex(m =>
    m.toLowerCase().replace(/\s+/g, '') === moveName.toLowerCase().replace(/\s+/g, '')
  );
  return idx >= 0 ? idx : 0;
}

function findSwitchSlot(species: string, team: PokemonSet[]): number {
  const idx = team.findIndex(p => {
    return p.species === species ||
           p.species.split('-')[0] === species.split('-')[0] ||
           p.name === species;
  });
  return idx >= 0 ? idx : 0;
}

/**
 * Creates a battle simulation that can be controlled by the user.
 * Returns functions to interact with the battle.
 */
export async function createBranchSimulation(
  format: string,
  p1Team: PokemonSet[],
  p2Team: PokemonSet[],
  p1Choices: string[],
  p2Choices: string[],
  upToTurn: number,
): Promise<{
  getState: () => SimulatorState;
  makeChoice: (side: 'p1' | 'p2', choice: string) => void;
  battleLog: string[];
}> {
  const battleLog: string[] = [];
  const stream = new BattleStreams.BattleStream();
  const streams = BattleStreams.getPlayerStreams(stream);

  // Collect omniscient output
  void (async () => {
    for await (const chunk of streams.omniscient) {
      battleLog.push(...chunk.split('\n'));
    }
  })();

  // Start the battle
  const p1Packed = Teams.pack(p1Team);
  const p2Packed = Teams.pack(p2Team);

  void streams.omniscient.write(`>start {"formatid":"${format}"}\n>player p1 {"name":"Player 1","team":"${p1Packed}"}\n>player p2 {"name":"Player 2","team":"${p2Packed}"}`);

  // Wait a tick for the battle to initialize
  await new Promise(resolve => setTimeout(resolve, 50));

  // Feed choices up to the target turn
  // Team preview choice first
  void streams.omniscient.write(`>p1 default\n>p2 default`);
  await new Promise(resolve => setTimeout(resolve, 50));

  // Feed turn choices (skip first choice which is team preview)
  const startIdx = 1; // skip team preview
  for (let i = startIdx; i < upToTurn && i < p1Choices.length; i++) {
    void streams.omniscient.write(`>p1 ${p1Choices[i]}\n>p2 ${p2Choices[i]}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  const getState = (): SimulatorState => {
    const battle = stream.battle;
    if (!battle) {
      return {
        p1Moves: [], p1Switches: [], p2Moves: [], p2Switches: [],
        log: battleLog, ended: false, winner: null,
      };
    }

    const p1Active = battle.sides[0].active[0];
    const p2Active = battle.sides[1].active[0];

    const p1Moves = p1Active ? p1Active.moveSlots.map((m, i) => ({
      name: m.move, pp: m.pp, maxpp: m.maxpp, disabled: !!m.disabled, slot: i + 1,
    })) : [];

    const p2Moves = p2Active ? p2Active.moveSlots.map((m, i) => ({
      name: m.move, pp: m.pp, maxpp: m.maxpp, disabled: !!m.disabled, slot: i + 1,
    })) : [];

    const p1Switches = battle.sides[0].pokemon
      .filter((p, i) => i > 0 && !p.fainted)
      .map((p, i) => ({
        name: p.name, species: p.species.name, slot: i + 2,
        hp: `${Math.round(p.hp / p.maxhp * 100)}%`, fainted: p.fainted,
      }));

    const p2Switches = battle.sides[1].pokemon
      .filter((p, i) => i > 0 && !p.fainted)
      .map((p, i) => ({
        name: p.name, species: p.species.name, slot: i + 2,
        hp: `${Math.round(p.hp / p.maxhp * 100)}%`, fainted: p.fainted,
      }));

    return {
      p1Moves, p1Switches, p2Moves, p2Switches,
      log: battleLog,
      ended: battle.ended,
      winner: battle.winner || null,
    };
  };

  const makeChoice = (side: 'p1' | 'p2', choice: string) => {
    void streams.omniscient.write(`>${side} ${choice}`);
  };

  return { getState, makeChoice, battleLog };
}
