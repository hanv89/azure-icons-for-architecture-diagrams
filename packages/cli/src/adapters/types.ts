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
 * Methods MUST resolve to a numeric exit code; wrap I/O in try/catch and
 * return that code, OR delegate to a method that already does so. The
 * top-level `.catch` in src/index.ts only covers commander parser
 * rejections, not adapter-internal errors.
 *
 * Adding a 5th method requires synchronized rev across every adapter
 * — accept this rigid contract for the small adapter set in scope. If
 * capability discovery becomes necessary later, switch to optional
 * methods (`verify?: ...`) at that point.
 */
export interface Adapter {
  install(opts: InstallOptions):     Promise<number>;
  uninstall(opts: UninstallOptions): Promise<number>;
  update(opts: UpdateOptions):       Promise<number>;
  list(opts: ListOptions):           Promise<number>;
}
