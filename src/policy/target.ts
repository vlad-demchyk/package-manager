import type { PackmanConfig } from '../core/config.js';
import { finding, msg } from '../core/findings.js';
import type { Finding } from '../core/types.js';
import type { ProjectReport } from '../analyze.js';
import { satisfies } from '../core/versions.js';
import { migrationStack } from '../upgrade/targets.js';

export function targetFindings(entry: ProjectReport, config: PackmanConfig): Finding[] {
  const findings: Finding[] = [];
  for (const [stack, target] of Object.entries(config.target)) {
    if (!target) continue;
    if (stack === 'node') {
      const incompatible = entry.node.requirements.filter(
        (req) => req.source !== 'target' && !satisfies(target, req.range),
      );
      if (entry.node.selected?.version !== target || incompatible.length > 0)
        findings.push(
          finding(
            'policy/target-node',
            'error',
            entry.project,
            msg('target.node', { version: entry.node.selected?.version ?? '?', target }),
            {
              evidence: incompatible.map((req) => `${req.source}: ${req.range}`),
              tags: ['target', 'node'],
            },
          ),
        );
    } else {
      if (migrationStack(entry) !== stack) continue;
      const current = entry.stacks.find((item) => item.provider === stack);
      if (current && current.version !== target)
        findings.push(
          finding(
            'policy/target-stack',
            'error',
            entry.project,
            msg('target.stack', { stack, version: current.version ?? '?', target }),
            {
              evidence: [`packman upgrade --stack ${stack} --to ${target}`],
              tags: ['target', 'upgrade'],
            },
          ),
        );
    }
  }
  return findings;
}
