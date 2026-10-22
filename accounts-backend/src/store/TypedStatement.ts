import type { SQLInputValue, StatementSync } from 'node:sqlite';

/**
 * A prepared statement whose rows have a known shape.
 */
export class TypedStatement<T extends object> {
  readonly #statement: StatementSync;

  /**
   * Wrap a prepared statement.
   * @param statement - the statement
   */
  constructor(statement: StatementSync) {
    this.#statement = statement;
  }

  /**
   * The first row.
   * @param parameters - the statement's parameters
   * @returns it, or undefined when there is none
   */
  get(...parameters: SQLInputValue[]): T | undefined {
    return this.#statement.get(...parameters) as T | undefined;
  }

  /**
   * Every row.
   * @param parameters - the statement's parameters
   * @returns them
   */
  all(...parameters: SQLInputValue[]): T[] {
    return this.#statement.all(...parameters) as T[];
  }

  /**
   * Run it.
   * @param parameters - the statement's parameters
   * @returns what changed
   */
  run(...parameters: SQLInputValue[]) {
    return this.#statement.run(...parameters);
  }
}
