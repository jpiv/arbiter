// Static description of how Arbiter is played, injected into every agent's
// context alongside the live game state (see main.ts buildStateText). The state
// text carries the live numbers (positions, HP, unit stats); this carries the
// rules and the win condition that don't change tick to tick. Keep it in sync
// with the sim in GameScene and the action set.
export const GAME_RULES = [
  '=== Game Rules ===',
  'Arbiter is a 2D real-time strategy game on a tile grid. There are two teams — the player side',
  'and the enemy side — and each team may field several independent commanders. Every commander',
  'is its own player with its own base and units; each base and unit in the game state names its',
  'owner.',
  '',
  'Objective / win condition: destroy the opposing team\'s bases. A base is destroyed when its HP',
  'reaches 0. The player side wins once every enemy base is destroyed; it loses if all of its own',
  'bases fall. Keep your own base alive while you eliminate the other side\'s.',
  '',
  'Units: each unit has a role (Scout, Soldier, Builder, and ranged variants) with fixed stats —',
  'speed (tiles moved per second), range, hp, and power (damage dealt per hit). A unit takes',
  'damage when attacked and is destroyed (removed from the map) when its HP reaches 0. Current',
  'unit positions, HP, stats, owners, and orders are listed in the game state below.',
  '',
  'Actions (issued as tools):',
  '- move: send one of your units to a grid tile; it paths there at its speed.',
  '- attack: send one of your units to advance on a target and strike it once in range; it keeps',
  '  attacking until the target is destroyed or you reorder it. Both enemy bases and enemy units',
  '  are attackable — chase down and destroy enemy units, not just their base.',
  '- You may only command units you own; orders on other players\' units are rejected.',
  '',
  'Play: you act on a recurring timer rather than continuously. Each turn, read the state and',
  'issue the orders that best advance your objective. Your standing directive is your operating',
  'plan — pursue it.',
].join('\n');
