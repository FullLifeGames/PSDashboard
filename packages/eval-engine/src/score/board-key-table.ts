/** How a field enters the key: always, where a handler reads it (`read`), as effect state, or never (ref, inert). */
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
    // `apparentType` is display text (`types` carries the rule); only a stalled battle's tie-break reads `staleness`.
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
