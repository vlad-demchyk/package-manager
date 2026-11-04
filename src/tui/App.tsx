import path from 'node:path';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import semver from 'semver';
import type { ProjectReport, Report } from '../analyze.js';
import { fix, msg, setDependency, SEVERITY_ORDER } from '../core/findings.js';
import type { Finding, Fix, Project, Severity } from '../core/types.js';
import { collectEdits, lineDiff, previewEdits, type FilePreview } from '../fixes/apply.js';
import { t, tm } from '../i18n/index.js';
import { nodeLineStatus, nodeVulnerabilities } from '../node/releases.js';
import { alignPackage } from '../ops/align.js';
import { versionMatrix, type MatrixRow } from '../ops/matrix.js';
import type { OutdatedRow } from '../ops/outdated.js';
import { allFindings, summarize } from '../report/model.js';
import { planStore, type StorePlan } from '../store/store.js';
import { Counts, KeyHints, List, SEVERITY_COLOR, SEVERITY_ICON, tone } from './components.js';

/** Read-only views first; Fixes, where selected changes are reviewed and written, comes last. */
export type Tab = 'overview' | 'projects' | 'versions' | 'outdated' | 'node' | 'store' | 'fixes';
const TABS: Tab[] = ['overview', 'projects', 'versions', 'outdated', 'node', 'store', 'fixes'];
const SEVERITIES: Severity[] = ['info', 'warning', 'error', 'critical'];

export interface AppProps {
  load: (onProgress: (done: number, total: number, id: string) => void) => Promise<Report>;
  apply: (previews: FilePreview[]) => Promise<{ files: string[]; backupDir: string }>;
  /** Registry lookup behind the Outdated tab, run the first time the tab opens. */
  loadOutdated?: (projects: Project[]) => Promise<OutdatedRow[]>;
}

interface SelectedFix {
  key: string;
  projectId: string;
  fix: Fix;
}

const fixKey = (item: Finding, fix: Fix): string =>
  `${item.projectId ?? '*'}|${item.ruleId}|${fix.id}|${JSON.stringify(item.message.params ?? {})}`;

export function App({ load, apply, loadOutdated }: AppProps): ReactNode {
  const { exit } = useApp();
  const { rows } = useWindowSize();
  const [report, setReport] = useState<Report>();
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<Tab>('overview');
  const [cursor, setCursor] = useState<Record<Tab, number>>({
    overview: 0,
    projects: 0,
    versions: 0,
    node: 0,
    fixes: 0,
    outdated: 0,
    store: 0,
  });
  const [outdatedRows, setOutdatedRows] = useState<OutdatedRow[]>();
  const [outdatedError, setOutdatedError] = useState<string>();
  const [detail, setDetail] = useState<number>();
  const [detailCursor, setDetailCursor] = useState(0);
  const [minSeverity, setMinSeverity] = useState<Severity>('info');
  const [selected, setSelected] = useState<Map<string, SelectedFix>>(new Map());
  const [previews, setPreviews] = useState<FilePreview[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [applying, setApplying] = useState(false);
  const loadId = useRef(0);

  const reload = useCallback(() => {
    const request = ++loadId.current;
    setReport(undefined);
    setError(undefined);
    setSelected(new Map());
    setPreviews([]);
    setDetail(undefined);
    setDetailCursor(0);
    setConfirming(false);
    setOutdatedRows(undefined);
    setOutdatedError(undefined);
    load((done, total, id) => {
      setProgress(`[${done + 1}/${total}] ${id}`);
    })
      .then((next) => {
        if (request === loadId.current) setReport(next);
      })
      .catch((reason: unknown) => {
        if (request === loadId.current)
          setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, [load]);

  useEffect(reload, [reload]);

  const visible = useCallback(
    (item: Finding) => SEVERITY_ORDER[item.severity] <= SEVERITY_ORDER[minSeverity],
    [minSeverity],
  );

  useEffect(() => {
    if (tab !== 'fixes') return;
    let cancelled = false;
    setPreviews([]);
    void previewEdits(collectEdits([...selected.values()].map((entry) => entry.fix)))
      .then((next) => {
        if (!cancelled) setPreviews(next);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [tab, selected]);

  useEffect(() => {
    if (tab !== 'outdated' || !report || !loadOutdated || outdatedRows || outdatedError) return;
    const request = loadId.current;
    loadOutdated(report.projects.map((entry) => entry.project))
      .then((next) => {
        if (request === loadId.current) setOutdatedRows(next);
      })
      .catch((reason: unknown) => {
        if (request === loadId.current)
          setOutdatedError(reason instanceof Error ? reason.message : String(reason));
      });
  }, [tab, report, loadOutdated, outdatedRows, outdatedError]);

  const listHeight = Math.max(5, rows - 9);
  const projects = report?.projects ?? [];
  const workspaceFindings = (report?.workspaceFindings ?? []).filter(visible);
  const current: ProjectReport | undefined = detail === undefined ? undefined : projects[detail];
  const detailFindings = current?.findings.filter(visible) ?? [];
  const matrixRows = useMemo(
    () =>
      report
        ? versionMatrix(
            report.projects.map((entry) => entry.project),
            { divergingOnly: true },
          ).rows
        : [],
    [report],
  );
  const storePlan = useMemo(
    () => (report ? planStore(report, { union: true }) : undefined),
    [report],
  );

  /** Selects or drops one fix that does not belong to a finding (align, outdated). */
  const toggleFix = (key: string, item: Fix | undefined, projectId = '*'): void => {
    if (!item || item.edits.length === 0) {
      setNotice(t('tui.nothingToChange'));
      return;
    }
    setSelected((previous) => {
      const next = new Map(previous);
      if (next.has(key)) next.delete(key);
      else next.set(key, { key, projectId, fix: item });
      return next;
    });
  };

  /** `packman profile apply` in the TUI: every fix of a profile finding at once. */
  const toggleProfileFixes = (): void => {
    if (!report) return;
    const items = allFindings(report).filter(
      (item) => item.ruleId.startsWith('profile/') && item.fixes.length > 0,
    );
    if (items.length === 0) {
      setNotice(t('tui.noProfileFixes'));
      return;
    }
    const pairs = items.flatMap((item) =>
      item.fixes.map((entry) => ({ key: fixKey(item, entry), item, fix: entry })),
    );
    const allSelected = pairs.every((pair) => selected.has(pair.key));
    setSelected((previous) => {
      const next = new Map(previous);
      for (const pair of pairs) {
        if (allSelected) next.delete(pair.key);
        else
          next.set(pair.key, {
            key: pair.key,
            projectId: pair.item.projectId ?? '*',
            fix: pair.fix,
          });
      }
      return next;
    });
    setNotice(
      t(allSelected ? 'tui.profilesCleared' : 'tui.profilesSelected', { count: pairs.length }),
    );
  };

  const toggleFixes = (item: Finding | undefined): void => {
    if (!item || item.fixes.length === 0) return;
    setSelected((previous) => {
      const next = new Map(previous);
      const keys = item.fixes.map((fix) => fixKey(item, fix));
      const allSelected = keys.every((key) => next.has(key));
      item.fixes.forEach((fix, index) => {
        const key = keys[index] ?? '';
        if (allSelected) next.delete(key);
        else next.set(key, { key, projectId: item.projectId ?? '*', fix });
      });
      return next;
    });
  };

  const move = (delta: number, total: number): void => {
    if (current) {
      setDetailCursor((value) => clamp(value + delta, total));
    } else {
      setCursor((value) => ({ ...value, [tab]: clamp(value[tab] + delta, total) }));
    }
  };

  useInput((input, key) => {
    if (applying) return;
    if (confirming) {
      if (input === 'y' || input === 's' || input === 'т') {
        setConfirming(false);
        setApplying(true);
        void apply(previews)
          .then((result) => {
            const dir =
              report && path.isAbsolute(result.backupDir)
                ? path.relative(report.root, result.backupDir)
                : result.backupDir;
            setNotice(t('cli.applied', { count: result.files.length, dir }));
            reload();
          })
          .catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : String(reason));
          })
          .finally(() => {
            setApplying(false);
          });
      } else {
        setConfirming(false);
        setNotice(t('cli.aborted'));
      }
      return;
    }
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
      return;
    }
    if (!report) return;

    const total = current
      ? detailFindings.length
      : tab === 'overview'
        ? workspaceFindings.length
        : tab === 'projects'
          ? projects.length
          : tab === 'versions'
            ? matrixRows.length
            : tab === 'node'
              ? report.installedNodes.length
              : tab === 'outdated'
                ? (outdatedRows?.length ?? 0)
                : tab === 'store'
                  ? (storePlan?.groups.length ?? 0)
                  : previews.length;

    if (key.upArrow || input === 'k') move(-1, total);
    else if (key.downArrow || input === 'j') move(1, total);
    else if (key.pageUp) move(-listHeight, total);
    else if (key.pageDown) move(listHeight, total);
    else if (key.home) move(-total, total);
    else if (key.end) move(total, total);
    else if (key.escape || key.backspace) {
      setDetail(undefined);
    } else if (key.return && !current && tab === 'projects') {
      setDetail(cursor.projects);
      setDetailCursor(0);
    } else if (input === ' ' && !current && tab === 'versions') {
      const row = matrixRows[cursor.versions];
      if (row)
        toggleFix(
          `align|${row.name}`,
          alignPackage(
            projects.map((entry) => entry.project),
            row.name,
          )?.fix,
        );
    } else if (input === ' ' && !current && tab === 'outdated') {
      const row = outdatedRows?.[cursor.outdated];
      if (row)
        toggleFix(
          `outdated|${row.projectId}|${row.name}`,
          bumpInMajor(projects.find((entry) => entry.project.id === row.projectId)?.project, row),
          row.projectId,
        );
    } else if (input === ' ') {
      toggleFixes(
        current
          ? detailFindings[detailCursor]
          : tab === 'overview'
            ? workspaceFindings[cursor.overview]
            : undefined,
      );
    } else if (input === 'u') {
      toggleProfileFixes();
    } else if (key.tab || key.rightArrow || key.leftArrow) {
      if (current) return;
      const step = key.leftArrow || key.shift ? -1 : 1;
      setTab(
        (value) => TABS[(TABS.indexOf(value) + step + TABS.length) % TABS.length] ?? 'overview',
      );
    } else if (/^[1-7]$/.test(input)) {
      setDetail(undefined);
      setTab(TABS[Number(input) - 1] ?? 'overview');
    } else if (input === 's') {
      setMinSeverity(
        (value) => SEVERITIES[(SEVERITIES.indexOf(value) + 1) % SEVERITIES.length] ?? 'info',
      );
      setDetailCursor(0);
      setCursor((value) => ({ ...value, overview: 0 }));
    } else if (input === 'r') {
      reload();
    } else if (input === 'a' && tab === 'fixes' && previews.length > 0) {
      setConfirming(true);
    }
  });

  if (error) {
    return <Text color="red">{error}</Text>;
  }
  if (!report) {
    return <Text dimColor>{`packman… ${progress}`}</Text>;
  }

  const totals = summarize(allFindings(report));
  return (
    <Box flexDirection="column" height={rows}>
      <Box justifyContent="space-between" columnGap={1}>
        <Box flexShrink={1} minWidth={0}>
          <Text bold wrap="truncate-end">
            {t('report.title')} <Text dimColor>{report.root}</Text>
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Counts counts={totals} />
        </Box>
      </Box>
      <Box columnGap={2}>
        {TABS.map((name, index) => (
          <Text
            key={name}
            inverse={name === tab && !current}
            {...tone(name === tab ? 'greenBright' : undefined)}
          >
            {` ${index + 1} ${t(`tui.tab.${name}`)}${name === 'fixes' ? ` (${selected.size})` : ''} `}
          </Text>
        ))}
        <Text dimColor>{t('tui.minSeverity', { severity: t(`severity.${minSeverity}`) })}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        {current ? (
          <ProjectDetail
            entry={current}
            findings={detailFindings}
            cursor={detailCursor}
            height={listHeight}
            selected={selected}
          />
        ) : tab === 'overview' ? (
          <Overview
            report={report}
            findings={workspaceFindings}
            cursor={cursor.overview}
            height={listHeight}
            selected={selected}
          />
        ) : tab === 'projects' ? (
          <Projects projects={projects} cursor={cursor.projects} height={listHeight} />
        ) : tab === 'versions' ? (
          <VersionsTab
            rows={matrixRows}
            cursor={cursor.versions}
            height={listHeight}
            selected={selected}
          />
        ) : tab === 'node' ? (
          <NodeTab report={report} cursor={cursor.node} height={listHeight} />
        ) : tab === 'outdated' ? (
          <OutdatedTab
            rows={outdatedRows}
            error={loadOutdated ? outdatedError : t('tui.outdatedUnavailable')}
            cursor={cursor.outdated}
            height={listHeight}
            selected={selected}
          />
        ) : tab === 'store' ? (
          <StoreTab report={report} plan={storePlan} cursor={cursor.store} height={listHeight} />
        ) : (
          <FixesTab
            root={report.root}
            previews={previews}
            cursor={cursor.fixes}
            height={listHeight}
          />
        )}
      </Box>
      {confirming && (
        <Text color="yellow" bold>
          {t('cli.confirm', { count: selected.size, files: previews.length })} [y/N]
        </Text>
      )}
      {notice && !confirming && <Text color="green">{notice}</Text>}
      <KeyHints
        hints={[
          ['↑↓', t('tui.key.move')],
          ['tab', t('tui.key.tabs')],
          ['enter', t('tui.key.open')],
          ['esc', t('tui.key.back')],
          ['space', t('tui.key.select')],
          ['u', t('tui.key.profiles')],
          ['s', t('tui.key.severity')],
          ['a', t('tui.key.apply')],
          ['r', t('tui.key.reload')],
          ['q', t('tui.key.quit')],
        ]}
      />
    </Box>
  );
}

function clamp(value: number, total: number): number {
  return Math.max(0, Math.min(total - 1, value));
}

function FindingRow({
  item,
  active,
  picked,
}: {
  item: Finding;
  active: boolean;
  picked: boolean;
}): ReactNode {
  return (
    <Text wrap="truncate-end">
      <Text color={SEVERITY_COLOR[item.severity]}>{SEVERITY_ICON[item.severity]} </Text>
      {item.fixes.length > 0 && (
        <Text color={picked ? 'green' : 'gray'}>{picked ? '[x] ' : '[ ] '}</Text>
      )}
      <Text bold={active}>{tm(item.message)}</Text>
      <Text dimColor> {item.ruleId}</Text>
    </Text>
  );
}

function FindingDetail({ item }: { item: Finding | undefined }): ReactNode {
  if (!item) return null;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginTop={1}>
      {item.evidence.slice(0, 8).map((line, index) => (
        <Text key={index} dimColor wrap="truncate-end">
          {line}
        </Text>
      ))}
      {item.evidence.length > 8 && <Text dimColor>{`… +${item.evidence.length - 8}`}</Text>}
      {item.fixes.map((fix) => (
        <Text key={fix.id} color="green" wrap="truncate-end">
          {`→ ${tm(fix.title)} [${fix.risk}]`}
        </Text>
      ))}
    </Box>
  );
}

const isPicked = (selected: Map<string, SelectedFix>, item: Finding): boolean =>
  item.fixes.length > 0 && item.fixes.every((fix) => selected.has(fixKey(item, fix)));

function Overview(props: {
  report: Report;
  findings: Finding[];
  cursor: number;
  height: number;
  selected: Map<string, SelectedFix>;
}): ReactNode {
  const { report, findings, cursor, height, selected } = props;
  const groupRows = Math.min(report.groups.length, 6);
  return (
    <Box flexDirection="column">
      <Text bold>{t('report.groups')}</Text>
      {report.groups.slice(0, groupRows).map((group) => (
        <Text key={group.name} wrap="truncate-end">
          {'  '}
          {group.name}
          {group.baseline && <Text color="green">{` [${t('report.baseline')}]`}</Text>}
          <Text dimColor>{`  ${group.projectIds.length} · node ${group.node ?? '?'}`}</Text>
        </Text>
      ))}
      {report.groups.length > groupRows && (
        <Text dimColor>{`  … +${report.groups.length - groupRows}`}</Text>
      )}
      <Box marginTop={1}>
        <Text bold>{t('report.workspaceFindings')}</Text>
      </Box>
      <List
        items={findings}
        selected={cursor}
        height={Math.max(3, height - groupRows - 12)}
        empty={t('report.noFindings')}
        renderItem={(item, active) => (
          <FindingRow item={item} active={active} picked={isPicked(selected, item)} />
        )}
      />
      <FindingDetail item={findings[cursor]} />
    </Box>
  );
}

function Projects({
  projects,
  cursor,
  height,
}: {
  projects: ProjectReport[];
  cursor: number;
  height: number;
}): ReactNode {
  return (
    <List
      items={projects}
      selected={cursor}
      height={height}
      renderItem={(entry, active) => {
        const counts = summarize(entry.findings);
        const stacks = entry.stacks
          .filter((stack) => stack.provider !== 'npm')
          .slice(0, 3)
          .map((stack) => `${stack.provider}${stack.version ? `@${stack.version}` : ''}`)
          .join(' ');
        return (
          <Text wrap="truncate-end">
            <Counts counts={counts} />
            <Text bold={active}>{`  ${entry.project.id}`}</Text>
            <Text dimColor>{`  ${stacks}  node ${entry.node.selected?.version ?? '?'}`}</Text>
          </Text>
        );
      }}
    />
  );
}

function ProjectDetail(props: {
  entry: ProjectReport;
  findings: Finding[];
  cursor: number;
  height: number;
  selected: Map<string, SelectedFix>;
}): ReactNode {
  const { entry, findings, cursor, height, selected } = props;
  const node = entry.node.selected
    ? t('report.nodeSelected', {
        version: entry.node.selected.version,
        manager: entry.node.selected.manager,
      })
    : t('report.nodeNone');
  return (
    <Box flexDirection="column">
      <Text bold>
        {entry.project.id}{' '}
        <Text dimColor>
          {entry.stacks
            .filter((stack) => stack.provider !== 'npm')
            .map((stack) => `${stack.provider}${stack.version ? `@${stack.version}` : ''}`)
            .join(', ')}
        </Text>
      </Text>
      <Text dimColor wrap="truncate-end">
        {`${t('report.node')}: ${node}${entry.node.recommended ? `, ${t('report.nodeRecommended', { version: entry.node.recommended })}` : ''} · ${t('report.exposure')}: ${t(`exposure.${entry.exposure}`)}${entry.network.used ? ` · ${t('report.network')}` : ''}`}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <List
          items={findings}
          selected={cursor}
          height={Math.max(3, height - 12)}
          empty={t('report.noFindings')}
          renderItem={(item, active) => (
            <FindingRow item={item} active={active} picked={isPicked(selected, item)} />
          )}
        />
      </Box>
      <FindingDetail item={findings[cursor]} />
    </Box>
  );
}

function NodeTab({
  report,
  cursor,
  height,
}: {
  report: Report;
  cursor: number;
  height: number;
}): ReactNode {
  return (
    <List
      items={report.installedNodes}
      selected={cursor}
      height={height}
      renderItem={(node) => {
        const status = nodeLineStatus(node.version);
        const vulns = nodeVulnerabilities(node.version).length;
        const users = report.projects.filter(
          (entry) => entry.node.selected?.version === node.version,
        ).length;
        return (
          <Text wrap="truncate-end">
            {node.version.padEnd(10)}
            <Text dimColor>{node.manager.padEnd(13)}</Text>
            <Text
              color={
                status.phase === 'eol'
                  ? 'red'
                  : status.phase === 'maintenance-lts'
                    ? 'yellow'
                    : 'green'
              }
            >
              {status.phase.padEnd(17)}
            </Text>
            <Text color={status.phase === 'eol' || vulns > 0 ? 'red' : 'green'}>
              {status.phase === 'eol' ? t('node.eolNotAssessed', { count: vulns }) : `${vulns} CVE`}
            </Text>
            <Text
              dimColor
            >{`  ${t('tui.nodeUsers', { count: users })}  latest ${status.latest ?? '-'}`}</Text>
          </Text>
        );
      }}
    />
  );
}

function FixesTab(props: {
  root: string;
  previews: FilePreview[];
  cursor: number;
  height: number;
}): ReactNode {
  const { root, previews, cursor, height } = props;
  if (previews.length === 0) {
    return <Text dimColor>{t('tui.noSelection')}</Text>;
  }
  const preview = previews[cursor];
  const diff = preview ? lineDiff(preview.before, preview.after) : [];
  return (
    <Box flexDirection="column">
      <List
        items={previews}
        selected={cursor}
        height={Math.min(previews.length, 6)}
        renderItem={(item, active) => <Text bold={active}>{path.relative(root, item.file)}</Text>}
      />
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginTop={1}>
        {diff.slice(0, Math.max(3, height - 10)).map((line, index) => (
          <Text
            key={index}
            {...tone(line.startsWith('+') ? 'green' : line.startsWith('-') ? 'red' : undefined)}
            dimColor={line.startsWith(' ')}
            wrap="truncate-end"
          >
            {line}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

/**
 * Raises an exact or `^`/`~` spec to the newest release of its current major, keeping the operator.
 * Other ranges are left to the user: rewriting them would change their meaning.
 */
export function bumpInMajor(project: Project | undefined, row: OutdatedRow): Fix | undefined {
  const target = row.latestInMajor;
  const operator = /^([\^~]?)\d+\.\d+\.\d+$/.exec(row.spec)?.[1];
  if (!project || !target || operator === undefined) return undefined;
  if (row.current && semver.valid(row.current) && !semver.gt(target, row.current)) return undefined;
  const value = `${operator}${target}`;
  if (value === row.spec) return undefined;
  return fix(
    'outdated/in-major',
    msg('fix.bumpInMajor', { name: row.name, version: value }),
    'review',
    [setDependency(project, row.name, value)],
  );
}

function OutdatedTab(props: {
  rows: OutdatedRow[] | undefined;
  error: string | undefined;
  cursor: number;
  height: number;
  selected: Map<string, SelectedFix>;
}): ReactNode {
  const { rows, error, cursor, height, selected } = props;
  if (error) return <Text color="red">{error}</Text>;
  if (!rows) return <Text dimColor>{t('tui.outdatedLoading')}</Text>;
  const row = rows[cursor];
  return (
    <Box flexDirection="column">
      <List
        items={rows}
        selected={cursor}
        height={Math.max(3, height - 6)}
        empty={t('outdated.none')}
        renderItem={(item, active) => {
          const picked = selected.has(`outdated|${item.projectId}|${item.name}`);
          const major =
            item.latest && item.current && semver.valid(item.current) && semver.valid(item.latest)
              ? semver.major(item.latest) !== semver.major(item.current)
              : false;
          return (
            <Text wrap="truncate-end">
              <Text color={picked ? 'green' : 'gray'}>{picked ? '[x] ' : '[ ] '}</Text>
              <Text bold={active}>{item.name}</Text>
              <Text dimColor>{`  ${item.projectId}  ${item.current ?? '-'}`}</Text>
              {` → ${item.latestInMajor ?? '-'}`}
              <Text {...tone(major ? 'red' : undefined)} dimColor={!major}>
                {`  latest ${item.latest ?? '-'}`}
              </Text>
              {item.deprecated && <Text color="red"> deprecated</Text>}
            </Text>
          );
        }}
      />
      {row && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          marginTop={1}
        >
          <Text wrap="truncate-end">
            {`${row.name} ${row.spec}: wanted ${row.wanted ?? '-'}, ${t('tui.inMajor')} ${row.latestInMajor ?? '-'}, latest ${row.latest ?? '-'}`}
          </Text>
          {row.deprecated && (
            <Text color="red" wrap="truncate-end">
              {row.deprecated}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}

function StoreTab(props: {
  report: Report;
  plan: StorePlan | undefined;
  cursor: number;
  height: number;
}): ReactNode {
  const { report, plan, cursor, height } = props;
  const linked = new Map((report.links ?? []).map((link) => [link.projectId, link]));
  const groups = plan?.groups ?? [];
  const group = groups[cursor];
  return (
    <Box flexDirection="column">
      <List
        items={groups}
        selected={cursor}
        height={Math.max(3, Math.min(groups.length, height - 12))}
        empty={t('store.none')}
        renderItem={(item, active) => {
          const count = item.projectIds.filter((id) => linked.has(id)).length;
          return (
            <Text wrap="truncate-end">
              <Text bold={active}>{item.key.slice(0, 18)}</Text>
              <Text dimColor>
                {`  ${item.mode} · ${item.projectIds.length} · node ${item.node?.version ?? '?'}`}
              </Text>
              <Text {...tone(count > 0 ? 'green' : undefined)} dimColor={count === 0}>
                {`  ${t('tui.storeLinked', { count, total: item.projectIds.length })}`}
              </Text>
            </Text>
          );
        }}
      />
      {group && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          marginTop={1}
        >
          {group.projectIds.slice(0, Math.max(3, height - 18)).map((id) => (
            <Text key={id} wrap="truncate-end">
              <Text color={linked.has(id) ? 'green' : 'gray'}>{linked.has(id) ? '↔ ' : '  '}</Text>
              {id}
            </Text>
          ))}
          {group.warnings.slice(0, 3).map((warning) => (
            <Text key={warning} color="yellow" wrap="truncate-end">
              {`! ${warning}`}
            </Text>
          ))}
          <Text dimColor wrap="truncate-end">
            {t('tui.storeHint', { key: group.key.slice(0, 12) })}
          </Text>
        </Box>
      )}
      {plan && (plan.candidates.length > 0 || plan.excluded.length > 0) && (
        <Text dimColor wrap="truncate-end">
          {t('tui.storeOthers', {
            candidates: plan.candidates.length,
            excluded: plan.excluded.length,
          })}
        </Text>
      )}
    </Box>
  );
}

function VersionsTab(props: {
  rows: MatrixRow[];
  cursor: number;
  height: number;
  selected: Map<string, SelectedFix>;
}): ReactNode {
  const { rows, cursor, height } = props;
  const selected = rows[cursor];
  return (
    <Box flexDirection="column">
      <List
        items={rows}
        selected={cursor}
        height={Math.max(3, height - 10)}
        empty={t('report.noFindings')}
        renderItem={(row, active) => (
          <Text wrap="truncate-end">
            {props.selected.has(`align|${row.name}`) ? (
              <Text color="green">[x] </Text>
            ) : (
              <Text color="yellow">≠ </Text>
            )}
            <Text bold={active}>{row.name}</Text>
            <Text dimColor>{`  ${row.versions.join(' · ')}`}</Text>
          </Text>
        )}
      />
      {selected && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          marginTop={1}
        >
          {selected.versions.map((version) => (
            <Text key={version} wrap="truncate-end">
              <Text bold>{version.padEnd(16)}</Text>
              <Text dimColor>
                {Object.entries(selected.cells)
                  .filter(([, cell]) => (cell.version ?? cell.spec) === version)
                  .map(([id]) => id)
                  .join(', ')}
              </Text>
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
