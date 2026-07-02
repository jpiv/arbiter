import Phaser from 'phaser';
import { GameScene } from './game/GameScene';
import './styles.css';

const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: 960,
  height: 540,
  backgroundColor: '#090d16',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [new GameScene()],
};

new Phaser.Game(gameConfig);
