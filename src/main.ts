import Phaser from 'phaser';
import { GameScene } from './game/GameScene';
import { AgentPanel } from './ui/agentPanel';
import './styles.css';

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

// Agent panel overlay, layered above the Phaser canvas as regular DOM. It is
// given the game's tool wrapper (so agents can act via move/attack/… tools) and
// a state serializer (so each turn sees the current battlefield).
new AgentPanel({
  toolset: scene.commandTools,
  buildStateText: () => scene.getState().toPromptText(),
}).mount();
