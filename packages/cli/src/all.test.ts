import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runOverAll } from "./all";

// ---- Fixture (shared shape with adapters-roundtrip.test.ts) ----

const SYNTHETIC_SKILL_MD = [
  "---",
  "name: azure-architecture-diagram",
  "description: test fixture",
  "version: 0.6.0",
  'requires_icons: ">=0.2.2"',
  "---",
  "# Test skill body",
].join("\n");

const SYNTHETIC_EXAMPLE = "@startuml\ntitle Test\n@enduml\n";

const SYNTHETIC_MANIFEST = {
  $schema: "./manifest.schema.json",
  name: "azure-architecture-diagram",
  version: "0.6.0",
  requires_icons: ">=0.2.2",
  files: [
    { src: "dist/skill/SKILL.md", dest: "SKILL.md", role: "skill" },
    { src: "dist/skill/examples/01-context.puml", dest: "examples/01-context.puml", role: "example" },
  ],
};

const realFetch = globalThis.fetch;

function happyFetchMock(): { restore: () => void } {
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = url.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "HEAD") return new Response(null, { status: 200 });
    if (u.endsWith("/dist/skill/manifest.json")) {
      return new Response(JSON.stringify(SYNTHETIC_MANIFEST), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.endsWith("/dist/skill/SKILL.md")) return new Response(SYNTHETIC_SKILL_MD, { status: 200 });
    if (u.endsWith("/dist/skill/examples/01-context.puml")) return new Response(SYNTHETIC_EXAMPLE, { status: 200 });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = realFetch; } };
}

// Fail-on-Nth-canary mock: every request succeeds EXCEPT the HEAD canary,
// which fails after `failOnHeadIndex` successful HEADs. This makes Cursor's
// (or any adapter's) install fail at the canary reachability check while
// earlier adapters' installs complete.
function failOnNthHeadFetchMock(failOnHeadIndex: number): { restore: () => void; headCount: () => number } {
  let headCount = 0;
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = url.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "HEAD") {
      headCount++;
      if (headCount === failOnHeadIndex) {
        return new Response(null, { status: 404 });
      }
      return new Response(null, { status: 200 });
    }
    if (u.endsWith("/dist/skill/manifest.json")) {
      return new Response(JSON.stringify(SYNTHETIC_MANIFEST), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.endsWith("/dist/skill/SKILL.md")) return new Response(SYNTHETIC_SKILL_MD, { status: 200 });
    if (u.endsWith("/dist/skill/examples/01-context.puml")) return new Response(SYNTHETIC_EXAMPLE, { status: 200 });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return {
    restore: () => { globalThis.fetch = realFetch; },
    headCount: () => headCount,
  };
}

function mkTmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "azure-arch-skill-test-"));
}

function rmTmpdir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

interface SilencedStreams {
  restore: () => void;
}

// Silence stderr summary lines so the test reporter's output stays readable.
// We deliberately do NOT silence stdout: hijacking process.stdout.write inside
// a node:test test confuses the runner's buffered reporter — other tests' ✔
// lines get eaten by the capture buffer and silently drop from the count.
function silenceStderr(): SilencedStreams {
  const orig = process.stderr.write.bind(process.stderr);
  (process.stderr.write as any) = (_chunk: any) => true;
  return { restore: () => { process.stderr.write = orig as any; } };
}

// All three adapters' default targets resolve under the env-var widened root.
// claude-code → <root>/.claude/skills/azure-architecture-diagram/
// codex       → <root>/.codex/skills/azure-architecture-diagram/
// cursor      → <root>/.cursor/rules/azure-arch-skill.mdc  (cursor uses cwd-relative)
// For the tests we set HOME = tmpdir AND cwd = tmpdir so all three resolve under it.

interface IsolatedEnv {
  tmpdir: string;
  restore: () => void;
}

function isolateEnv(): IsolatedEnv {
  const tmpdir = mkTmpdir();
  const prevTargetRoot = process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
  const prevHome = process.env.HOME;
  const prevCwd = process.cwd();
  process.env.AZURE_ARCH_SKILL_TARGET_ROOT = tmpdir;
  process.env.HOME = tmpdir;
  process.chdir(tmpdir);
  return {
    tmpdir,
    restore: () => {
      process.chdir(prevCwd);
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevTargetRoot === undefined) delete process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
      else process.env.AZURE_ARCH_SKILL_TARGET_ROOT = prevTargetRoot;
      rmTmpdir(tmpdir);
    },
  };
}

function claudeInstallPath(home: string): string {
  return path.join(home, ".claude", "skills", "azure-architecture-diagram");
}
function codexInstallPath(home: string): string {
  return path.join(home, ".codex", "skills", "azure-architecture-diagram");
}
function cursorRulePath(cwd: string): string {
  return path.join(cwd, ".cursor", "rules", "azure-arch-skill.mdc");
}

// ---- Happy path: install --agent=all writes all three install destinations ----

test("runOverAll install --agent=all happy: all three adapters install successfully", async () => {
  const env = isolateEnv();
  const mock = happyFetchMock();
  const silent = silenceStderr();
  try {
    const exit = await runOverAll("install", {});
    assert.equal(exit, 0);
    assert.ok(fs.existsSync(path.join(claudeInstallPath(env.tmpdir), "SKILL.md")), "claude-code SKILL.md present");
    assert.ok(fs.existsSync(path.join(codexInstallPath(env.tmpdir), "SKILL.md")), "codex SKILL.md present");
    assert.ok(fs.existsSync(cursorRulePath(env.tmpdir)), "cursor .mdc present");
  } finally {
    silent.restore();
    mock.restore();
    env.restore();
  }
});

// ---- Failure + rollback: 3rd adapter's canary HEAD fails; earlier installs roll back ----

test("runOverAll install --agent=all rollback: 3rd-adapter fail unrolls the earlier installs", async () => {
  const env = isolateEnv();
  // HEAD 1 succeeds (claude-code canary) → claude installs.
  // HEAD 2 succeeds (codex canary)       → codex installs.
  // HEAD 3 fails    (cursor canary)      → cursor install throws; dispatcher rolls back.
  const mock = failOnNthHeadFetchMock(3);
  const silent = silenceStderr();
  try {
    const exit = await runOverAll("install", {});
    assert.equal(exit, 1, "exit code is 1 when any adapter fails");
    assert.equal(fs.existsSync(claudeInstallPath(env.tmpdir)), false, "claude-code rolled back (folder removed)");
    assert.equal(fs.existsSync(codexInstallPath(env.tmpdir)), false, "codex rolled back (folder removed)");
    assert.equal(fs.existsSync(cursorRulePath(env.tmpdir)), false, "cursor never wrote (failed at canary)");
    assert.equal(mock.headCount(), 3, "exactly 3 HEAD requests = halted before the rollback's HEADs would have fired");
  } finally {
    silent.restore();
    mock.restore();
    env.restore();
  }
});

// ---- uninstall best-effort: empty state → exit 0 (all adapters report 'nothing to uninstall') ----

test("runOverAll uninstall --agent=all best-effort: empty state is exit 0 per-adapter", async () => {
  const env = isolateEnv();
  const silent = silenceStderr();
  try {
    const exit = await runOverAll("uninstall", {});
    assert.equal(exit, 0, "no installed state → each adapter exits 0 → aggregate exit 0");
  } finally {
    silent.restore();
    env.restore();
  }
});

// ---- list --agent=all: post-install reports each adapter's installed entry ----

test("runOverAll list --agent=all: post-install lists all three adapters", async () => {
  const env = isolateEnv();
  const mock = happyFetchMock();
  const silent = silenceStderr();
  // Capture stdout for the list call (separate from the test's own ✔/✘ output).
  const origStdout = process.stdout.write.bind(process.stdout);
  let captured = "";
  try {
    // Install first (using runOverAll itself).
    await runOverAll("install", {});

    // Now hijack stdout JUST around the list call.
    (process.stdout.write as any) = (chunk: any) => {
      captured += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };
    const exit = await runOverAll("list", {});
    // Restore IMMEDIATELY after list returns so node:test's reporter is unaffected.
    process.stdout.write = origStdout as any;

    assert.equal(exit, 0);
    // Each adapter prints `azure-architecture-diagram\t0.6.0` on its own line.
    const matches = captured.match(/azure-architecture-diagram/g) ?? [];
    assert.ok(matches.length >= 3, `expected 3+ adapter list lines, captured: ${JSON.stringify(captured)}`);
  } finally {
    process.stdout.write = origStdout as any;
    silent.restore();
    mock.restore();
    env.restore();
  }
});
