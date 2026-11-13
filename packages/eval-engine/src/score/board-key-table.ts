/**
 * Round 89 (#149, step A8): the classes of every own field of the simulator's `Pokemon`, `Side`, `Field` and `Battle` for the
 * two memos that play the board (the hit cost of score/contact.ts, the end of the turn of score/residuals.ts). One table, held
 * to the simulator by test/board-key-census.spec.ts (a field it does not name turns the spec red; a field it does not name is
 * keyed anyway, in score/board-key.ts):
 *
 * - key: always in the key. What the consumer's own play reads (species, stats, stages, ...) and what never varies in a game.
 * - read: in the key when some handler of an entry on the board reads the field in an event the consumer fires
 *   (dex-facts/state-readers.ts). The turn-varying bookkeeping lives here, and the key then splits only where it is read.
 * - effect: the state of an effect (volatiles, status, item, ability, species), keyed field by field under the same rule.
 * - normalized: the consumer's copy sets it before it plays, so the board's value is never read.
 * - ref: a reference to another body, a side or a Dex object, keyed by its place or its id.
 * - inert: bookkeeping of the protocol and the interface (names, request, log); no rule reads it.
 *
 * A pair is [hit, residual]: the two consumers read different things (the end of the turn reads no stage, no stat).
 */
export type FieldClass = 'key' | 'read' | 'effect' | 'normalized' | 'ref' | 'inert';
export type FieldPair = readonly [hit: FieldClass, residual: FieldClass];
export type Owner = 'pokemon' | 'side' | 'field' | 'battle';

const same = (names: string, value: FieldClass): [string, FieldPair][] => names.split(' ').map(name => [name, [value, value]]);
const split = (names: string, hit: FieldClass, residual: FieldClass): [string, FieldPair][] => names.split(' ').map(name => [name, [hit, residual]]);

export const BOARD_FIELDS: Record<Owner, Record<string, FieldPair>> = {
  pokemon: Object.fromEntries([
    ...same('inherit modifiedStats ability addedType baseAbility baseMaxhp baseSpecies baseTypes fainted isActive item level maxhp species speed status terastallized teraType transformed types', 'key'),
    ...split('baseHpPower baseHpType boosts happiness hpPower hpType storedStats baseStoredStats weighthg', 'key', 'inert'),
    ...split('gender', 'key', 'read'),
    ...same('abilityState itemState speciesState statusState volatiles', 'effect'),
    ...same('hp', 'normalized'),
    // eslint-disable-next-line names/no-new-dex-name -- `illusion` is the Pokemon field that holds the impersonated body, not the ability
    ...same('illusion', 'ref'),
    ...same('activeMoveActions activeTurns ateBerry attackedBy baseMoveSlots beingCalledBack bondTriggered canGigantamax canMegaEvo canMegaEvoX canMegaEvoY canTerastallize canUltraBurst duringMove dynamaxLevel faintQueued forceSwitchFlag formeRegression gigantamax heroMessageDisplayed hurtThisTurn isStarted itemKnockedOff knownType lastDamage lastItem lastMove lastMoveEncore lastMoveTargetLoc lastMoveUsed moveLastTurnResult moveSlots moveThisTurn moveThisTurnResult newlySwitched ppUps previouslySwitchedIn pursuitActivated shieldBoost skipPursuit statsLoweredThisTurn statsRaisedThisTurn stellarBoostedTypes subFainted switchFlag swordBoost syrupTriggered timesAttacked trapped truantTurn usedItemThisTurn volatileStaleness', 'read'),
    // The display text of the type (`types` carries the rule) and the Leppa Berry bookkeeping (only the tie-break of a stalled battle reads `staleness`): read where a handler names them.
    ...same('apparentType pendingStaleness staleness', 'read'),
    ...same('battle details fullname m maybeDisabled maybeLocked maybeTrapped name pokeball position set showCure side', 'inert'),
  ]),
  side: Object.fromEntries([
    ...same('active pokemon', 'inert'),
    ...same('sideConditions slotConditions', 'effect'),
    ...same('dynamaxUsed faintedLastTurn faintedThisTurn lastEnemyMove lastEnemySelectedMove lastMove lastSelectedMove lastSelectedMoveSlot pokemonLeft totalFainted zMoveUsed', 'read'),
    ...same('activeRequest allySide avatar battle choice foe id n name team', 'inert'),
  ]),
  field: Object.fromEntries([
    ...same('pseudoWeather terrainState weatherState', 'effect'),
    ...same('terrain weather', 'key'),
    ...same('battle id', 'inert'),
  ]),
  battle: Object.fromEntries([
    ...same('ended gameType gen started activePerHalf forceRandomChance', 'key'),
    ...same('activeMove activePokemon activeTarget effect effectState event eventDepth faintQueue lastDamage lastMove lastMoveLine lastSuccessfulMoveThisTurn midTurn queue quickClawRoll turn', 'read'),
    ...same('FAIL HIT_SUBSTITUTE NOT_FAIL SILENT_FAIL actions debugMode deserialized dex effectOrder events field format formatData hints id inputLog log messageLog prng prngSeed rated reportExactHP reportPercentages requestState ruleTable sentEnd sentLogPos sentRequests sides speedOrder strictChoices supportCancel teamGenerator', 'inert'),
  ]),
};
