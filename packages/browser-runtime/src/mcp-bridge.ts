/**
 * MCP Bridge — Connects to Playwright MCP server for A11y-tree-based perception.
 *
 * Architecture:
 *   Chrome (CDP :9222) ← Playwright MCP (subprocess, stdio) ← MCPBridge (this module)
 *
 * The bridge spawns @playwright/mcp as a child process, connects via MCP SDK's
 * stdio transport, and provides clean async methods for each browser tool.
 *
 * Why MCP instead of direct Playwright?
 *   - A11y tree snapshot is 10x cheaper than Vision model screenshots
 *   - Structured element refs instead of pixel coordinates
 *   - Standard protocol — can swap Playwright MCP for any browser MCP server
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ── Types ────────────────────────────────────────────────────────────

export interface MCPBridgeOptions {
  /** CDP WebSocket endpoint (e.g. ws://localhost:9222/devtools/browser/...) */
  cdpEndpoint?: string;
  /** Browser mode: run headless or headed */
  headless?: boolean;
  /** User data directory for browser profile */
  userDataDir?: string;
  /** Viewport dimensions */
  viewport?: { width: number; height: number };
}

export interface MCPSnapshot {
  /** Raw A11y tree text from Playwright MCP */
  content: string;
  /** Page URL at time of snapshot */
  url?: string;
  /** Page title at time of snapshot */
  title?: string;
}

export interface MCPToolResult {
  success: boolean;
  content: string;
  error?: string;
}

// ── MCPBridge Class ──────────────────────────────────────────────────

export class MCPBridge {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private options: MCPBridgeOptions;
  private connected = false;
  private availableTools: string[] = [];

  constructor(options: MCPBridgeOptions = {}) {
    this.options = options;
  }

  /** Start the Playwright MCP subprocess and connect via stdio */
  async connect(): Promise<void> {
    if (this.connected) return;

    console.log(`[mcp-bridge] 🔌 Starting Playwright MCP server...`);

    // Build args for Playwright MCP
    const args: string[] = ["-y", "@playwright/mcp@latest"];

    if (this.options.cdpEndpoint) {
      args.push("--cdp-endpoint", this.options.cdpEndpoint);
      console.log(`[mcp-bridge] 📡 Connecting to CDP: ${this.options.cdpEndpoint}`);
    }

    if (this.options.headless !== false) {
      args.push("--headless");
    }

    if (this.options.userDataDir) {
      args.push("--user-data-dir", this.options.userDataDir);
    }

    if (this.options.viewport) {
      args.push("--viewport-size", `${this.options.viewport.width}x${this.options.viewport.height}`);
    }

    try {
      this.transport = new StdioClientTransport({
        command: "npx",
        args,
      });

      this.client = new Client(
        { name: "autopilot-agent", version: "1.0.0" },
        { capabilities: {} },
      );

      await this.client.connect(this.transport);

      // Discover available tools
      const toolList = await this.client.listTools();
      this.availableTools = toolList.tools.map((t) => t.name);
      this.connected = true;

      console.log(`[mcp-bridge] ✅ Connected. Available tools: ${this.availableTools.join(", ")}`);
    } catch (err) {
      console.error(`[mcp-bridge] ❌ Failed to connect:`, err);
      await this.disconnect();
      throw err;
    }
  }

  /** Check if bridge is connected */
  isConnected(): boolean {
    return this.connected;
  }

  /** Get list of available MCP tools */
  getAvailableTools(): string[] {
    return [...this.availableTools];
  }

  /** Call a raw MCP tool by name */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<MCPToolResult> {
    if (!this.client || !this.connected) {
      return { success: false, content: "", error: "MCP bridge not connected" };
    }

    try {
      const result = await this.client.callTool({ name, arguments: args });
      const textContent = (result.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");

      const res: MCPToolResult = {
        success: !result.isError,
        content: textContent,
      };
      if (result.isError) res.error = textContent;
      return res;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return { success: false, content: "", error: errMsg };
    }
  }

  // ── High-Level Browser Methods ──────────────────────────────────────

  /**
   * Get A11y tree snapshot of the current page.
   * This is the PRIMARY perception method — replaces screenshot-based vision.
   * Returns structured text that the LLM can parse cheaply.
   */
  async snapshot(): Promise<MCPSnapshot> {
    const result = await this.callTool("browser_snapshot");

    return {
      content: result.success ? result.content : `[MCP Error] ${result.error}`,
    };
  }

  /** Navigate to a URL */
  async navigate(url: string): Promise<MCPToolResult> {
    return this.callTool("browser_navigate", { url });
  }

  /** Click an element by its A11y ref (from snapshot) */
  async click(element: string, ref: string): Promise<MCPToolResult> {
    return this.callTool("browser_click", { element, ref });
  }

  /** Type text into an element */
  async type(element: string, ref: string, text: string): Promise<MCPToolResult> {
    return this.callTool("browser_type", { element, ref, text });
  }

  /** Press a keyboard key */
  async pressKey(key: string): Promise<MCPToolResult> {
    return this.callTool("browser_press_key", { key });
  }

  /** Scroll the page */
  async scroll(direction: "up" | "down", amount?: number): Promise<MCPToolResult> {
    const delta = direction === "up" ? -(amount ?? 300) : (amount ?? 300);
    return this.callTool("browser_scroll", { delta_y: delta });
  }

  /** Take a screenshot (returns base64) */
  async screenshot(): Promise<MCPToolResult> {
    return this.callTool("browser_take_screenshot");
  }

  /** Go back in browser history */
  async goBack(): Promise<MCPToolResult> {
    return this.callTool("browser_go_back");
  }

  /** Go forward in browser history */
  async goForward(): Promise<MCPToolResult> {
    return this.callTool("browser_go_forward");
  }

  /** Select dropdown option */
  async selectOption(element: string, ref: string, values: string[]): Promise<MCPToolResult> {
    return this.callTool("browser_select_option", { element, ref, values });
  }

  /** Hover over an element */
  async hover(element: string, ref: string): Promise<MCPToolResult> {
    return this.callTool("browser_hover", { element, ref });
  }

  /** Wait for a specific condition */
  async wait(timeMs: number = 2000): Promise<MCPToolResult> {
    return this.callTool("browser_wait", { time: timeMs });
  }

  /** Get list of all open tabs */
  async getTabs(): Promise<MCPToolResult> {
    return this.callTool("browser_tab_list");
  }

  /** Switch to a tab by index */
  async switchTab(index: number): Promise<MCPToolResult> {
    return this.callTool("browser_tab_select", { index });
  }

  /** Open a new tab */
  async newTab(url?: string): Promise<MCPToolResult> {
    return this.callTool("browser_tab_new", url ? { url } : {});
  }

  /** Close the current tab */
  async closeTab(): Promise<MCPToolResult> {
    return this.callTool("browser_tab_close");
  }

  /** Disconnect and clean up */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.availableTools = [];

    try {
      if (this.client) {
        await this.client.close();
        this.client = null;
      }
    } catch {
      // Client may already be closed
    }

    try {
      if (this.transport) {
        await this.transport.close();
        this.transport = null;
      }
    } catch {
      // Transport may already be closed
    }

    console.log(`[mcp-bridge] 🔌 Disconnected`);
  }
}

// ── Singleton Management ──────────────────────────────────────────────

let globalBridge: MCPBridge | null = null;

/**
 * Get or create the global MCP bridge instance.
 * Lazy-initialized on first call with auto-connect.
 */
export async function getMCPBridge(options?: MCPBridgeOptions): Promise<MCPBridge> {
  if (globalBridge?.isConnected()) {
    return globalBridge;
  }

  globalBridge = new MCPBridge(options);
  await globalBridge.connect();
  return globalBridge;
}

/**
 * Try to get the MCP bridge, returning null if unavailable.
 * Use this when MCP is optional (graceful fallback to DOM indexer).
 */
export async function tryGetMCPBridge(options?: MCPBridgeOptions): Promise<MCPBridge | null> {
  try {
    return await getMCPBridge(options);
  } catch (err) {
    console.warn(`[mcp-bridge] ⚠️ MCP unavailable, falling back to DOM indexer:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Shut down the global MCP bridge */
export async function shutdownMCPBridge(): Promise<void> {
  if (globalBridge) {
    await globalBridge.disconnect();
    globalBridge = null;
  }
}
