import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import type { Severity } from '../core/types.js';

/** Ink `color` prop that is omitted when undefined (required by exactOptionalPropertyTypes). */
export function tone(color: string | undefined): { color?: string } {
  return color ? { color } : {};
}

export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: 'redBright',
  error: 'red',
  warning: 'yellow',
  info: 'cyan',
};

export const SEVERITY_ICON: Record<Severity, string> = {
  critical: '!!',
  error: 'x ',
  warning: '! ',
  info: 'i ',
};

/** Index of the first visible row so that `selected` stays inside a window of `height` rows. */
export function windowStart(selected: number, total: number, height: number): number {
  if (total <= height) return 0;
  const half = Math.floor(height / 2);
  return Math.min(Math.max(0, selected - half), total - height);
}

interface ListProps<T> {
  items: readonly T[];
  selected: number;
  height: number;
  renderItem: (item: T, active: boolean, index: number) => ReactNode;
  empty?: string;
}

export function List<T>({ items, selected, height, renderItem, empty }: ListProps<T>): ReactNode {
  if (items.length === 0) {
    return <Text dimColor>{empty ?? ''}</Text>;
  }
  const start = windowStart(selected, items.length, height);
  const visible = items.slice(start, start + height);
  return (
    <Box flexDirection="column">
      {start > 0 && <Text dimColor>{`  ↑ ${start}`}</Text>}
      {visible.map((item, offset) => {
        const index = start + offset;
        const active = index === selected;
        return (
          <Box key={index}>
            <Text {...tone(active ? 'greenBright' : undefined)}>{active ? '› ' : '  '}</Text>
            {renderItem(item, active, index)}
          </Box>
        );
      })}
      {start + height < items.length && (
        <Text dimColor>{`  ↓ ${items.length - start - height}`}</Text>
      )}
    </Box>
  );
}

export function Counts({ counts }: { counts: Record<Severity, number> }): ReactNode {
  return (
    <Text>
      <Text color={SEVERITY_COLOR.critical}>{counts.critical}</Text>
      <Text dimColor>/</Text>
      <Text color={SEVERITY_COLOR.error}>{counts.error}</Text>
      <Text dimColor>/</Text>
      <Text color={SEVERITY_COLOR.warning}>{counts.warning}</Text>
      <Text dimColor>/</Text>
      <Text color={SEVERITY_COLOR.info}>{counts.info}</Text>
    </Text>
  );
}

export function KeyHints({ hints }: { hints: [string, string][] }): ReactNode {
  return (
    <Box flexWrap="wrap" columnGap={2}>
      {hints.map(([key, label]) => (
        <Text key={key}>
          <Text color="cyan" bold>
            {key}
          </Text>
          <Text dimColor> {label}</Text>
        </Text>
      ))}
    </Box>
  );
}
