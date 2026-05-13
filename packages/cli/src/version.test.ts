import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { baseUrl, satisfiesRequiresIcons } from "./adapters/_shared";
import { claudeCodeAdapter } from "./adapters/claude-code";

// ---- satisfiesRequiresIcons unit tests ----

test("satisfiesRequiresIcons: exact match", () => {
  assert.equal(satisfiesRequiresIcons("0.2.2", "0.2.2"), true);
});

test("satisfiesRequiresIcons: exact mismatch", () => {
  assert.equal(satisfiesRequiresIcons("0.2.2", "0.3.0"), false);
});

test("satisfiesRequiresIcons: >= passes when tag >= constraint", () => {
  assert.equal(satisfiesRequiresIcons(">=0.2.0", "0.5.0"), true);
  assert.equal(satisfiesRequiresIcons(">=0.2.0", "0.2.0"), true);
});

test("satisfiesRequiresIcons: >= fails when tag < constraint", () => {
  assert.equal(satisfiesRequiresIcons(">=0.5.0", "0.4.9"), false);
});

test("satisfiesRequiresIcons: caret same major passes", () => {
  assert.equal(satisfiesRequiresIcons("^0.2.0", "0.5.0"), true);
});

test("satisfiesRequiresIcons: caret different major fails", () => {
  assert.equal(satisfiesRequiresIcons("^0.2.0", "1.0.0"), false);
});

test("satisfiesRequiresIcons: tilde same major.minor passes", () => {
  assert.equal(satisfiesRequiresIcons("~0.2.0", "0.2.5"), true);
});

test("satisfiesRequiresIcons: tilde different minor fails", () => {
  assert.equal(satisfiesRequiresIcons("~0.2.0", "0.3.0"), false);
});

test("satisfiesRequiresIcons: quoted constraint normalised", () => {
  assert.equal(satisfiesRequiresIcons('">=0.2.2"', "0.5.0"), true);
});

test("satisfiesRequiresIcons: unsupported constraint form throws", () => {
  assert.throws(() => satisfiesRequiresIcons("<1.0.0", "0.5.0"), /not supported/);
  assert.throws(() => satisfiesRequiresIcons(">0.2.0", "0.5.0"), /not supported/);
});

test("satisfiesRequiresIcons: malformed icons semver throws", () => {
  assert.throws(() => satisfiesRequiresIcons(">=0.2.0", "not.a.semver"), /malformed/);
});

// ---- baseUrl(version?) unit tests ----

test("baseUrl(): default returns main ref", () => {
  const prev = process.env.AZURE_ARCH_SKILL_BASE_URL;
  delete process.env.AZURE_ARCH_SKILL_BASE_URL;
  try {
    const url = baseUrl();
    assert.ok(url.endsWith("/main"), `expected default URL to end with /main, got: ${url}`);
    assert.ok(url.startsWith("https://raw.githubusercontent.com/hanv89/"));
  } finally {
    if (prev === undefined) delete process.env.AZURE_ARCH_SKILL_BASE_URL;
    else process.env.AZURE_ARCH_SKILL_BASE_URL = prev;
  }
});

test("baseUrl('0.5.0'): returns tag-pinned ref", () => {
  const prev = process.env.AZURE_ARCH_SKILL_BASE_URL;
  delete process.env.AZURE_ARCH_SKILL_BASE_URL;
  try {
    const url = baseUrl("0.5.0");
    assert.ok(url.endsWith("/skill-v0.5.0"), `expected URL to end with /skill-v0.5.0, got: ${url}`);
  } finally {
    if (prev === undefined) delete process.env.AZURE_ARCH_SKILL_BASE_URL;
    else process.env.AZURE_ARCH_SKILL_BASE_URL = prev;
  }
});

test("baseUrl('invalid'): throws X.Y.Z error", () => {
  const prev = process.env.AZURE_ARCH_SKILL_BASE_URL;
  delete process.env.AZURE_ARCH_SKILL_BASE_URL;
  try {
    assert.throws(() => baseUrl("invalid"), /must match X\.Y\.Z/);
    assert.throws(() => baseUrl("v1.2.3"),  /must match X\.Y\.Z/);
    assert.throws(() => baseUrl("1.2"),     /must match X\.Y\.Z/);
  } finally {
    if (prev === undefined) delete process.env.AZURE_ARCH_SKILL_BASE_URL;
    else process.env.AZURE_ARCH_SKILL_BASE_URL = prev;
  }
});

// ---- --version integration: claude-code install asserts the fetched URL is tag-pinned ----

const SYNTHETIC_SKILL_MD = [
  "---",
  "name: azure-architecture-diagram",
  "description: test fixture",
  "version: 0.5.0",
  'requires_icons: ">=0.2.2"',
  "---",
  "# Test skill body",
].join("\n");

const SYNTHETIC_MANIFEST = {
  $schema: "./manifest.schema.json",
  name: "azure-architecture-diagram",
  version: "0.5.0",
  requires_icons: ">=0.2.2",
  files: [
    { src: "dist/skill/SKILL.md", dest: "SKILL.md", role: "skill" },
    { src: "dist/skill/examples/01-context.puml", dest: "examples/01-context.puml", role: "example" },
  ],
};

const realFetch = globalThis.fetch;

function mkTmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "azure-arch-skill-test-"));
}

function rmTmpdir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

test("--version=0.5.0 integration: install fetches from skill-v0.5.0 ref", async () => {
  const tmpdir = mkTmpdir();
  const target = path.join(tmpdir, "skills", "azure-architecture-diagram");
  const prevEnv = process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
  const prevBase = process.env.AZURE_ARCH_SKILL_BASE_URL;
  process.env.AZURE_ARCH_SKILL_TARGET_ROOT = tmpdir;
  delete process.env.AZURE_ARCH_SKILL_BASE_URL;

  const requestedUrls: string[] = [];
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = url.toString();
    requestedUrls.push(u);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "HEAD") return new Response(null, { status: 200 });
    if (u.endsWith("/dist/skill/manifest.json")) {
      return new Response(JSON.stringify(SYNTHETIC_MANIFEST), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.endsWith("/dist/skill/SKILL.md")) return new Response(SYNTHETIC_SKILL_MD, { status: 200 });
    if (u.endsWith("/dist/skill/examples/01-context.puml")) {
      return new Response("@startuml\ntitle Test\n@enduml\n", { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const exit = await claudeCodeAdapter.install({ target, version: "0.5.0" });
    assert.equal(exit, 0);

    const tagPinned = requestedUrls.filter(u => u.includes("/skill-v0.5.0/"));
    assert.ok(tagPinned.length >= 1, `expected at least one URL with /skill-v0.5.0/, got: ${JSON.stringify(requestedUrls)}`);

    const mainRefHit = requestedUrls.filter(u => u.includes("/main/dist/"));
    assert.equal(mainRefHit.length, 0, `expected no /main/ URLs when --version is set, got: ${JSON.stringify(mainRefHit)}`);
  } finally {
    globalThis.fetch = realFetch;
    if (prevEnv === undefined) delete process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
    else process.env.AZURE_ARCH_SKILL_TARGET_ROOT = prevEnv;
    if (prevBase === undefined) delete process.env.AZURE_ARCH_SKILL_BASE_URL;
    else process.env.AZURE_ARCH_SKILL_BASE_URL = prevBase;
    rmTmpdir(tmpdir);
  }
});

test("--version=99.99.99 integration: fetch 404 surfaces as fatal error", async () => {
  const tmpdir = mkTmpdir();
  const target = path.join(tmpdir, "skills", "azure-architecture-diagram");
  const prevEnv = process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
  const prevBase = process.env.AZURE_ARCH_SKILL_BASE_URL;
  process.env.AZURE_ARCH_SKILL_TARGET_ROOT = tmpdir;
  delete process.env.AZURE_ARCH_SKILL_BASE_URL;

  globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;

  // Silence stderr to keep the test runner output clean.
  const origStderr = process.stderr.write.bind(process.stderr);
  (process.stderr.write as any) = (_chunk: any) => true;

  try {
    const exit = await claudeCodeAdapter.install({ target, version: "99.99.99" });
    assert.equal(exit, 1, "non-existent tag should produce exit 1");
  } finally {
    process.stderr.write = origStderr as any;
    globalThis.fetch = realFetch;
    if (prevEnv === undefined) delete process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
    else process.env.AZURE_ARCH_SKILL_TARGET_ROOT = prevEnv;
    if (prevBase === undefined) delete process.env.AZURE_ARCH_SKILL_BASE_URL;
    else process.env.AZURE_ARCH_SKILL_BASE_URL = prevBase;
    rmTmpdir(tmpdir);
  }
});
