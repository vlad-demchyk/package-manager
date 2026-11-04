/** Dependency sections of package.json that packman reads and edits. */
export const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

export type DependencySection = (typeof DEPENDENCY_SECTIONS)[number];

export interface PackageManifest {
  name?: string;
  version?: string;
  private?: boolean;
  engines?: Record<string, string>;
  devEngines?: unknown;
  volta?: { node?: string };
  packageManager?: string;
  workspaces?: string[] | { packages?: string[] };
  overrides?: Record<string, unknown>;
  resolutions?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  [key: string]: unknown;
}

export interface DeclaredDependency {
  name: string;
  spec: string;
  section: DependencySection;
}

export type LockfileKind = 'npm' | 'yarn' | 'pnpm';

export interface LockedPackage {
  name: string;
  version: string;
  /** Path inside node_modules, e.g. `node_modules/a/node_modules/b`. */
  location: string;
  dev: boolean;
  deprecated?: string;
  engines?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  /** Names this package requires (dependencies, optional and peer). */
  requires?: string[];
}

export interface LockfileSummary {
  kind: LockfileKind;
  path: string;
  /** Format version when known: npm or pnpm lockfileVersion, 1 for classic yarn. */
  version?: number;
  /** Hash of npm package entries, including resolution and integrity metadata (excluding the root). */
  contentHash?: string;
  /** Root-level specs recorded in the lockfile, used for drift detection. */
  rootSpecs: Record<string, string>;
  packages: LockedPackage[];
}

/** One package.json-rooted unit inside the workspace. */
export interface Project {
  /** Stable id: workspace-relative path with forward slashes, `.` for the root. */
  id: string;
  dir: string;
  relDir: string;
  name: string;
  manifestPath: string;
  manifest: PackageManifest;
  dependencies: DeclaredDependency[];
  lockfile?: LockfileSummary;
  /** Locked versions the project's last passing build used (`.packman/verified`). */
  verified?: {
    at: string;
    node: string;
    script: string;
    versions: Record<string, string>;
  };
  /** `node_modules` state: absent, a real folder, or a link into the shared store. */
  nodeModules: 'absent' | 'folder' | 'link';
  /** Installed versions read from node_modules/<name>/package.json for declared deps. */
  installed: Record<string, string>;
  isRoot: boolean;
}

export type Confidence = 'high' | 'medium' | 'low';

/** What a provider detected about a project. */
export interface StackInfo {
  provider: string;
  /** Normalized version of the stack itself (e.g. SPFx 1.21.1), when known. */
  version?: string;
  confidence: Confidence;
  /** Human readable evidence, e.g. `package.json: @microsoft/sp-core-library 1.21.1`. */
  evidence: string[];
  details: Record<string, string | boolean | undefined>;
}

export type Severity = 'critical' | 'error' | 'warning' | 'info';

/** Translatable message: key into the i18n catalogue plus parameters. */
export interface Message {
  key: string;
  params?: Record<string, string | number>;
}

export type Edit =
  | { kind: 'json-set'; file: string; path: (string | number)[]; value: unknown }
  | { kind: 'json-remove'; file: string; path: (string | number)[] }
  | { kind: 'file-delete'; file: string }
  | { kind: 'file-write'; file: string; content: string };

export interface Command {
  cwd: string;
  argv: string[];
  /** Node version range the command must run under, resolved to an installed binary. */
  node?: string;
}

export type Risk = 'safe' | 'review' | 'breaking';

export interface Fix {
  id: string;
  title: Message;
  risk: Risk;
  edits: Edit[];
  commands: Command[];
}

export type ExposureContext = 'browser' | 'server' | 'build' | 'unknown';

export interface Finding {
  ruleId: string;
  severity: Severity;
  projectId?: string;
  message: Message;
  evidence: string[];
  fixes: Fix[];
  /** Free-form tags for filtering: `security`, `network`, `node`, `spfx`, ... */
  tags: string[];
}

/** A requirement a provider places on a project. */
export type Constraint =
  | { kind: 'node'; range: string; source: string }
  | { kind: 'package'; name: string; range: string; source: string; exact?: boolean };

export interface Workspace {
  root: string;
  projects: Project[];
}
