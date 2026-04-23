import { useState, useCallback, useRef } from 'react';
import { BattleStreams, Dex, Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import type { TurnSnapshot } from '../types';

type SimBattle = NonNullable<BattleStreams.BattleStream['battle']>;
type SimSide = SimBattle['sides'][number];
type SimPokemon = SimSide['pokemon'][number];

/* ── Public interfaces ── */

export interface BranchMoveOption {
  name: string;
  slot: number;
  pp: number;
  maxpp: number;
  disabled: boolean;
  type: string;
}

export interface BranchSwitchOption {
  name: string;
  species: string;
  slot: number;
  hp: string;
  hpPercent: number;
  fainted: boolean;
}

export interface SimPokemonInfo {
  name: string;
  species: string;
  hp: number;
  maxhp: number;
  hpPercent: number;
  status: string;
  fainted: boolean;
  isActive: boolean;
  moves: { name: string; type: string }[];
  ability: string;
  item: string;
  stats: { atk: number; def: number; spa: number; spd: number; spe: number };
  boosts: Record<string, number>;
  level: number;
  types: string[];
}

export interface BranchSimState {
  p1Moves: BranchMoveOption[];
  p1Switches: BranchSwitchOption[];
  p2Moves: BranchMoveOption[];
  p2Switches: BranchSwitchOption[];
  p1Pokemon: SimPokemonInfo[];
  p2Pokemon: SimPokemonInfo[];
  p1Active: SimPokemonInfo | null;
  p2Active: SimPokemonInfo | null;
  log: string[];
  ended: boolean;
  winner: string | null;
  waitingForChoice: boolean;
  turnNumber: number;
  p1ForceSwitch: boolean;
  p2ForceSwitch: boolean;
  p1Choice: string | null;
  p2Choice: string | null;
}

/* ── Replay helpers ── */

function toId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface TurnBlock {
  turn: number;
  preUpkeep: string[];
  postUpkeep: string[];
}

/** Split protocol log into per-turn event blocks. */
function parseTurnBlocks(log: string): { preGame: string[]; turns: TurnBlock[] } {
  const lines = log.split('\n');
  const preGame: string[] = [];
  const turns: TurnBlock[] = [];
  let current: TurnBlock | null = null;
  let inPostUpkeep = false;

  for (const line of lines) {
    if (line.startsWith('|turn|')) {
      if (current) turns.push(current);
      current = { turn: parseInt(line.split('|')[2]), preUpkeep: [], postUpkeep: [] };
      inPostUpkeep = false;
    } else if (!current) {
      preGame.push(line);
    } else if (line.startsWith('|upkeep')) {
      inPostUpkeep = true;
    } else if (inPostUpkeep) {
      current.postUpkeep.push(line);
    } else {
      current.preUpkeep.push(line);
    }
  }
  if (current) turns.push(current);

  return { preGame, turns };
}

/** Extract lead species from the initial switch-in lines (before turn 1). */
function extractLeads(log: string): { p1Lead: string; p2Lead: string } {
  const lines = log.split('\n');
  let p1 = '';
  let p2 = '';
  for (const line of lines) {
    if (line.startsWith('|turn|')) break;
    if (!p1 && line.startsWith('|switch|p1a:')) {
      p1 = line.split('|')[3].split(',')[0].trim();
    }
    if (!p2 && line.startsWith('|switch|p2a:')) {
      p2 = line.split('|')[3].split(',')[0].trim();
    }
  }
  return { p1Lead: p1, p2Lead: p2 };
}

/** Reorder a PokemonSet array so the lead species comes first. */
function reorderForLead(team: PokemonSet[], leadSpecies: string): PokemonSet[] {
  if (!leadSpecies) return [...team];
  const idx = team.findIndex(p =>
    toId(p.species) === toId(leadSpecies) ||
    toId(p.name || '') === toId(leadSpecies)
  );
  if (idx <= 0) return [...team];
  const result = [...team];
  const [lead] = result.splice(idx, 1);
  result.unshift(lead);
  return result;
}

/** Find the switch slot for a species in the sim's current team order. */
function findSlotBySpecies(battle: SimBattle, sideIdx: number, species: string): number {
  const side = battle.sides[sideIdx];
  const speciesId = toId(species);

  for (let i = 0; i < side.pokemon.length; i++) {
    const p = side.pokemon[i];
    if (p.isActive || p.fainted) continue;
    const pId = toId(p.species?.name || '');
    const pNameId = toId(p.name || '');
    if (pId === speciesId || pNameId === speciesId ||
        pId.startsWith(speciesId) || speciesId.startsWith(pId)) {
      return i + 1;
    }
  }
  // Fallback: first available non-active, non-fainted slot
  for (let i = 0; i < side.pokemon.length; i++) {
    if (!side.pokemon[i].isActive && !side.pokemon[i].fainted) return i + 1;
  }
  return 2;
}

/**
 * Determine the main choice for a side from the turn's pre-upkeep events.
 * Voluntary switches appear before moves in the protocol.
 * Moves appear as |move|pXa: ...|MoveName|.
 * U-turn/Flip Turn switches have [from] and are NOT main choices.
 */
function getMainChoice(events: string[], side: 'p1' | 'p2', battle: SimBattle): string {
  const sideIdx = side === 'p1' ? 0 : 1;

  for (const line of events) {
    // Voluntary switch (no [from])
    if (line.startsWith(`|switch|${side}a:`) && !line.includes('[from]')) {
      const species = line.split('|')[3].split(',')[0].trim();
      const slot = findSlotBySpecies(battle, sideIdx, species);
      return `switch ${slot}`;
    }
    // Move
    if (line.startsWith(`|move|${side}a:`)) {
      const moveName = line.split('|')[3];
      return `move ${toId(moveName)}`;
    }
  }

  return 'move 1'; // fallback (e.g., if side fainted before acting)
}

/**
 * Collect species that were switched to as follow-ups (U-turn, faint replacements).
 * These are consumed in order when the sim requests force switches.
 */
function collectForcedSwitchSpecies(
  preUpkeep: string[],
  postUpkeep: string[],
  side: 'p1' | 'p2',
): string[] {
  const species: string[] = [];

  // U-turn / Flip Turn switches (have [from]) in pre-upkeep
  for (const line of preUpkeep) {
    if (line.startsWith(`|switch|${side}a:`) && line.includes('[from]')) {
      species.push(line.split('|')[3].split(',')[0].trim());
    }
  }

  // Faint replacement switches in post-upkeep
  for (const line of postUpkeep) {
    if (line.startsWith(`|switch|${side}a:`)) {
      species.push(line.split('|')[3].split(',')[0].trim());
    }
  }

  return species;
}

/**
 * After replaying, correct HP values to match the original snapshot.
 * This compensates for RNG differences (damage rolls, crits).
 */
function correctHpFromSnapshot(battle: SimBattle, snapshot: TurnSnapshot) {
  for (let si = 0; si < 2; si++) {
    const snapSide = si === 0 ? snapshot.p1 : snapshot.p2;
    const simSide = battle.sides[si];

    for (const snapPoke of snapSide.pokemon) {
      const simPoke = simSide.pokemon.find((p: SimPokemon) =>
        toId(p.species?.name || '') === toId(snapPoke.speciesForme) ||
        toId(p.name || '') === toId(snapPoke.name)
      );
      if (simPoke && snapPoke.maxhp > 0) {
        const ratio = snapPoke.hpPercent / 100;
        simPoke.hp = Math.max(0, Math.round(ratio * simPoke.maxhp));
        if (snapPoke.fainted) {
          simPoke.hp = 0;
          simPoke.fainted = true;
        }
        if (snapPoke.status && snapPoke.status !== '') {
          simPoke.status = snapPoke.status as SimPokemon['status'];
        }
      }
    }
  }
}

/* ── The hook ── */

export function useBranch() {
  const [branching, setBranching] = useState(false);
  const [simState, setSimState] = useState<BranchSimState | null>(null);
  const streamsRef = useRef<ReturnType<typeof BattleStreams.getPlayerStreams> | null>(null);
  const battleStreamRef = useRef<BattleStreams.BattleStream | null>(null);
  const logRef = useRef<string[]>([]);
  const p1ChoiceRef = useRef<string | null>(null);
  const p2ChoiceRef = useRef<string | null>(null);

  const extractPokemonInfo = (side: SimSide): SimPokemonInfo[] => {
    return side.pokemon.map((p): SimPokemonInfo => ({
      name: p.name,
      species: p.species.name,
      hp: p.hp,
      maxhp: p.maxhp,
      hpPercent: p.maxhp > 0 ? Math.round(p.hp / p.maxhp * 100) : 0,
      status: p.status || '',
      fainted: p.fainted,
      isActive: p.isActive,
      moves: p.moveSlots.map(m => ({
        name: m.move,
        type: Dex.moves.get(m.id || m.move)?.type || '',
      })),
      ability: p.ability || '',
      item: p.item || '',
      stats: {
        atk: p.storedStats?.atk || 0,
        def: p.storedStats?.def || 0,
        spa: p.storedStats?.spa || 0,
        spd: p.storedStats?.spd || 0,
        spe: p.storedStats?.spe || 0,
      },
      boosts: { ...p.boosts },
      level: p.level || 100,
      types: p.types ? [...p.types] : [],
    }));
  };

  const updateState = useCallback((battleStream: BattleStreams.BattleStream) => {
    const battle = battleStream.battle;
    if (!battle) {
      setSimState({
        p1Moves: [], p1Switches: [], p2Moves: [], p2Switches: [],
        p1Pokemon: [], p2Pokemon: [],
        p1Active: null, p2Active: null,
        log: [...logRef.current],
        ended: false, winner: null, waitingForChoice: false, turnNumber: 0,
        p1ForceSwitch: false, p2ForceSwitch: false,
        p1Choice: null, p2Choice: null,
      });
      return;
    }

    const p1Active = battle.sides[0].active[0];
    const p2Active = battle.sides[1].active[0];

    const p1ForceSwitch = battle.sides[0].activeRequest?.forceSwitch?.[0] ?? false;
    const p2ForceSwitch = battle.sides[1].activeRequest?.forceSwitch?.[0] ?? false;

    const makeMoves = (active: SimPokemon | null | undefined, forceSwitch: boolean): BranchMoveOption[] => {
      if (!active || active.fainted || forceSwitch) return [];
      return active.moveSlots.map((m, i): BranchMoveOption => {
        const moveData = Dex.moves.get(m.id || m.move);
        return {
          name: m.move, slot: i + 1, pp: m.pp, maxpp: m.maxpp,
          disabled: !!m.disabled, type: moveData?.type || '',
        };
      });
    };

    const makeSwitches = (side: SimSide, active: SimPokemon | null | undefined): BranchSwitchOption[] => {
      return side.pokemon
        .map((p, i): BranchSwitchOption => ({
          name: p.name, species: p.species.name, slot: i + 1,
          hp: `${p.maxhp > 0 ? Math.round(p.hp / p.maxhp * 100) : 0}%`,
          hpPercent: p.maxhp > 0 ? Math.round(p.hp / p.maxhp * 100) : 0,
          fainted: p.fainted,
        }))
        .filter(p => !p.fainted && p.name !== active?.name);
    };

    const makeActiveInfo = (active: SimPokemon | null | undefined): SimPokemonInfo | null => {
      if (!active) return null;
      return {
        name: active.name, species: active.species.name,
        hp: active.hp, maxhp: active.maxhp,
        hpPercent: active.maxhp > 0 ? Math.round(active.hp / active.maxhp * 100) : 0,
        status: active.status || '', fainted: active.fainted, isActive: true,
        moves: active.moveSlots.map(m => ({
          name: m.move,
          type: Dex.moves.get(m.id || m.move)?.type || '',
        })),
        ability: active.ability || '', item: active.item || '',
        stats: {
          atk: active.storedStats?.atk || 0, def: active.storedStats?.def || 0,
          spa: active.storedStats?.spa || 0, spd: active.storedStats?.spd || 0,
          spe: active.storedStats?.spe || 0,
        },
        boosts: { ...active.boosts }, level: active.level || 100,
        types: active.types ? [...active.types] : [],
      };
    };

    setSimState({
      p1Moves: makeMoves(p1Active, p1ForceSwitch),
      p1Switches: makeSwitches(battle.sides[0], p1Active),
      p2Moves: makeMoves(p2Active, p2ForceSwitch),
      p2Switches: makeSwitches(battle.sides[1], p2Active),
      p1Pokemon: extractPokemonInfo(battle.sides[0]),
      p2Pokemon: extractPokemonInfo(battle.sides[1]),
      p1Active: makeActiveInfo(p1Active),
      p2Active: makeActiveInfo(p2Active),
      log: [...logRef.current],
      ended: battle.ended,
      winner: battle.winner || null,
      waitingForChoice: !battle.ended && !!battle.requestState,
      turnNumber: battle.turn,
      p1ForceSwitch, p2ForceSwitch,
      p1Choice: p1ChoiceRef.current,
      p2Choice: p2ChoiceRef.current,
    });
  }, []);

  const executeTurn = useCallback(async () => {
    const streams = streamsRef.current;
    const battleStream = battleStreamRef.current;
    if (!streams || !battleStream) return;

    const p1 = p1ChoiceRef.current;
    const p2 = p2ChoiceRef.current;
    if (!p1 || !p2) return;

    void streams.omniscient.write(`>p1 ${p1}\n>p2 ${p2}`);
    p1ChoiceRef.current = null;
    p2ChoiceRef.current = null;

    await new Promise(resolve => setTimeout(resolve, 200));
    updateState(battleStream);
  }, [updateState]);

  const setChoice = useCallback((side: 'p1' | 'p2', choice: string) => {
    if (side === 'p1') {
      p1ChoiceRef.current = choice;
    } else {
      p2ChoiceRef.current = choice;
    }

    const battleStream = battleStreamRef.current;
    if (!battleStream) return;

    const battle = battleStream.battle;
    if (!battle) return;

    const p1Force = battle.sides[0].activeRequest?.forceSwitch?.[0] ?? false;
    const p2Force = battle.sides[1].activeRequest?.forceSwitch?.[0] ?? false;

    if (p1Force && p2Force) {
      if (p1ChoiceRef.current && p2ChoiceRef.current) {
        void executeTurn();
        return;
      }
    } else if (p1Force && !p2Force && side === 'p1') {
      const streams = streamsRef.current;
      if (streams) {
        void streams.omniscient.write(`>p1 ${choice}`);
        p1ChoiceRef.current = null;
        p2ChoiceRef.current = null;
        setTimeout(() => updateState(battleStream), 200);
      }
      return;
    } else if (p2Force && !p1Force && side === 'p2') {
      const streams = streamsRef.current;
      if (streams) {
        void streams.omniscient.write(`>p2 ${choice}`);
        p1ChoiceRef.current = null;
        p2ChoiceRef.current = null;
        setTimeout(() => updateState(battleStream), 200);
      }
      return;
    }

    setSimState(prev => prev ? {
      ...prev,
      p1Choice: p1ChoiceRef.current,
      p2Choice: p2ChoiceRef.current,
    } : null);
  }, [executeTurn, updateState]);

  /**
   * Start a branch simulation by replaying the original battle up to the
   * target turn, then handing control to the user.
   */
  const startBranch = useCallback(async (
    format: string,
    p1Team: PokemonSet[],
    p2Team: PokemonSet[],
    replayLog: string,
    targetTurn: number,
    snapshot?: TurnSnapshot | null,
  ) => {
    logRef.current = [];
    p1ChoiceRef.current = null;
    p2ChoiceRef.current = null;

    // Reorder teams so leads match the replay
    const { p1Lead, p2Lead } = extractLeads(replayLog);
    const orderedP1 = reorderForLead(p1Team, p1Lead);
    const orderedP2 = reorderForLead(p2Team, p2Lead);

    const battleStream = new BattleStreams.BattleStream();
    battleStreamRef.current = battleStream;
    const streams = BattleStreams.getPlayerStreams(battleStream);
    streamsRef.current = streams;

    // Collect omniscient output
    void (async () => {
      for await (const chunk of streams.omniscient) {
        logRef.current.push(...chunk.split('\n').filter((l: string) => l.trim()));
      }
    })();

    const p1Packed = Teams.pack(orderedP1);
    const p2Packed = Teams.pack(orderedP2);

    // Start the battle
    void streams.omniscient.write(
      `>start {"formatid":"${format}"}\n>player p1 {"name":"Player 1","team":"${p1Packed}"}\n>player p2 {"name":"Player 2","team":"${p2Packed}"}`
    );
    await new Promise(resolve => setTimeout(resolve, 100));

    // Team preview — default order (we already reordered for leads)
    void streams.omniscient.write(`>p1 default\n>p2 default`);
    await new Promise(resolve => setTimeout(resolve, 100));

    // Parse the replay's protocol into per-turn blocks
    const { turns } = parseTurnBlocks(replayLog);

    // Replay turns 1..targetTurn-1 to reach the correct game state
    try {
      for (const turnBlock of turns) {
        if (turnBlock.turn >= targetTurn) break;

        const battle = battleStream.battle;
        if (!battle || battle.ended) break;

        // Determine main choices from the protocol
        const p1Choice = getMainChoice(turnBlock.preUpkeep, 'p1', battle);
        const p2Choice = getMainChoice(turnBlock.preUpkeep, 'p2', battle);

        // Send main choices
        void streams.omniscient.write(`>p1 ${p1Choice}\n>p2 ${p2Choice}`);
        await new Promise(resolve => setTimeout(resolve, 50));

        // Handle follow-up requests (U-turn switches, faint replacements)
        const p1Forced = collectForcedSwitchSpecies(turnBlock.preUpkeep, turnBlock.postUpkeep, 'p1');
        const p2Forced = collectForcedSwitchSpecies(turnBlock.preUpkeep, turnBlock.postUpkeep, 'p2');
        let p1FsIdx = 0;
        let p2FsIdx = 0;

        let maxIter = 10;
        while (maxIter-- > 0) {
          const b = battleStream.battle;
          if (!b || b.ended) break;

          const p1Needs = b.sides[0].activeRequest?.forceSwitch?.[0] ?? false;
          const p2Needs = b.sides[1].activeRequest?.forceSwitch?.[0] ?? false;
          if (!p1Needs && !p2Needs) break;

          let cmd = '';
          if (p1Needs) {
            const sp = p1Forced[p1FsIdx++];
            if (sp) {
              cmd += `>p1 switch ${findSlotBySpecies(b, 0, sp)}\n`;
            } else {
              // Fallback: first available bench pokemon
              for (let i = 0; i < b.sides[0].pokemon.length; i++) {
                if (!b.sides[0].pokemon[i].isActive && !b.sides[0].pokemon[i].fainted) {
                  cmd += `>p1 switch ${i + 1}\n`;
                  break;
                }
              }
            }
          }
          if (p2Needs) {
            const sp = p2Forced[p2FsIdx++];
            if (sp) {
              cmd += `>p2 switch ${findSlotBySpecies(b, 1, sp)}`;
            } else {
              for (let i = 0; i < b.sides[1].pokemon.length; i++) {
                if (!b.sides[1].pokemon[i].isActive && !b.sides[1].pokemon[i].fainted) {
                  cmd += `>p2 switch ${i + 1}`;
                  break;
                }
              }
            }
          }

          if (!cmd.trim()) break;
          void streams.omniscient.write(cmd.trim());
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    } catch (err) {
      console.warn('Replay diverged at some point, using current sim state:', err);
    }

    // Correct HP to match the snapshot (compensates for RNG differences)
    if (snapshot && battleStream.battle) {
      correctHpFromSnapshot(battleStream.battle, snapshot);
    }

    setBranching(true);
    updateState(battleStream);
  }, [updateState]);

  const stopBranch = useCallback(() => {
    setBranching(false);
    setSimState(null);
    streamsRef.current = null;
    battleStreamRef.current = null;
    logRef.current = [];
    p1ChoiceRef.current = null;
    p2ChoiceRef.current = null;
  }, []);

  return { branching, simState, startBranch, setChoice, executeTurn, stopBranch };
}
