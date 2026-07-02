import { Faction, PlayerRecord } from '../world';
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
    // Defensive copy so callers can't mutate our records behind our back.
    this.players = players.map((player) => ({ ...player }));
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
      lines.push(
        `- ${player.name} [${player.id}] — ${player.faction}, ${player.controller}-controlled, ` +
          `agent ${player.agentId} — directive: ${directive}`,
      );
    }
    return lines.join('\n');
  }
}
