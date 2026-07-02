import { Faction, PlayerRecord, PlayerResources, ResourceKind } from '../world';
import { PlayerSnapshot } from './types';

/**
 * The authoritative registry of players. Multiplayer-ready: it holds every
 * player seat, all agent-driven in the long run, and owns each player's
 * controller kind, linked agent, and standing directive. Modeled and serialized
 * the same way {@link GameState} is — a plain class with lookups, mutators and a
 * {@link snapshot}; it holds no Phaser objects.
 *
 * The `directive` is the durable cross-mode handoff: the command-mode agent
 * writes it (via the set_directive action) and the autonomous loop reads it each
 * tick. Chat-busy is transient coordination state (is the human currently
 * driving this player from the panel?) so it lives here as a side set rather
 * than in the serialized record — mirroring how GameScene keeps attack cooldowns
 * out of the shared GameState.
 */
export class PlayerRegistry {
  private readonly players: PlayerRecord[];
  // Players whose human is mid-chat, so the autonomous loop can defer to mode 1.
  private readonly chatBusy = new Set<string>();

  constructor(players: PlayerRecord[]) {
    // Defensive copy so callers can't mutate our records behind our back — the
    // resources record is nested, so copy that too rather than sharing the ref.
    this.players = players.map((player) => ({ ...player, resources: { ...player.resources } }));
  }

  // --- Reads ----------------------------------------------------------------

  getPlayers(): readonly PlayerRecord[] {
    return this.players;
  }

  getPlayer(playerId: string): PlayerRecord | undefined {
    return this.players.find((player) => player.id === playerId);
  }

  getPlayerByFaction(faction: Faction): PlayerRecord | undefined {
    return this.players.find((player) => player.faction === faction);
  }

  getDirective(playerId: string): string {
    return this.getPlayer(playerId)?.directive ?? '';
  }

  /** A player's current resource stockpile (a copy), or undefined if no player. */
  getResources(playerId: string): PlayerResources | undefined {
    const player = this.getPlayer(playerId);
    return player ? { ...player.resources } : undefined;
  }

  isChatBusy(playerId: string): boolean {
    return this.chatBusy.has(playerId);
  }

  // --- Mutations ------------------------------------------------------------

  /** Set a player's standing directive. Returns false if no such player. */
  setDirective(playerId: string, directive: string): boolean {
    const player = this.getPlayer(playerId);
    if (!player) return false;
    player.directive = directive;
    return true;
  }

  /**
   * Add `amount` of `kind` to a player's stockpile (never dropping below 0) and
   * return the new total, or undefined if there's no such player. This is how a
   * Collector's gathered resource lands in the owning player's state.
   */
  addResource(playerId: string, kind: ResourceKind, amount: number): number | undefined {
    const player = this.getPlayer(playerId);
    if (!player) return undefined;
    player.resources[kind] = Math.max(0, (player.resources[kind] ?? 0) + amount);
    return player.resources[kind];
  }

  /** Mark/unmark a player as currently being driven by the human via chat. */
  setChatBusy(playerId: string, busy: boolean): void {
    if (busy) this.chatBusy.add(playerId);
    else this.chatBusy.delete(playerId);
  }

  // --- Serialization --------------------------------------------------------

  snapshot(): PlayerSnapshot[] {
    return this.players.map((player) => ({
      id: player.id,
      name: player.name,
      faction: player.faction,
      controller: player.controller,
      agentId: player.agentId,
      directive: player.directive,
      resources: { ...player.resources },
    }));
  }

  /**
   * Render players as a compact, labeled text block for LLM context, matching
   * GameState.toPromptText()'s style (ids in [brackets]). Each player's standing
   * directive is included so an agent sees its own operating plan.
   */
  toPromptText(): string {
    const lines: string[] = ['=== Players ==='];
    for (const player of this.players) {
      const directive = player.directive.trim() ? player.directive.trim() : '(none)';
      const resources = formatResources(player.resources);
      lines.push(
        `- ${player.name} [${player.id}] — ${player.faction}, ${player.controller}-controlled, ` +
          `agent ${player.agentId} — resources: ${resources} — directive: ${directive}`,
      );
    }
    return lines.join('\n');
  }
}

/** Render a stockpile as a compact "resource1 12" list, or "none" when empty. */
function formatResources(resources: PlayerResources): string {
  const entries = Object.entries(resources);
  if (entries.length === 0) return 'none';
  return entries.map(([kind, amount]) => `${kind} ${amount}`).join(', ');
}
