import { Button, InputGroup, Switch } from '@blueprintjs/core';
import { formatRelativeTime } from 'react-cheminfo/core';
import { CapsuleFilter } from 'react-cheminfo/ui';

import { LEVELS, LEVEL_INTENT } from '../levels.ts';
import type { LogFacet, LogFacetsResponse, LogLevel } from '../types.ts';

/**
 * What the bar shows, and what it changes.
 */
export interface LogFilterBarProps {
  minLevel: LogLevel;
  onMinLevel: (level: LogLevel) => void;
  /**
   * The topics and roles that have logged; null until they are read.
   */
  facets: LogFacetsResponse | null;
  topics: readonly string[];
  onTopics: (topics: string[]) => void;
  roles: readonly string[];
  onRoles: (roles: string[]) => void;
  text: string;
  onText: (text: string) => void;
  /**
   * Whether the lines written since are read as they come.
   */
  isLive: boolean;
  onLive: (isLive: boolean) => void;
  onReload: () => void;
}

/**
 * The filters of the lines: the least severe level, the topics and the
 * processes, each a row of capsules; the text a message holds; and whether
 * new lines are read as they come.
 * @param props - See {@link LogFilterBarProps}.
 * @returns The bar.
 */
export function LogFilterBar(props: LogFilterBarProps) {
  const {
    facets,
    minLevel,
    onMinLevel,
    topics,
    onTopics,
    roles,
    onRoles,
    text,
    onText,
    isLive,
    onLive,
    onReload,
  } = props;
  return (
    <div className="monitor-filter-bar">
      <div className="monitor-filter-bar__row">
        <InputGroup
          className="monitor-filter-bar__search"
          type="search"
          leftIcon="search"
          placeholder="Text the message holds"
          aria-label="Text the message holds"
          value={text}
          onValueChange={onText}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
        />
        <Switch
          className="monitor-filter-bar__live"
          label="Live"
          checked={isLive}
          onChange={(event) => onLive(event.currentTarget.checked)}
        />
        <Button
          icon="refresh"
          variant="minimal"
          aria-label="Read again"
          title="Read the lines and the topics again"
          onClick={onReload}
        />
      </div>
      <CapsuleFilter<LogLevel>
        label="From level"
        options={LEVELS.map((level) => ({
          value: level,
          label: level,
          intent: LEVEL_INTENT[level],
          title: `${level} and worse`,
        }))}
        value={minLevel}
        onChange={onMinLevel}
      />
      {facets !== null && facets.topics.length > 1 && (
        <CapsuleFilter
          multiple
          label="Topics"
          allOption={{ label: 'every topic' }}
          options={facetOptions(facets.topics)}
          values={topics}
          onChange={onTopics}
        />
      )}
      {facets !== null && facets.roles.length > 1 && (
        <CapsuleFilter
          multiple
          label="Processes"
          allOption={{ label: 'every process' }}
          options={facetOptions(facets.roles)}
          values={roles}
          onChange={onRoles}
        />
      )}
    </div>
  );
}

/**
 * A capsule per topic or role, saying when it last logged.
 * @param facets - the topics or the roles
 * @returns the capsules
 */
function facetOptions(facets: readonly LogFacet[]) {
  return facets.map((facet) => ({
    value: facet.name,
    label: facet.name,
    intent: 'primary' as const,
    title: `Last logged ${formatRelativeTime(facet.lastAt)}`,
  }));
}
