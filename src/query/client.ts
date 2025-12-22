/**
 * Query Client
 *
 * Provides cost aggregation and querying capabilities.
 */

import type { CostQueryOptions, CostResult } from "../types.js";

/**
 * Pool interface (subset of pg.Pool we need)
 */
interface Pool {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
}

/**
 * Query client configuration
 */
export interface QueryClientConfig {
  /** PostgreSQL connection string */
  connectionString: string;
  /** Table name (default: tokenmeter_events) */
  tableName?: string;
}

/**
 * Query client interface
 */
export interface QueryClient {
  /** Get costs with optional filtering and grouping */
  getCosts(options?: CostQueryOptions): Promise<CostResult>;
  /** Get costs for a specific user */
  getCostByUser(
    userId: string,
    options?: Omit<CostQueryOptions, "userId">,
  ): Promise<CostResult>;
  /** Get costs for a specific organization */
  getCostByOrg(
    orgId: string,
    options?: Omit<CostQueryOptions, "organizationId">,
  ): Promise<CostResult>;
  /** Get costs for a specific model */
  getCostByModel(
    model: string,
    options?: Omit<CostQueryOptions, "model">,
  ): Promise<CostResult>;
  /** Get costs for a specific provider */
  getCostByProvider(
    provider: string,
    options?: Omit<CostQueryOptions, "provider">,
  ): Promise<CostResult>;
  /** Get total cost for a workflow/trace */
  getWorkflowCost(workflowId: string): Promise<CostResult>;
  /** Close the database connection */
  close(): Promise<void>;
}

/**
 * Create a query client for cost aggregation
 *
 * @example
 * ```typescript
 * import { createQueryClient } from 'tokenmeter/query';
 *
 * const client = createQueryClient({
 *   connectionString: process.env.DATABASE_URL,
 * });
 *
 * // Get total costs for an organization
 * const orgCosts = await client.getCostByOrg('org_123', {
 *   from: '2024-01-01',
 *   to: '2024-01-31',
 *   groupBy: ['model'],
 * });
 *
 * console.log(`Total: $${orgCosts.totalCost}`);
 * for (const group of orgCosts.groups ?? []) {
 *   console.log(`  ${group.key.model}: $${group.cost}`);
 * }
 * ```
 */
export async function createQueryClient(
  config: QueryClientConfig,
): Promise<QueryClient> {
  const tableName = config.tableName ?? "tokenmeter_events";

  // Dynamic import to avoid requiring pg at load time
  const { Pool } = await import("pg");
  const pool: Pool = new Pool({
    connectionString: config.connectionString,
  });

  /**
   * Build WHERE clause from options
   */
  function buildWhereClause(
    options: CostQueryOptions,
    startParamIndex: number = 1,
  ): { clause: string; values: unknown[]; nextIndex: number } {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = startParamIndex;

    if (options.from) {
      conditions.push(`created_at >= $${paramIndex}`);
      values.push(
        options.from instanceof Date ? options.from : new Date(options.from),
      );
      paramIndex++;
    }

    if (options.to) {
      conditions.push(`created_at <= $${paramIndex}`);
      values.push(
        options.to instanceof Date ? options.to : new Date(options.to),
      );
      paramIndex++;
    }

    if (options.provider) {
      conditions.push(`provider = $${paramIndex}`);
      values.push(options.provider);
      paramIndex++;
    }

    if (options.model) {
      conditions.push(`model = $${paramIndex}`);
      values.push(options.model);
      paramIndex++;
    }

    if (options.organizationId) {
      conditions.push(`organization_id = $${paramIndex}`);
      values.push(options.organizationId);
      paramIndex++;
    }

    if (options.userId) {
      conditions.push(`user_id = $${paramIndex}`);
      values.push(options.userId);
      paramIndex++;
    }

    const clause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    return { clause, values, nextIndex: paramIndex };
  }

  /**
   * Map groupBy field names to column names
   */
  function mapGroupByField(field: string): string {
    const fieldMap: Record<string, string> = {
      provider: "provider",
      model: "model",
      organizationId: "organization_id",
      userId: "user_id",
      workflowId: "workflow_id",
    };
    return fieldMap[field] ?? field;
  }

  /**
   * Execute a cost query
   */
  async function getCosts(options: CostQueryOptions = {}): Promise<CostResult> {
    const { clause, values, nextIndex } = buildWhereClause(options);
    const groupBy = options.groupBy?.map(mapGroupByField) ?? [];

    let query: string;
    let queryValues = values;

    if (groupBy.length > 0) {
      // Query with grouping
      const groupByClause = groupBy.join(", ");
      const selectFields = groupBy
        .map((col) => {
          // Map back to camelCase for the result
          const keyName =
            col === "organization_id"
              ? "organizationId"
              : col === "user_id"
                ? "userId"
                : col === "workflow_id"
                  ? "workflowId"
                  : col;
          return `${col} as "${keyName}"`;
        })
        .join(", ");

      query = `
        SELECT
          ${selectFields},
          COALESCE(SUM(cost_usd), 0)::numeric as cost,
          COUNT(*)::int as count
        FROM ${tableName}
        ${clause}
        GROUP BY ${groupByClause}
        ORDER BY cost DESC
        ${options.limit ? `LIMIT $${nextIndex}` : ""}
      `;

      if (options.limit) {
        queryValues = [...values, options.limit];
      }

      const result = await pool.query(query, queryValues);

      // Calculate totals
      let totalCost = 0;
      let totalCount = 0;
      const groups: CostResult["groups"] = [];

      for (const row of result.rows as Array<Record<string, unknown>>) {
        const cost = parseFloat(row.cost as string);
        const count = row.count as number;

        totalCost += cost;
        totalCount += count;

        // Build key object from group fields
        const key: Record<string, string> = {};
        for (const field of groupBy) {
          const keyName =
            field === "organization_id"
              ? "organizationId"
              : field === "user_id"
                ? "userId"
                : field === "workflow_id"
                  ? "workflowId"
                  : field;
          key[keyName] = (row[keyName] as string) ?? "";
        }

        groups.push({ key, cost, count });
      }

      return { totalCost, count: totalCount, groups };
    } else {
      // Simple aggregate query
      query = `
        SELECT
          COALESCE(SUM(cost_usd), 0)::numeric as total_cost,
          COUNT(*)::int as count
        FROM ${tableName}
        ${clause}
      `;

      const result = await pool.query(query, values);
      const row = result.rows[0] as { total_cost: string; count: number };

      return {
        totalCost: parseFloat(row.total_cost),
        count: row.count,
      };
    }
  }

  return {
    getCosts,

    async getCostByUser(
      userId: string,
      options: Omit<CostQueryOptions, "userId"> = {},
    ): Promise<CostResult> {
      return getCosts({ ...options, userId });
    },

    async getCostByOrg(
      orgId: string,
      options: Omit<CostQueryOptions, "organizationId"> = {},
    ): Promise<CostResult> {
      return getCosts({ ...options, organizationId: orgId });
    },

    async getCostByModel(
      model: string,
      options: Omit<CostQueryOptions, "model"> = {},
    ): Promise<CostResult> {
      return getCosts({ ...options, model });
    },

    async getCostByProvider(
      provider: string,
      options: Omit<CostQueryOptions, "provider"> = {},
    ): Promise<CostResult> {
      return getCosts({ ...options, provider });
    },

    async getWorkflowCost(workflowId: string): Promise<CostResult> {
      const query = `
        SELECT
          COALESCE(SUM(cost_usd), 0)::numeric as total_cost,
          COUNT(*)::int as count
        FROM ${tableName}
        WHERE trace_id = $1
      `;

      const result = await pool.query(query, [workflowId]);
      const row = result.rows[0] as { total_cost: string; count: number };

      return {
        totalCost: parseFloat(row.total_cost),
        count: row.count,
      };
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}

export default createQueryClient;
