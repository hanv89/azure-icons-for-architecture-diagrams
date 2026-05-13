import * as path from "node:path";
import * as os from "node:os";
import { Adapter } from "./types";
import { fetchWithTimeout, makeFolderInstallAdapter, parseFrontmatter } from "./_shared";

// Re-exports so existing test imports (claude-code.test.ts) keep working
// without touching their source. New tests can import from "./_shared" directly.
export { fetchWithTimeout, parseFrontmatter };

function claudeRootDir(): string {
  return path.join(os.homedir(), ".claude");
}

export const claudeCodeAdapter: Adapter = makeFolderInstallAdapter({
  rootDir: claudeRootDir,
  rootDisplay: () => "~/.claude",
  agentFlag: "claude-code",
});
