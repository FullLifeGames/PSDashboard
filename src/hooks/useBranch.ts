import { useState, useCallback, useRef } from 'react';
import { BattleStreams, Teams, RandomPlayerAI } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';

export interface BranchMoveOption {
  name: string;
  slot: number;
  pp: number;
  maxpp: number;
  disabled: boolean;
}

export interface BranchSwitchOption {
  name: string;
  species: string;
  slot: number;
  hp: string;
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
}

export interface BranchSimState {
  p1Moves: BranchMoveOption[];
  p1Switches: BranchSwitchOption[];
  p1Pokemon: SimPokemonInfo[];
  p2Pokemon: SimPokemonInfo[];
  p1Active: SimPokemonInfo | null;
  p2Active: SimPokemonInfo | null;
  log: string[];
  ended: boolean;
  winner: string | null;
  waitingForChoice: boolean;
  turnNumber: number;
  forceSwitch: boolean;
}

export function useBranch() {
  const [branching, setBranching] = useState(false);
  const [simState, setSimState] = useState<BranchSimState | null>(null);
  const streamsRef = useRef<ReturnType<typeof BattleStreams.getPlayerStreams> | null>(null);
  const battleStreamRef = useRef<BattleStreams.BattleStream | null>(null);
  const logRef = useRef<string[]>([]);

  const startBranch = useCallback(async (
    format: string,
    p1Team: PokemonSet[],
    p2Team: PokemonSet[],
  ) => {
    logRef.current = [];

    const battleStream = new BattleStreams.BattleStream();
    battleStreamRef.current = battleStream;
    const streams = BattleStreams.getPlayerStreams(battleStream);
    streamsRef.current = streams;

    // Set up p2 as RandomPlayerAI
    const p2Player = new RandomPlayerAI(streams.p2);
    void p2Player.start();

    // Collect omniscient output
    void (async () => {
      for await (const chunk of streams.omniscient) {
        logRef.current.push(...chunk.split('\n').filter(l => l.trim()));
      }
    })();

    // Start the battle
    const p1Packed = Teams.pack(p1Team);
    const p2Packed = Teams.pack(p2Team);

    void streams.omniscient.write(
      `>start {"formatid":"${format}"}\n>player p1 {"name":"Player 1","team":"${p1Packed}"}\n>player p2 {"name":"Player 2","team":"${p2Packed}"}`
    );

    await new Promise(resolve => setTimeout(resolve, 100));
    void streams.omniscient.write(`>p1 default`);
    await new Promise(resolve => setTimeout(resolve, 200));

    setBranching(true);
    updateState(battleStream);
  }, []);

  function extractPokemonInfo(side: { pokemon: any[]; active: any[] }): SimPokemonInfo[] {
    return side.pokemon.map(p => ({
      name: p.name,
      species: p.species.name,
      hp: p.hp,
      maxhp: p.maxhp,
      hpPercent: p.maxhp > 0 ? Math.round(p.hp / p.maxhp * 100) : 0,
      status: p.status || '',
      fainted: p.fainted,
      isActive: p.isActive,
    }));
  }

  const updateState = useCallback((battleStream: BattleStreams.BattleStream) => {
    const battle = battleStream.battle;
    if (!battle) {
      setSimState({
        p1Moves: [], p1Switches: [],
        p1Pokemon: [], p2Pokemon: [],
        p1Active: null, p2Active: null,
        log: [...logRef.current],
        ended: false, winner: null, waitingForChoice: false, turnNumber: 0, forceSwitch: false,
      });
      return;
    }

    const p1Active = battle.sides[0].active[0];
    const p2Active = battle.sides[1].active[0];

    // Check if it's a force switch situation
    const forceSwitch = battle.requestState === 'switch';

    const p1Moves: BranchMoveOption[] = (p1Active && !p1Active.fainted && !forceSwitch)
      ? p1Active.moveSlots.map((m, i) => ({
          name: m.move, slot: i + 1,
          pp: m.pp, maxpp: m.maxpp,
          disabled: !!m.disabled,
        }))
      : [];

    const p1Switches: BranchSwitchOption[] = battle.sides[0].pokemon
      .map((p, i) => ({
        name: p.name,
        species: p.species.name,
        slot: i + 1,
        hp: `${p.maxhp > 0 ? Math.round(p.hp / p.maxhp * 100) : 0}%`,
        fainted: p.fainted,
      }))
      .filter(p => !p.fainted && p.name !== p1Active?.name);

    const p1Pokemon = extractPokemonInfo(battle.sides[0]);
    const p2Pokemon = extractPokemonInfo(battle.sides[1]);

    const p1ActiveInfo = p1Active ? {
      name: p1Active.name,
      species: p1Active.species.name,
      hp: p1Active.hp,
      maxhp: p1Active.maxhp,
      hpPercent: p1Active.maxhp > 0 ? Math.round(p1Active.hp / p1Active.maxhp * 100) : 0,
      status: p1Active.status || '',
      fainted: p1Active.fainted,
      isActive: true,
    } : null;

    const p2ActiveInfo = p2Active ? {
      name: p2Active.name,
      species: p2Active.species.name,
      hp: p2Active.hp,
      maxhp: p2Active.maxhp,
      hpPercent: p2Active.maxhp > 0 ? Math.round(p2Active.hp / p2Active.maxhp * 100) : 0,
      status: p2Active.status || '',
      fainted: p2Active.fainted,
      isActive: true,
    } : null;

    setSimState({
      p1Moves,
      p1Switches,
      p1Pokemon,
      p2Pokemon,
      p1Active: p1ActiveInfo,
      p2Active: p2ActiveInfo,
      log: [...logRef.current],
      ended: battle.ended,
      winner: battle.winner || null,
      waitingForChoice: !battle.ended && !!battle.requestState,
      turnNumber: battle.turn,
      forceSwitch,
    });
  }, []);

  const makeChoice = useCallback(async (choice: string) => {
    const streams = streamsRef.current;
    const battleStream = battleStreamRef.current;
    if (!streams || !battleStream) return;

    void streams.omniscient.write(`>p1 ${choice}`);
    await new Promise(resolve => setTimeout(resolve, 200));
    updateState(battleStream);
  }, [updateState]);

  const stopBranch = useCallback(() => {
    setBranching(false);
    setSimState(null);
    streamsRef.current = null;
    battleStreamRef.current = null;
    logRef.current = [];
  }, []);

  return { branching, simState, startBranch, makeChoice, stopBranch };
}
