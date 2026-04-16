/**
 * Tool Registry — Inspired by browser-use's @tools.action() decorator pattern
 *
 * Provides a clean, declarative way to register custom tools for the agent.
 * Instead of manually building JSON tool definitions and switch-case handlers,
 * tools are registered as simple objects with metadata + handler functions.
 *
 * Usage:
 *   const registry = new ToolRegistry();
 *
 *   registry.register({
 *     name: "save_to_crm",
 *     description: "Save extracted data to CRM",
 *     parameters: {
 *       name: { type: "string", description: "Contact name", required: true },
 *       email: { type: "string", description: "Email address", required: true },
 *     },
 *     handler: async (args) => {
 *       await crmApi.createLead(args);
 *       return `Saved ${args.name} to CRM`;
 *     },
 *   });
 *
 *   // Auto-generates OpenAI function tool definitions
 *   const toolDefs = registry.toOpenAIToolDefinitions();
 *
 *   // Execute by name
 *   const result = await registry.execute("save_to_crm", { name: "John", email: "j@e.com" });
 */

// ── Types ────────────────────────────────────────────────────────────

export interface ToolParameter {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
}

export interface ToolDefinition {
  /** Unique tool name (snake_case recommended) */
  name: string;
  /** Human-readable description — shown to the LLM */
  description: string;
  /** Parameter definitions */
  parameters: Record<string, ToolParameter>;
  /** Async handler function */
  handler: (args: Record<string, unknown>) => Promise<string>;
  /** Whether this tool is currently enabled */
  enabled?: boolean;
  /** Category for grouping (e.g., "browser", "data", "crm") */
  category?: string;
}

export interface ToolOutput {
  text: string;
  type: "input_text";
}

interface OpenAIToolDefinition {
  type: "function";
  name: string;
  description: string;
  strict: boolean;
  parameters: {
    additionalProperties: boolean;
    properties: Record<string, unknown>;
    required: string[];
    type: "object";
  };
}

// ── Registry ─────────────────────────────────────────────────────────

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  /**
   * Register a new tool. Throws if a tool with the same name already exists.
   */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, { enabled: true, ...tool });
  }

  /**
   * Register multiple tools at once.
   */
  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Unregister a tool by name.
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Enable or disable a tool without removing it.
   */
  setEnabled(name: string, enabled: boolean): void {
    const tool = this.tools.get(name);
    if (tool) {
      tool.enabled = enabled;
    }
  }

  /**
   * Check if a tool name is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all registered tool names.
   */
  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get tool definitions grouped by category.
   */
  getByCategory(): Map<string, ToolDefinition[]> {
    const categories = new Map<string, ToolDefinition[]>();
    for (const tool of this.tools.values()) {
      const cat = tool.category ?? "uncategorized";
      const list = categories.get(cat) ?? [];
      list.push(tool);
      categories.set(cat, list);
    }
    return categories;
  }

  /**
   * Execute a tool by name with given arguments.
   */
  async execute(name: string, args: Record<string, unknown>): Promise<ToolOutput[]> {
    const tool = this.tools.get(name);
    if (!tool) {
      return [{ text: `Unknown tool: "${name}". Available: ${this.getNames().join(", ")}`, type: "input_text" }];
    }

    if (!tool.enabled) {
      return [{ text: `Tool "${name}" is currently disabled.`, type: "input_text" }];
    }

    try {
      const result = await tool.handler(args);
      return [{ text: result, type: "input_text" }];
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return [{ text: `Tool "${name}" failed: ${msg}`, type: "input_text" }];
    }
  }

  /**
   * Convert all enabled tools to OpenAI function tool definitions.
   * These can be passed directly to the Responses API tools array.
   */
  toOpenAIToolDefinitions(): OpenAIToolDefinition[] {
    const defs: OpenAIToolDefinition[] = [];

    for (const tool of this.tools.values()) {
      if (!tool.enabled) continue;

      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [paramName, param] of Object.entries(tool.parameters)) {
        const prop: Record<string, unknown> = {
          type: param.type,
          description: param.description,
        };

        if (param.enum) {
          prop.enum = param.enum;
        }

        properties[paramName] = prop;

        if (param.required !== false) {
          // Default to required unless explicitly set to false
          required.push(paramName);
        }
      }

      defs.push({
        type: "function",
        name: tool.name,
        description: tool.description,
        strict: true,
        parameters: {
          additionalProperties: false,
          properties,
          required,
          type: "object",
        },
      });
    }

    return defs;
  }

  /**
   * Get a human-readable summary of all registered tools.
   * Useful for debugging and logging.
   */
  summarize(): string {
    const lines: string[] = [`Registered tools (${this.tools.size}):`];
    for (const tool of this.tools.values()) {
      const status = tool.enabled ? "✅" : "❌";
      const paramCount = Object.keys(tool.parameters).length;
      const cat = tool.category ? ` [${tool.category}]` : "";
      lines.push(`  ${status} ${tool.name}${cat} — ${paramCount} params — ${tool.description.slice(0, 60)}`);
    }
    return lines.join("\n");
  }
}
