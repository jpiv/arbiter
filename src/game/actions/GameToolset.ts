import { GameInterface } from './GameInterface';
import { ActionResult, JsonSchema } from './types';

/** OpenAI / OpenRouter-style function tool definition. */
export interface ToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

/**
 * Wraps a {@link GameInterface} as a set of LLM tools. `specs()` yields the tool
 * definitions to advertise to a model; `call()` takes a tool call the model
 * emitted (name + JSON args) and routes it through the interface.
 *
 * This is the seam where LLM tool-calling plugs in later — nothing here talks to
 * a model yet.
 */
export class GameToolset {
  constructor(private readonly game: GameInterface) {}

  /** Tool definitions to advertise to a model. */
  specs(): ToolSpec[] {
    return this.game.list().map((action) => ({
      type: 'function',
      function: {
        name: action.name,
        description: action.description,
        parameters: action.parameters,
      },
    }));
  }

  /**
   * Execute a tool call. `args` may be a JSON string (as models emit) or an
   * already-parsed object; malformed JSON fails cleanly rather than throwing.
   */
  call(name: string, args: string | Record<string, unknown> = {}): ActionResult {
    let parsed: Record<string, unknown>;
    if (typeof args === 'string') {
      try {
        parsed = args.trim() ? (JSON.parse(args) as Record<string, unknown>) : {};
      } catch {
        return { ok: false, message: `Could not parse JSON arguments for tool "${name}".` };
      }
    } else {
      parsed = args ?? {};
    }
    return this.game.invoke(name, parsed);
  }
}
