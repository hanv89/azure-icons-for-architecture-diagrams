#!/usr/bin/env node

import { Command } from "commander";
import pkg from "../package.json";
import { ADAPTERS, AgentName, ALL_TARGET, SUPPORTED_AGENTS, SUPPORTED_TARGETS } from "./adapters/registry";
import { Adapter } from "./adapters/types";
import { runOverAll, Subcommand } from "./all";

function pickAdapter(agent: string): Adapter {
  if (!(agent in ADAPTERS)) {
    throw new Error(`unknown agent: ${agent} (supported: ${SUPPORTED_TARGETS.join(", ")})`);
  }
  return ADAPTERS[agent as AgentName];
}

const program = new Command()
  .name("azure-arch-skill")
  .description("Install the Azure architecture diagram skill into your AI coding agent.")
  .version(pkg.version, "-V, --version");

function defineSubcommand(name: Subcommand, description: string): void {
  program
    .command(name)
    .description(description)
    .requiredOption("--agent <name>", `target AI agent (${SUPPORTED_TARGETS.join("|")})`)
    .option("--target <dir>", "override target directory (validation use)")
    .action(async (opts) => {
      // Set process.exitCode so any pending async cleanup (file handles, the
      // override-warning stderr write) drains before the event loop empties.
      // Both this top-level path and adapter-internal failures emit a single
      // '^fatal: ' prefix line on stderr — log-parsers can rely on the prefix.
      const optsForAdapter = { target: opts.target };
      if (opts.agent === ALL_TARGET) {
        process.exitCode = await runOverAll(name, optsForAdapter);
        return;
      }
      if (!SUPPORTED_AGENTS.includes(opts.agent)) {
        throw new Error(`unknown agent: ${opts.agent} (supported: ${SUPPORTED_TARGETS.join(", ")})`);
      }
      process.exitCode = await pickAdapter(opts.agent)[name](optsForAdapter);
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
