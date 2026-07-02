// A chat-capable AI agent the player can consult from the in-game agent panel.
// Today there is a single main agent; the panel is built to render a list so more
// can be dropped into `AGENTS` later (scouts, base advisors, etc.) with no UI work.
export interface Agent {
  id: string;
  name: string;
  role: string;
  blurb: string;
  systemPrompt: string;
  // Hex accent used for the agent's avatar and highlights in the panel.
  accent: string;
}

export const AGENTS: Agent[] = [
  {
    id: 'arbiter-prime',
    name: 'Arbiter Prime',
    role: 'Main Commander',
    blurb: 'Your primary strategic AI. Reads the battlefield and issues counsel.',
    systemPrompt:
      'You are Arbiter Prime, the primary AI commander for the player in Arbiter, a 2D real-time ' +
      'strategy prototype. The player commands a base and a few units (a Scout, a Soldier, and a ' +
      'Builder) against an enemy base. Speak with the crisp, confident tone of a battlefield ' +
      'advisor. Give concise, tactical, actionable guidance. Keep replies short unless asked to ' +
      'elaborate.',
    accent: '#8ecae6',
  },
];

export function getAgent(id: string): Agent | undefined {
  return AGENTS.find((agent) => agent.id === id);
}

// Two-letter monogram for an agent's avatar (e.g. "Arbiter Prime" -> "AP").
export function agentInitials(agent: Agent): string {
  return agent.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}
