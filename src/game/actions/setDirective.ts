import { ActionResult, Actor, GameAction, GameContext } from './types';

export interface SetDirectiveArgs extends Record<string, unknown> {
  directive: string;
}

/**
 * Record the acting player's standing operating plan. The autonomous "play the
 * game" loop reads this directive each tick and behaves accordingly, so this is
 * how a command-mode conversation turns into durable standing orders. It writes
 * only to the acting player's own directive (identity comes from the bound
 * actor, not an argument), so an agent can't steer another player.
 */
export const setDirectiveAction: GameAction<SetDirectiveArgs> = {
  name: 'set_directive',
  description:
    'Set your standing directive — the operating plan your autonomous control loop follows ' +
    "each turn when the commander isn't actively steering you. Use this to capture the " +
    'commander\'s intent as durable orders, e.g. "Hold position and do not engage", "Scout the ' +
    'eastern ridge, avoid combat", or "Press the assault on the enemy base". A new directive ' +
    'replaces the previous one; pass an empty string to stand down and clear it. This does not ' +
    'move or attack with any unit by itself; it records the intent the loop then acts on.',
  parameters: {
    type: 'object',
    properties: {
      directive: {
        type: 'string',
        description: 'The standing operating plan, in plain language. Empty string clears it.',
      },
    },
    required: ['directive'],
  },
  execute(args, context: GameContext, actor: Actor): ActionResult {
    const directive = typeof args?.directive === 'string' ? args.directive.trim() : '';
    const ok = context.setPlayerDirective(actor.playerId, directive);
    if (!ok) {
      return { ok: false, message: `Could not set directive: no active player "${actor.playerId}".` };
    }
    return directive
      ? { ok: true, message: `Directive set: "${directive}".` }
      : { ok: true, message: 'Directive cleared; standing down.' };
  },
};
