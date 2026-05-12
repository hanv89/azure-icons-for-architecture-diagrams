import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Adapter } from "./types";
import { claudeCodeAdapter, parseFrontmatter } from "./claude-code";
import { codexAdapter } from "./codex";

// ---- Adapter round-trip (install → list → uninstall) ----
// Same fixture exercised against every adapter via the loop below. Adding
// a new adapter is a one-line entry in `adapters` plus the adapter's own
// import — the test bodies stay identical.

const SYNTHETIC_SKILL_MD = [
  "---",
  "name: azure-architecture-diagram",
  "description: test fixture",
  "version: 0.4.0",
  'requires_icons: ">=0.2.2"',
  "---",
  "# Test skill body",
  "",
  "This is a synthetic SKILL.md used only by the round-trip test fixture.",
].join("\n");

const SYNTHETIC_EXAMPLE = "@startuml\ntitle Test\n@enduml\n";

const SYNTHETIC_MANIFEST = {
  $schema: "./manifest.schema.json",
  name: "azure-architecture-diagram",
  version: "0.4.0",
  requires_icons: ">=0.2.2",
  files: [
    { src: "dist/skill/SKILL.md", dest: "SKILL.md", role: "skill" },
    { src: "dist/skill/examples/01-context.puml", dest: "examples/01-context.puml", role: "example" },
  ],
};

const realFetch = globalThis.fetch;

function installFetchMock(): { restore: () => void } {
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = url.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "HEAD") {
      return new Response(null, { status: 200 });
    }
    if (u.endsWith("/dist/skill/manifest.json")) {
      return new Response(JSON.stringify(SYNTHETIC_MANIFEST), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.endsWith("/dist/skill/SKILL.md")) {
      return new Response(SYNTHETIC_SKILL_MD, { status: 200 });
    }
    if (u.endsWith("/dist/skill/examples/01-context.puml")) {
      return new Response(SYNTHETIC_EXAMPLE, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = realFetch; } };
}

function mkTmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "azure-arch-skill-test-"));
}

function rmTmpdir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

const adapters: Array<{ name: string; adapter: Adapter }> = [
  { name: "claude-code", adapter: claudeCodeAdapter },
  { name: "codex",       adapter: codexAdapter },
];

for (const { name, adapter } of adapters) {
  test(`${name} round-trip: install writes SKILL.md + example into target`, async () => {
    const tmpdir = mkTmpdir();
    const target = path.join(tmpdir, "skills", "azure-architecture-diagram");
    const prevEnv = process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
    process.env.AZURE_ARCH_SKILL_TARGET_ROOT = tmpdir;
    const { restore } = installFetchMock();
    try {
      const exit = await adapter.install({ target });
      assert.equal(exit, 0);
      assert.ok(fs.existsSync(path.join(target, "SKILL.md")), "SKILL.md present at target");
      assert.ok(fs.existsSync(path.join(target, "examples", "01-context.puml")), "example present at target");
      const writtenSkill = fs.readFileSync(path.join(target, "SKILL.md"), "utf8");
      assert.ok(writtenSkill.startsWith("---"), "SKILL.md preserves frontmatter");
      assert.match(writtenSkill, /name: azure-architecture-diagram/);
    } finally {
      restore();
      if (prevEnv === undefined) delete process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
      else process.env.AZURE_ARCH_SKILL_TARGET_ROOT = prevEnv;
      rmTmpdir(tmpdir);
    }
  });

  test(`${name} round-trip: list after install discovers the installed skill`, async () => {
    // Verifies the file-system state list() reads from. Asserts via fs +
    // parseFrontmatter rather than capturing list()'s stdout: hijacking
    // process.stdout.write inside node:test confuses the runner's buffered
    // reporter output (other tests' ✔ lines get eaten by the capture buffer
    // and silently drop from the count).
    const tmpdir = mkTmpdir();
    const skillsRoot = path.join(tmpdir, "skills");
    const target = path.join(skillsRoot, "azure-architecture-diagram");
    const prevEnv = process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
    process.env.AZURE_ARCH_SKILL_TARGET_ROOT = tmpdir;
    const { restore } = installFetchMock();
    try {
      await adapter.install({ target });

      const skillDirs = fs.readdirSync(skillsRoot, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
      assert.deepEqual(skillDirs, ["azure-architecture-diagram"], "skills/ contains exactly one entry");

      const skillMd = fs.readFileSync(path.join(target, "SKILL.md"), "utf8");
      const fm = parseFrontmatter(skillMd);
      assert.equal(fm.name, "azure-architecture-diagram");
      assert.equal(fm.version, "0.4.0");

      const exit = await adapter.list({ target: skillsRoot });
      assert.equal(exit, 0);
    } finally {
      restore();
      if (prevEnv === undefined) delete process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
      else process.env.AZURE_ARCH_SKILL_TARGET_ROOT = prevEnv;
      rmTmpdir(tmpdir);
    }
  });

  test(`${name} round-trip: uninstall removes the installed skill folder`, async () => {
    const tmpdir = mkTmpdir();
    const target = path.join(tmpdir, "skills", "azure-architecture-diagram");
    const prevEnv = process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
    process.env.AZURE_ARCH_SKILL_TARGET_ROOT = tmpdir;
    const { restore } = installFetchMock();
    try {
      await adapter.install({ target });
      assert.ok(fs.existsSync(target), "precondition: target exists after install");
      const exit = await adapter.uninstall({ target });
      assert.equal(exit, 0);
      assert.equal(fs.existsSync(target), false, "target removed after uninstall");
    } finally {
      restore();
      if (prevEnv === undefined) delete process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
      else process.env.AZURE_ARCH_SKILL_TARGET_ROOT = prevEnv;
      rmTmpdir(tmpdir);
    }
  });
}
