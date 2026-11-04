import semver from 'semver';
import { loadData } from '../core/data.js';
import { finding, fix, msg } from '../core/findings.js';
import type { Constraint, Finding, Project } from '../core/types.js';
import { nodeLineStatus, nodeVulnerabilities, type NodeVuln } from './releases.js';
import type { NodeRequirement } from './requirement.js';
import { pickNode, type InstalledNode } from './toolchain.js';

export interface NodePlan {
  requirements: NodeRequirement[];
  /** Ranges imposed by detected stacks (SPFx matrix, framework engines). */
  stackRanges: { range: string; source: string }[];
  /** Ranges every candidate must satisfy. */
  effective: string[];
  selected?: InstalledNode;
  /** Newest maintained release satisfying `effective`, from the release schedule. */
  recommended?: string;
  vulns: NodeVuln[];
}

interface NodeData {
  lines: Record<string, { latest: string | null; end: string }>;
}

export function planNode(
  project: Project,
  requirements: NodeRequirement[],
  constraints: Constraint[],
  installed: InstalledNode[],
  today = new Date(),
): { plan: NodePlan; findings: Finding[] } {
  const findings: Finding[] = [];
  const stackRanges = constraints
    .filter((c): c is Extract<Constraint, { kind: 'node' }> => c.kind === 'node')
    .map(({ range, source }) => ({ range, source }));
  const engines = requirements.find((req) => req.source === 'engines');
  const pins = requirements.filter((req) => req.pinned);
  const groupRanges = pins
    .filter(
      (requirement) => requirement.source === 'policy.groups' || requirement.source === 'target',
    )
    .map((requirement) => ({ range: requirement.range, source: requirement.source }));

  const stackRecommended = recommendNode(
    [...stackRanges, ...groupRanges].map((item) => item.range),
    today,
  );
  const conflictingPins = new Set<NodeRequirement>();
  for (const pin of pins) {
    const policyRanges = groupRanges.filter((range) => range.source !== pin.source);
    const conflicts = [...stackRanges, ...policyRanges].filter(
      (stack) => !safeIntersects(pin.range, stack.range),
    );
    const first = conflicts[0];
    if (!first) continue;
    conflictingPins.add(pin);
    const fixes =
      stackRecommended && (pin.source === '.nvmrc' || pin.source === '.node-version')
        ? [
            fix(
              'node/update-pin',
              msg('fix.updatePin', { file: pin.source, version: stackRecommended }),
              'safe',
              [{ kind: 'file-write', file: pin.file, content: `${stackRecommended}\n` }],
            ),
          ]
        : [];
    findings.push(
      finding(
        'node/pin-conflict',
        'error',
        project,
        msg('node.pinConflict', {
          pin: pin.range,
          file: pin.source,
          range: first.range,
          source: first.source,
        }),
        {
          evidence: [
            pin.file,
            ...conflicts.slice(1).map((stack) => `${stack.range} (${stack.source})`),
          ],
          fixes,
          tags: ['node'],
        },
      ),
    );
  }

  const primary = stackRanges[0] ?? groupRanges[0];
  if (primary) {
    const setEngines = fix(
      'node/set-engines',
      msg('fix.setEngines', { range: primary.range }),
      'safe',
      [
        {
          kind: 'json-set',
          file: project.manifestPath,
          path: ['engines', 'node'],
          value: primary.range,
        },
      ],
    );
    if (!engines) {
      findings.push(
        finding(
          'node/engines-missing',
          'info',
          project,
          msg('node.enginesMissing', { range: primary.range }),
          { fixes: [setEngines], tags: ['node'] },
        ),
      );
    } else if (!safeIntersects(engines.range, primary.range)) {
      findings.push(
        finding(
          'node/engines-conflict',
          'error',
          project,
          msg('node.enginesConflict', {
            engines: engines.range,
            range: primary.range,
            source: primary.source,
          }),
          {
            fixes: [setEngines],
            tags: ['node'],
          },
        ),
      );
    } else if (!safeSubset(engines.range, primary.range)) {
      findings.push(
        finding(
          'node/engines-too-wide',
          'warning',
          project,
          msg('node.enginesTooWide', {
            engines: engines.range,
            range: primary.range,
            source: primary.source,
          }),
          {
            fixes: [setEngines],
            tags: ['node'],
          },
        ),
      );
    }
  }

  // A pin that contradicts the stack is reported above and must not block the recommendation.
  const effective = [
    ...stackRanges.map((item) => item.range),
    ...pins
      .filter(
        (pin) =>
          pin.source === 'policy.groups' || pin.source === 'target' || !conflictingPins.has(pin),
      )
      .map((pin) => pin.range),
  ];
  if (
    engines &&
    [...stackRanges, ...groupRanges].every((s) => safeIntersects(engines.range, s.range))
  ) {
    effective.push(engines.range);
  }
  const consistent = effective.every((range, i) =>
    effective.every((other, j) => i === j || safeIntersects(range, other)),
  );
  const plan: NodePlan = { requirements, stackRanges, effective, vulns: [] };
  if (!consistent) return { plan, findings };

  // Exact pins choose the installed binary; the recommendation follows the stack and engines,
  // so a pin on a vulnerable patch release still gets a patched suggestion.
  const pinRanges = new Set(pins.map((pin) => pin.range));
  const isExactPin = (range: string): boolean =>
    pinRanges.has(range) && semver.valid(range) !== null;
  const recommended = recommendNode(
    effective.filter((range) => !isExactPin(range)),
    today,
  );
  if (recommended) plan.recommended = recommended;
  const selected = pickNode(installed, effective);
  if (selected) plan.selected = selected;

  if (effective.length > 0 && !selected) {
    // An exact engines pin (18.18.2) nobody has installed, while an installed Node fits the stack:
    // offer the stack range instead of the pin (review: the pin may have been deliberate).
    const exactEngines = engines && semver.valid(engines.range) ? engines.range : undefined;
    const fits = exactEngines
      ? pickNode(
          installed,
          effective.filter((range) => range !== exactEngines),
        )
      : undefined;
    const widen =
      exactEngines && fits && primary
        ? [
            fix('node/set-engines', msg('fix.setEngines', { range: primary.range }), 'review', [
              {
                kind: 'json-set',
                file: project.manifestPath,
                path: ['engines', 'node'],
                value: primary.range,
              },
            ]),
          ]
        : [];
    findings.push(
      finding(
        'node/not-installed',
        'warning',
        project,
        msg('node.notInstalled', {
          ranges: minimalRanges(effective).join(' & '),
          recommended: recommended ?? '-',
        }),
        {
          tags: ['node'],
          fixes: widen,
          ...(fits
            ? {
                evidence: [
                  `${fits.version} fits ${primary?.range ?? ''} (${primary?.source ?? ''})`,
                ],
              }
            : {}),
        },
      ),
    );
  }
  const checked = selected?.version;
  if (checked) {
    const status = nodeLineStatus(checked, today);
    if (status.phase === 'eol') {
      findings.push(
        finding(
          'node/eol',
          'warning',
          project,
          msg('node.eol', {
            version: checked,
            end: status.end ?? '?',
            recommended: recommended ?? '-',
          }),
          {
            evidence: [
              `no security fixes since ${status.end ?? '?'}; vulnerabilities disclosed later are not assessed for this line`,
            ],
            tags: ['node', 'security'],
          },
        ),
      );
    }
    plan.vulns = nodeVulnerabilities(checked);
    if (plan.vulns.length > 0 && recommended && semver.gt(recommended, checked)) {
      findings.push(
        finding(
          'node/patched-available',
          'info',
          project,
          msg('node.patchedAvailable', { version: checked, recommended }),
          {
            tags: ['node', 'security'],
          },
        ),
      );
    }
  }
  return { plan, findings };
}

/**
 * Latest release of the newest line that satisfies every range, preferring supported lines.
 * Stacks pinned to an EOL line (e.g. SPFx 1.18 on Node 18) still get the best version they can use;
 * the EOL status is reported separately by `node/eol`.
 */
export function recommendNode(ranges: string[], today = new Date()): string | undefined {
  const lines = loadData<NodeData>('node.json').lines;
  const day = today.toISOString().slice(0, 10);
  const fits = Object.values(lines)
    .filter((line) => line.latest !== null)
    .map((line) => ({ version: line.latest as string, supported: line.end >= day }))
    .filter((line) => ranges.every((range) => safeSatisfies(line.version, range)))
    .sort(
      (a, b) => Number(b.supported) - Number(a.supported) || semver.rcompare(a.version, b.version),
    );
  return fits[0]?.version;
}

/** Drops ranges implied by a narrower one (e.g. `>=8.3` next to `>=18.17.1 <19`). */
export function minimalRanges(ranges: string[]): string[] {
  const unique = [...new Set(ranges)];
  return unique.filter(
    (range, i) =>
      !unique.some((other, j) => j !== i && other !== range && safeSubset(other, range)),
  );
}

function safeIntersects(a: string, b: string): boolean {
  try {
    return semver.intersects(a, b);
  } catch {
    return true;
  }
}

function safeSubset(a: string, b: string): boolean {
  try {
    return semver.subset(a, b);
  } catch {
    return true;
  }
}

function safeSatisfies(version: string, range: string): boolean {
  try {
    return semver.satisfies(version, range);
  } catch {
    return false;
  }
}
