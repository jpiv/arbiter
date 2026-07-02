import { ActionResult, Actor, GameAction, GameContext } from './types';

export interface MoveArgs extends Record<string, unknown> {
  unitId: string;
  x: number;
  y: number;
}

/**
 * Order a unit to path to a tile on the map's grid. Coordinates are grid cells:
 * column `x` (0 is the left edge) and row `y` (0 is the top edge). The unit walks
 * toward the center of that tile at its own speed and stops on arrival. Issuing a
 * move cancels any attack order.
 */
export const moveAction: GameAction<MoveArgs> = {
  name: 'move',
  description:
    "Order a unit to move to a tile on the map's grid, given as a column (x, 0 is the " +
    'left edge) and row (y, 0 is the top edge). The unit paths toward the center of that ' +
    'tile at its own speed and stops when it arrives. This cancels any attack order the ' +
    'unit currently has.',
  parameters: {
    type: 'object',
    properties: {
      unitId: {
        type: 'string',
        description: 'ID of the unit to move, e.g. "unit-soldier-1".',
      },
      x: {
        type: 'integer',
        description: 'Destination column (grid tile index from the left, starting at 0).',
      },
      y: {
        type: 'integer',
        description: 'Destination row (grid tile index from the top, starting at 0).',
      },
    },
    required: ['unitId', 'x', 'y'],
  },
  execute(args, context: GameContext, actor: Actor): ActionResult {
    const unitId = typeof args?.unitId === 'string' ? args.unitId : '';
    const x = typeof args?.x === 'number' ? args.x : NaN;
    const y = typeof args?.y === 'number' ? args.y : NaN;

    if (!unitId) return fail('A "unitId" is required to issue a move order.');
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return fail('Numeric "x" and "y" grid coordinates are required to issue a move order.');
    }

    const unit = context.getUnit(unitId);
    if (!unit) return fail(`No unit found with id "${unitId}".`);
    if (!context.playerOwnsUnit(actor.playerId, unit.id)) {
      return fail(`${unit.name} is not one of your units to command.`);
    }

    // Snap to a whole tile and keep it inside the map's grid.
    const { columns, rows } = context.getMapBounds();
    const tileX = clamp(Math.floor(x), 0, columns - 1);
    const tileY = clamp(Math.floor(y), 0, rows - 1);

    context.issueMoveOrder(unit.id, tileX, tileY);
    return { ok: true, message: `${unit.name} is moving to tile (${tileX}, ${tileY}).` };
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function fail(message: string): ActionResult {
  return { ok: false, message };
}
