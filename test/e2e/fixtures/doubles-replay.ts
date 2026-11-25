import type { ReplayData } from '@fulllifegames/replay-core';

export const doublesReplay: ReplayData = {
  id: 'gen9doubles-test',
  format: '[Gen 9] Doubles OU',
  formatid: 'gen9doublesou',
  players: ['Alice', 'Bob'],
  uploadtime: 0,
  views: 0,
  log: [
    '|player|p1|Alice|',
    '|player|p2|Bob|',
    '|gametype|doubles',
    '|gen|9',
    '|tier|[Gen 9] Doubles OU',
    '|clearpoke',
    '|poke|p1|Pikachu, L50|item',
    '|poke|p1|Eevee, L50|item',
    '|poke|p1|Raichu, L50|',
    '|poke|p1|Jolteon, L50|',
    '|poke|p2|Bulbasaur, L50|item',
    '|poke|p2|Charmander, L50|item',
    '|poke|p2|Squirtle, L50|',
    '|poke|p2|Ivysaur, L50|',
    '|c| Alice|/raw <div class="infobox"><details><summary>View team</summary>Pikachu @ Light Ball<br />Ability: Static<br />EVs: 4 HP &#x2f; 252 SpA &#x2f; 252 Spe<br />Timid Nature<br />- Thunderbolt<br />- Quick Attack<br />- Protect<br /><br />Eevee @ Eviolite<br />Ability: Adaptability<br />EVs: 252 Atk &#x2f; 4 SpD &#x2f; 252 Spe<br />Jolly Nature<br />- Tackle<br />- Quick Attack<br />- Protect<br /><br />Raichu<br />Ability: Static<br />- Thunderbolt<br />- Protect<br /><br />Jolteon<br />Ability: Volt Absorb<br />- Thunderbolt<br />- Protect<br /></details></div>',
    '|c| Bob|/raw <div class="infobox"><details><summary>View team</summary>Bulbasaur @ Eviolite<br />Ability: Overgrow<br />- Vine Whip<br />- Protect<br /><br />Charmander @ Eviolite<br />Ability: Blaze<br />- Ember<br />- Protect<br /><br />Squirtle<br />Ability: Torrent<br />- Water Gun<br />- Protect<br /><br />Ivysaur<br />Ability: Overgrow<br />- Vine Whip<br />- Protect<br /></details></div>',
    '|teampreview',
    '|',
    '|start',
    '|switch|p1a: Pikachu|Pikachu, L50|100/100',
    '|switch|p1b: Eevee|Eevee, L50|100/100',
    '|switch|p2a: Bulbasaur|Bulbasaur, L50|100/100',
    '|switch|p2b: Charmander|Charmander, L50|100/100',
    '|turn|1',
  ].join('\n'),
};

export const doublesSpreadReplay: ReplayData = {
  ...doublesReplay,
  id: 'gen9doubles-spread-test',
  log: doublesReplay.log.replace('- Thunderbolt<br />- Quick Attack<br />', '- Thunderbolt<br />- Discharge<br />'),
};

// Memento (accuracy 100) faints its user when it hits, so both P1 bodies faint whatever the dice roll.
export const doublesForcedReplay: ReplayData = {
  ...doublesReplay,
  id: 'gen9doubles-forced-test',
  log: doublesReplay.log
    .replace('- Thunderbolt<br />- Quick Attack<br />- Protect', '- Memento<br />- Quick Attack<br />- Protect')
    .replace('- Tackle<br />- Quick Attack<br />- Protect', '- Memento<br />- Quick Attack<br />- Protect')
    .replace('|poke|p2|Bulbasaur, L50|item', '|poke|p1|Vaporeon, L50|\n|poke|p1|Flareon, L50|\n|poke|p2|Bulbasaur, L50|item')
    .replace('Jolteon<br />Ability: Volt Absorb<br />- Thunderbolt<br />- Protect<br /></details>',
      'Jolteon<br />Ability: Volt Absorb<br />- Thunderbolt<br />- Protect<br /><br />Vaporeon<br />Ability: Water Absorb<br />- Scald<br />- Protect<br /><br />Flareon<br />Ability: Flash Fire<br />- Flare Blitz<br />- Protect<br /></details>'),
};
