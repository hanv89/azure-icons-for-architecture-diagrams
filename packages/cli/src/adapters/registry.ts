import { Adapter } from "./types";
import { claudeCodeAdapter } from "./claude-code";
import { codexAdapter } from "./codex";
import { cursorAdapter } from "./cursor";

// Single source of truth for the supported-agent set. Add a new adapter by
// importing it here and adding one entry below; both `src/index.ts` (CLI
// dispatch + --agent help text) and `adapters-roundtrip.test.ts` (test loop)
// read from this map directly.

export const ADAPTERS = {
  "claude-code": claudeCodeAdapter,
  "codex":       codexAdapter,
  "cursor":      cursorAdapter,
} as const satisfies Record<string, Adapter>;

export type AgentName = keyof typeof ADAPTERS;

export const SUPPORTED_AGENTS: AgentName[] = Object.keys(ADAPTERS) as AgentName[];
