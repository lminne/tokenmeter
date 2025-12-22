/**
 * Database Types
 *
 * Shared types for database operations used across the library.
 */

/**
 * PostgreSQL Pool interface.
 * A subset of pg.Pool that we need for our operations.
 * This avoids requiring pg at load time while providing type safety.
 */
export interface PoolInterface {
  /**
   * Execute a query against the database.
   * @param text - SQL query string with $1, $2... placeholders
   * @param values - Parameter values for the query
   * @returns Query result with rows
   */
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;

  /**
   * Close all connections in the pool.
   */
  end(): Promise<void>;
}

