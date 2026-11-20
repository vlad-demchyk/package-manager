import pc from 'picocolors';
import { t } from '../i18n/index.js';
import type { MatrixRow, SourceSummary, SummarySource } from '../ops/matrix.js';

const SOURCES: SummarySource[] = ['declared', 'locked', 'installed'];
const UNKNOWN_REASON: Partial<Record<SummarySource, string>> = {
  locked: 'versions.noLockfile',
  installed: 'versions.noModules',
};

/** One line per source: latest and most common, plus where the source cannot be read. */
export function summaryLines(row: MatrixRow): string[] {
  return SOURCES.map((source) => {
    const item: SourceSummary = row.summary[source];
    const parts: string[] = [];
    if (item.mostCommon && item.latest)
      parts.push(
        t('versions.summary', {
          latest: item.latest,
          version: item.mostCommon.version,
          count: item.mostCommon.count,
          total: item.count,
        }),
      );
    const reason = UNKNOWN_REASON[source];
    if (item.unknown > 0 && reason)
      parts.push(
        t('versions.unknown', { count: item.unknown, total: item.total, reason: t(reason) }),
      );
    if (parts.length === 0) parts.push(t('versions.none'));
    return `${t(`versions.source.${source}`).padEnd(12)} ${parts.join('; ')}`;
  });
}

/** `packman versions` text output for one package. */
export function printVersionRow(row: MatrixRow): void {
  const mark = row.diverging || row.drift ? pc.yellow('≠') : pc.green('=');
  const drift = row.drift ? `  ${pc.yellow(t('versions.drift'))}` : '';
  console.log(
    `${mark} ${pc.bold(row.name)} ${pc.dim(`(${Object.keys(row.cells).length})`)}${drift}`,
  );
  if (!row.diverging && !row.drift) return;
  for (const version of row.versions) {
    const users = Object.entries(row.cells)
      .filter(([, cell]) => (cell.version ?? cell.spec) === version)
      .map(([id]) => id);
    console.log(`    ${version.padEnd(16)} ${pc.dim(users.join(', '))}`);
  }
  for (const line of summaryLines(row)) console.log(pc.dim(`    ${line}`));
}
