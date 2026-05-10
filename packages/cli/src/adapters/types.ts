export interface InstallOptions {
  /** Override target directory (defaults to ~/.claude/skills/<skill-name>/). Validation tests use this. */
  target?: string;
  /** Force overwrite of an existing skill at the target. update() passes true; install() defaults false. */
  overwrite?: boolean;
}

export interface UninstallOptions {
  target?: string;
}

export interface UpdateOptions {
  target?: string;
}

export interface ListOptions {
  /** Override the skills root directory (defaults to ~/.claude/skills/). */
  target?: string;
}

/**
 * Every CLI adapter implements this interface.
 *
 * Methods MUST NOT throw — wrap I/O in try/catch and return a numeric exit code
 * per D-014h. The top-level `.catch` in src/index.ts only covers commander
 * `parseAsync` rejections, not adapter-internal errors.
 *
 * Adding a 5th method (e.g. `verify`, `doctor`) requires synchronized rev
 * across every adapter — accept this rigid contract for the small set of
 * adapters in scope through Phase 1.x. If capability discovery becomes
 * necessary, switch to optional methods (`verify?: ...`) at that point.
 */
export interface Adapter {
  install(opts: InstallOptions):     Promise<number>;
  uninstall(opts: UninstallOptions): Promise<number>;
  update(opts: UpdateOptions):       Promise<number>;
  list(opts: ListOptions):           Promise<number>;
}
