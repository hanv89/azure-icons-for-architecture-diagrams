#!/usr/bin/env node

import { Command } from "commander";
import pkg from "../package.json";
import { claudeCodeAdapter } from "./adapters/claude-code";
import { Adapter } from "./adapters/types";

const ADAPTERS: Record<string, Adapter> = {
  "claude-code": claudeCodeAdapter,
};
const SUPPORTED_AGENTS = Object.keys(ADAPTERS);

function pickAdapter(agent: string): Adapter {
  const adapter = ADAPTERS[agent];
  if (!adapter) {
    throw new Error(`unknown agent: ${agent} (supported: ${SUPPORTED_AGENTS.join(", ")})`);
  }
  return adapter;
}

const program = new Command()
  .name("azure-arch-skill")
  .description("Install the Azure architecture diagram skill into your AI coding agent.")
  .version(pkg.version, "-V, --version");

function defineSubcommand(name: keyof Adapter, description: string): void {
  program
    .command(name)
    .description(description)
    .requiredOption("--agent <name>", `target AI agent (${SUPPORTED_AGENTS.join("|")})`)
    .option("--target <dir>", "override target directory (validation use)")
    .action(async (opts) => {
      const code = await pickAdapter(opts.agent)[name]({ target: opts.target });
      process.exit(code);
    });
}

defineSubcommand("install",   "Install the skill into an AI agent's skill folder.");
defineSubcommand("uninstall", "Remove a previously installed skill.");
defineSubcommand("update",    "Update an installed skill to the latest version.");
defineSubcommand("list",      "List installed skills and their versions.");

program.parseAsync(process.argv).catch(err => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
