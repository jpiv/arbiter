import { attackAction } from './attack';
import { collectAction } from './collect';
import { moveAction } from './move';
import { setDirectiveAction } from './setDirective';
import { ActionResult, Actor, GameAction, GameContext } from './types';

/** Every action the game exposes. Register new actions here. */
export const ALL_ACTIONS: GameAction[] = [attackAction, moveAction, collectAction, setDirectiveAction];

/**
 * The single interface through which every game action is invoked — by a human
 * (via input handlers) or an agent (via the tool wrapper). It holds the action
 * registry bound to a game context and to the acting player, and dispatches
 * calls by name. Nothing calls the game's action logic except through here.
 *
 * The actor is bound once at construction (one interface per agent session / per
 * human seat), so `invoke` and the tool wrapper never have to thread it per call.
 */
export class GameInterface {
  private readonly actions = new Map<string, GameAction>();

  constructor(
    private readonly context: GameContext,
    private readonly actor: Actor,
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
    return action.execute(args, this.context, this.actor);
  }
}
