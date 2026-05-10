#!/usr/bin/env node

import { Command } from "commander";
import pkg from "../package.json";
import { claudeCodeAdapter } from "./adapters/claude-code";
import { Adapter } from "./adapters/types";

function pickAdapter(agent: string): Adapter {
  switch (agent) {
    case "claude-code": return claudeCodeAdapter;
    default:
      throw new Error(`unknown agent: ${agent} (supported: claude-code)`);
  }
}

const program = new Command()
  .name("azure-arch-skill")
  .description("Install the Azure architecture diagram skill into your AI coding agent.")
  .version(pkg.version, "-V, --version");

program
  .command("install")
  .description("Install the skill into an AI agent's skill folder.")
  .requiredOption("--agent <name>", "target AI agent (claude-code)")
  .option("--target <dir>", "override target directory (validation use)")
  .action(async (opts) => {
    const code = await pickAdapter(opts.agent).install({ target: opts.target });
    process.exit(code);
  });

program
  .command("uninstall")
  .description("Remove a previously installed skill.")
  .requiredOption("--agent <name>", "target AI agent (claude-code)")
  .option("--target <dir>", "override target directory (validation use)")
  .action(async (opts) => {
    const code = await pickAdapter(opts.agent).uninstall({ target: opts.target });
    process.exit(code);
  });

program
  .command("update")
  .description("Update an installed skill to the latest version.")
  .requiredOption("--agent <name>", "target AI agent (claude-code)")
  .option("--target <dir>", "override target directory (validation use)")
  .action(async (opts) => {
    const code = await pickAdapter(opts.agent).update({ target: opts.target });
    process.exit(code);
  });

program
  .command("list")
  .description("List installed skills and their versions.")
  .requiredOption("--agent <name>", "target AI agent (claude-code)")
  .option("--target <dir>", "override skills root directory (validation use)")
  .action(async (opts) => {
    const code = await pickAdapter(opts.agent).list({ target: opts.target });
    process.exit(code);
  });

program.parseAsync(process.argv).catch(err => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
