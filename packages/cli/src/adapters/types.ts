export interface InstallOptions {
  /** Override target directory (defaults to ~/.claude/skills/<skill-name>/). Validation tests use this. */
  target?: string;
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

export interface Adapter {
  install(opts: InstallOptions):     Promise<number>;
  uninstall(opts: UninstallOptions): Promise<number>;
  update(opts: UpdateOptions):       Promise<number>;
  list(opts: ListOptions):           Promise<number>;
}
