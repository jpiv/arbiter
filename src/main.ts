import Phaser from 'phaser';
import { GameScene } from './game/GameScene';
import './styles.css';

const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#090d16',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
  },
  scene: [new GameScene()],
};

new Phaser.Game(gameConfig);
