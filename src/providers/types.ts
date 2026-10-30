import type { PackmanConfig } from '../core/config.js';
import type { Constraint, Finding, Project, StackInfo, Workspace } from '../core/types.js';
import type { NodeRequirement } from '../node/requirement.js';
import type { SourceScan } from '../scan/sources.js';

export interface ProjectContext {
  workspace: Workspace;
  project: Project;
  config: PackmanConfig;
  nodeRequirements: NodeRequirement[];
  /** Stacks detected by providers that ran before the current one. */
  stacks: ReadonlyMap<string, StackInfo>;
  /** Lazily scanned and cached source imports and network signals. */
  sources(): Promise<SourceScan>;
}

export interface StackProvider {
  id: string;
  detect(ctx: ProjectContext): StackInfo | undefined | Promise<StackInfo | undefined>;
  /** Requirements the stack places on Node and on package versions. */
  constraints?(ctx: ProjectContext, stack: StackInfo): Constraint[];
  check?(ctx: ProjectContext, stack: StackInfo): Finding[] | Promise<Finding[]>;
  /** Packages the stack uses without importing them from source (build tools, CSS-only...). */
  implicitlyUsed?(ctx: ProjectContext, stack: StackInfo): string[] | Promise<string[]>;
  /** Import names resolved by the stack's build, not by node_modules (localized strings, externals). */
  virtualModules?(ctx: ProjectContext, stack: StackInfo): Promise<string[]>;
}
