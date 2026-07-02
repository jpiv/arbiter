import { ActionResult, GameAction, GameContext } from './types';

export interface AttackArgs extends Record<string, unknown> {
  unitId: string;
  targetId: string;
}

/**
 * Order a unit to march toward a target and attack it once in range. This wraps
 * the existing path + attack loop; the unit keeps attacking until the target is
 * destroyed or a new order replaces it.
 */
export const attackAction: GameAction<AttackArgs> = {
  name: 'attack',
  description:
    'Order a unit to move toward a target and attack it once within range. The unit ' +
    'paths to the target automatically and keeps attacking until the target is ' +
    'destroyed or the unit receives a new order.',
  parameters: {
    type: 'object',
    properties: {
      unitId: {
        type: 'string',
        description: 'ID of the unit that should carry out the attack, e.g. "unit-soldier-1".',
      },
      targetId: {
        type: 'string',
        description: 'ID of the target to attack, e.g. an enemy base like "base-omega".',
      },
    },
    required: ['unitId', 'targetId'],
  },
  execute(args, context: GameContext): ActionResult {
    const unitId = typeof args?.unitId === 'string' ? args.unitId : '';
    const targetId = typeof args?.targetId === 'string' ? args.targetId : '';

    if (!unitId) return fail('An "unitId" is required to issue an attack order.');
    if (!targetId) return fail('A "targetId" is required to issue an attack order.');

    const unit = context.getUnit(unitId);
    if (!unit) return fail(`No unit found with id "${unitId}".`);

    const target = context.getAttackTarget(targetId);
    if (!target) return fail(`No attackable target found with id "${targetId}".`);

    context.issueAttackOrder(unit.id, target.id);
    return { ok: true, message: `${unit.name} is moving to attack ${target.name}.` };
  },
};

function fail(message: string): ActionResult {
  return { ok: false, message };
}
