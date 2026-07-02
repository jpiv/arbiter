import { UnitRole } from '../world';
import { ActionResult, GameAction, GameContext } from './types';

export interface CollectArgs extends Record<string, unknown> {
  unitId: string;
  nodeId: string;
}

/**
 * Order a Collector to march toward a resource node and gather from it once in
 * range. Mirrors the attack action's path-then-act loop: the unit keeps mining
 * — crediting its owner's stockpile each tick — until the node's reserve is
 * exhausted or a new order replaces it. Only Collector units can gather.
 */
export const collectAction: GameAction<CollectArgs> = {
  name: 'collect',
  description:
    'Order a Collector unit to move to a resource node and gather from it once within range. ' +
    "The unit paths to the node automatically and keeps mining — adding to the player's " +
    'resource stockpile — until the node is depleted or the unit receives a new order. Only ' +
    'units with the Collector role can gather; other roles will be rejected.',
  parameters: {
    type: 'object',
    properties: {
      unitId: {
        type: 'string',
        description: 'ID of the Collector unit that should gather, e.g. "unit-collector-1".',
      },
      nodeId: {
        type: 'string',
        description: 'ID of the resource node to gather from, e.g. "node-r1-a".',
      },
    },
    required: ['unitId', 'nodeId'],
  },
  execute(args, context: GameContext): ActionResult {
    const unitId = typeof args?.unitId === 'string' ? args.unitId : '';
    const nodeId = typeof args?.nodeId === 'string' ? args.nodeId : '';

    if (!unitId) return fail('A "unitId" is required to issue a collect order.');
    if (!nodeId) return fail('A "nodeId" is required to issue a collect order.');

    const unit = context.getUnit(unitId);
    if (!unit) return fail(`No unit found with id "${unitId}".`);
    if (unit.config.role !== UnitRole.Collector) {
      return fail(`${unit.name} is a ${unit.config.role}, not a Collector; only Collectors can gather resources.`);
    }

    const target = context.getCollectTarget(nodeId);
    if (!target) return fail(`No resource node found with id "${nodeId}".`);

    context.issueCollectOrder(unit.id, target.id);
    return { ok: true, message: `${unit.name} is moving to gather ${target.resource} from ${target.name}.` };
  },
};

function fail(message: string): ActionResult {
  return { ok: false, message };
}
