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
export interface ProjectMigration {
  id: string;
  stack: string;
  current: string;
  target: string;
  baseline: string;
  edits: Edit[];
  issues: MigrationIssue[];
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
