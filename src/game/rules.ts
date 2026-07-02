// Static description of how Arbiter is played, injected into every agent's
// context alongside the live game state (see main.ts buildStateText). The state
// text carries the live numbers (positions, HP, unit stats); this carries the
// rules and the win condition that don't change tick to tick. Keep it in sync
// with the sim in GameScene and the action set.
export const GAME_RULES = [
  '=== Game Rules ===',
  'Arbiter is a 2D real-time strategy game on a tile grid. Two factions — player and enemy —',
  'each hold one base and command a handful of units.',
  '',
  'Objective / win condition: destroy the opposing faction\'s base. A base is destroyed when its',
  'HP reaches 0. Keep your own base alive while you eliminate theirs.',
  '',
  'Units: each unit has a role (Scout, Soldier, Builder) with fixed stats — speed (tiles moved',
  'per second), range, hp, and power (damage dealt per hit). A unit takes damage when attacked',
  'and is destroyed (removed from the map) when its HP reaches 0. Current unit positions, HP,',
  'stats, and orders are listed in the game state below.',
  '',
  'Actions (issued as tools):',
  '- move: send one of your units to a grid tile; it paths there at its speed.',
  '- attack: send one of your units to advance on a target and strike it once in range; it keeps',
  '  attacking until the target is destroyed or you reorder it. Both enemy bases and enemy units',
  '  are attackable — chase down and destroy enemy units, not just their base.',
  '- You may only command your own faction\'s units; orders on other units are rejected.',
  '',
  'Play: you act on a recurring timer rather than continuously. Each turn, read the state and',
  'issue the orders that best advance your objective. Your standing directive is your operating',
  'plan — pursue it.',
].join('\n');
