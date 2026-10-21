import { setImmediate } from 'node:timers/promises';

import { PROBLEM_LEVEL } from '../levels.ts';

import type { Statements } from './statements.ts';

const DAY = 24 * 3600 * 1000;

/**
 * How long lines are kept.
 */
export interface LogRetention {
  /**
   * How long a line below `warn` is kept, in milliseconds.
   * @default 604800000 — a week
   */
  routineMs?: number;
  /**
   * How long a warning or worse is kept, in milliseconds.
   * @default 7776000000 — ninety days
   */
  problemsMs?: number;
  /**
   * The most lines below `warn` kept, whatever their age, so a burst of
   * requests cannot fill the disk. Counted by id, so roughly.
   * @default 1000000
   */
  maxRoutineLines?: number;
}

/**
 * A process silent this long is gone, and is forgotten.
 */
export const FORGOTTEN_AFTER = DAY;

/**
 * The rows one statement deletes, so no write holds the file for long.
 */
const CHUNK = 5000;

/**
 * Delete the lines past their retention, the topics and roles that have not
 * logged since, and the processes long gone. Deleted a few thousand rows at a
 * time, yielding between, so the writers of every process go on meanwhile.
 * @param statements - the store's statements
 * @param now - the current instant, in unix milliseconds
 * @param retention - how long lines are kept
 * @returns the lines deleted
 */
export async function pruneLogs(
  statements: Statements,
  now: number,
  retention: LogRetention = {},
): Promise<number> {
  const {
    routineMs = 7 * DAY,
    problemsMs = 90 * DAY,
    maxRoutineLines = 1_000_000,
  } = retention;

  let deleted = 0;
  const maxId = statements.maxId.get()?.id ?? null;
  if (maxId !== null) {
    const firstRecent = statements.firstSince.get(now - routineMs)?.id;
    const below = Math.max(
      firstRecent ?? maxId + 1,
      maxId - maxRoutineLines + 1,
    );
    deleted += await deleteInChunks((limit) =>
      statements.deleteRoutine.run(PROBLEM_LEVEL, below, limit),
    );
    deleted += await deleteInChunks((limit) =>
      statements.deleteProblems.run(now - problemsMs, limit),
    );
  }

  const longest = now - Math.max(routineMs, problemsMs);
  statements.forgetTopics.run(longest);
  statements.forgetRoles.run(longest);
  statements.forgetProcesses.run(now - FORGOTTEN_AFTER);
  return deleted;
}

/**
 * Run a delete until it deletes less than a chunk.
 * @param remove - deletes at most `limit` rows
 * @returns the rows deleted
 */
async function deleteInChunks(
  remove: (limit: number) => { changes: number | bigint },
): Promise<number> {
  let deleted = 0;
  for (;;) {
    const changes = Number(remove(CHUNK).changes);
    deleted += changes;
    if (changes < CHUNK) return deleted;
    // eslint-disable-next-line no-await-in-loop -- one chunk at a time, so other writers get the file between them
    await setImmediate();
  }
}
