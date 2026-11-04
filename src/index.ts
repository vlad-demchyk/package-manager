export { analyze, PROVIDERS } from './analyze.js';
export type { AnalyzeOptions, ProjectReport, Report } from './analyze.js';
export { configSchema, loadConfig, ConfigError } from './core/config.js';
export type { PackmanConfig, LoadedConfig, GroupConfig, ProfileConfig } from './core/config.js';
export { discoverWorkspace, loadProject } from './core/discovery.js';
export type { DiscoveryOptions } from './core/discovery.js';
export { readLockfile } from './core/lockfile.js';
export { alignPackage, alignToProject, diffProjects } from './ops/align.js';
export type { DiffRow } from './ops/align.js';
export { versionMatrix } from './ops/matrix.js';
export type { MatrixRow } from './ops/matrix.js';
export { outdated } from './ops/outdated.js';
export type { OutdatedRow } from './ops/outdated.js';
export { dataStatus, updateData } from './ops/data.js';
export type { DataFileStatus, DataUpdateResult } from './ops/data.js';
export type * from './core/types.js';
export type { StackProvider, ProjectContext } from './providers/types.js';
export { collectEdits, previewEdits, applyPreviews } from './fixes/apply.js';
export type { FilePreview, ApplyResult } from './fixes/apply.js';
export { planStore, linkGroup, unlinkProjects, readLinks } from './store/store.js';
export { planUpgrade } from './upgrade/plan.js';
export type { UpgradeOptions } from './upgrade/plan.js';
export type {
  UpgradePlan,
  UpgradeTarget,
  ProjectMigration,
  MigrationIssue,
} from './upgrade/types.js';
export type {
  StorePlan,
  StoreGroup,
  LinkOptions,
  LinkRecord,
  LinkResult,
  UnlinkResult,
} from './store/store.js';
