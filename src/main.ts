import Phaser from 'phaser';
import { getAgent } from './agents';
import { AgentLoop } from './game/agents/AgentLoop';
import { GameScene } from './game/GameScene';
import { AgentPanel } from './ui/agentPanel';
import { DevConsole } from './ui/devConsole';
import { GameOverScreen, StartMenu } from './ui/menus';
import './styles.css';

// Hold the scene instance so DOM overlays can read live game state through it.
const scene = new GameScene();

const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#090d16',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
  },
  scene: [scene],
};

new Phaser.Game(gameConfig);

// The human seat. Both the chat panel and the mouse act as this player.
const userPlayerId = scene.getUserPlayerId();

// The LLM context handed to every agent: the world plus the players (so an agent
// sees its own standing directive alongside the battlefield).
const buildStateText = () => `${scene.getState().toPromptText()}\n\n${scene.getPlayers().toPromptText()}`;

// Agent panel overlay, layered above the Phaser canvas as regular DOM. It is
// given the user player's tool wrapper (so agents can act via move/attack/… tools),
// a state serializer (so each turn sees the current battlefield), and a chat-busy
// hook so the autonomous loop defers to the human while they're steering.
new AgentPanel({
  toolset: scene.toolsetFor(userPlayerId),
  buildStateText,
  // While the composer is focused, suspend the scene's keyboard controls so the
  // camera keys (SPACE/WASD/arrows/±) can be typed instead of driving the game.
  setGameKeyboardEnabled: (enabled) => scene.setKeyboardEnabled(enabled),
  setChatBusy: (busy) => scene.getPlayers().setChatBusy(userPlayerId, busy),
}).mount();

// Dev console overlay for inspecting the live game state and the autonomous log.
const devConsole = new DevConsole(
  () => scene.getState(),
  () => scene.getPlayers(),
);
devConsole.mount();

// The autonomous "play the game" loop: every ~10s it pings each agent in its
// second mode to act on its standing directive. Output routes to the dev console.
const agentLoop = new AgentLoop({
  players: scene.getPlayers(),
  toolsetFor: (id) => scene.toolsetFor(id),
  buildStateText,
  agentFor: (id) => getAgent(scene.getPlayers().getPlayer(id)?.agentId ?? ''),
  sink: devConsole.agentSink,
});

// Match lifecycle overlays. The start menu holds the world idle on load; the
// battle sim and the autonomous loop only begin once the player chooses to play.
const startMenu = new StartMenu();
startMenu.onStart = () => {
  scene.start();
  agentLoop.start();
};
startMenu.mount();

// When the scene decides the match (player base or all enemy bases at 0 HP), it
// stops the sim; we halt the autonomous loop too and show the result. "Play
// Again" reloads for a clean match — the simplest reliable full reset.
const gameOverScreen = new GameOverScreen();
gameOverScreen.onPlayAgain = () => window.location.reload();
gameOverScreen.mount();

scene.onGameOver = (outcome) => {
  agentLoop.stop();
  gameOverScreen.show(outcome);
};
