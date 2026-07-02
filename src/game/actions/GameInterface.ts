import { attackAction } from './attack';
import { moveAction } from './move';
import { ActionResult, GameAction, GameContext } from './types';

/** Every action the game exposes. Register new actions here. */
export const ALL_ACTIONS: GameAction[] = [attackAction, moveAction];

/**
 * The single interface through which every game action is invoked — by a human
 * (via input handlers) or an agent (via the tool wrapper). It holds the action
 * registry bound to a game context and dispatches calls by name. Nothing calls
 * the game's action logic except through here.
 */
export class GameInterface {
  private readonly actions = new Map<string, GameAction>();

  constructor(
    private readonly context: GameContext,
    actions: GameAction[] = ALL_ACTIONS,
  ) {
    for (const action of actions) this.actions.set(action.name, action);
  }

  /** All registered actions — used to build tool specs, help text, etc. */
  list(): GameAction[] {
    return [...this.actions.values()];
  }

  /** Invoke an action by name with raw args. Unknown actions fail cleanly. */
  invoke(name: string, args: Record<string, unknown> = {}): ActionResult {
    const action = this.actions.get(name);
    if (!action) return { ok: false, message: `Unknown action "${name}".` };
    return action.execute(args, this.context);
  }
}
