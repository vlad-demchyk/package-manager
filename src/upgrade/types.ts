import type { Edit, Fix, Message } from '../core/types.js';
import type { InstalledNode } from '../node/toolchain.js';

export interface MigrationIssue {
  code: string;
  level: 'blocker' | 'review';
  message: Message;
  files?: string[];
}
export interface UpgradeTarget {
  stack: string;
  version: string;
  baseline: string;
  origin: 'repository' | 'explicit';
  currentVersions: string[];
  toolchain?: 'gulp' | 'heft';
}
/** A documented API break the migration crosses and what the project's code uses of it. */
export interface CodeChange {
  package: string;
  from: string;
  to: string;
  title: string;
  guide: string;
  verified: boolean;
  /** `file:line` places that use the API of the version being left. */
  places: string[];
  steps: string[];
}
export interface ProjectMigration {
  id: string;
  stack: string;
  current: string;
  target: string;
  baseline: string;
  edits: Edit[];
  issues: MigrationIssue[];
  /** Code changes the version edits require (`data/api-breaks.json`). */
  codeChanges: CodeChange[];
  verifyScript: string;
}
export interface UpgradePlan {
  root: string;
  targets: UpgradeTarget[];
  projects: ProjectMigration[];
  order: string[];
  fixes: Fix[];
  issues: MigrationIssue[];
  nodeVersion?: string;
  node?: InstalledNode;
}
