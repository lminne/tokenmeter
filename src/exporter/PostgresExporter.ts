/**
 * PostgreSQL Span Exporter
 *
 * Exports tokenmeter cost spans to PostgreSQL for persistence and querying.
 */

import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { ExportResult } from "@opentelemetry/core";
import { ExportResultCode } from "@opentelemetry/core";
import type { PostgresExporterConfig, CostRecord } from "../types.js";
import { TM_ATTRIBUTES } from "../types.js";
import { logger } from "../logger.js";

/**
 * SpanExporter interface (subset we need)
 * We define this to avoid requiring @opentelemetry/sdk-trace-base at runtime
 */
export interface SpanExporter {
  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void;
  shutdown(): Promise<void>;
}

/**
 * Configuration with defaults applied
 */
interface ResolvedConfig {
  connectionString: string;
  tableName: string;
  batchSize: number;
  flushIntervalMs: number;
}

/**
 * Pool interface (subset of pg.Pool we need)
 */
interface Pool {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
}

/**
 * PostgreSQL exporter for tokenmeter cost spans
 *
 * @example
 * ```typescript
 * import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
 * import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
 * import { PostgresExporter } from 'tokenmeter/exporter';
 *
 * const exporter = new PostgresExporter({
 *   connectionString: process.env.DATABASE_URL,
 * });
 *
 * const provider = new NodeTracerProvider();
 * provider.addSpanProcessor(new BatchSpanProcessor(exporter));
 * provider.register();
 * ```
 */
export class PostgresExporter implements SpanExporter {
  private config: ResolvedConfig;
  private pool: Pool | null = null;
  private buffer: CostRecord[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushPromise: Promise<void> | null = null;
  private isShuttingDown = false;

  constructor(config: PostgresExporterConfig) {
    this.config = {
      connectionString: config.connectionString,
      tableName: config.tableName ?? "tokenmeter_events",
      batchSize: config.batchSize ?? 100,
      flushIntervalMs: config.flushIntervalMs ?? 5000,
    };

    // Start flush interval
    this.flushTimer = setInterval(() => {
      this.flushBuffer().catch((err) => {
        logger.error("Error flushing buffer:", err);
      });
    }, this.config.flushIntervalMs);
  }

  /**
   * Lazily initialize the database pool
   */
  private async getPool(): Promise<Pool> {
    if (this.pool) {
      return this.pool;
    }

    // Dynamic import to avoid requiring pg at load time
    const { Pool } = await import("pg");
    this.pool = new Pool({
      connectionString: this.config.connectionString,
    });

    return this.pool;
  }

  /**
   * Export spans to PostgreSQL
   */
  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    if (this.isShuttingDown) {
      resultCallback({ code: ExportResultCode.FAILED });
      return;
    }

    // Filter and convert spans to cost records
    const records = spans
      .map((span) => this.spanToCostRecord(span))
      .filter((record): record is CostRecord => record !== null);

    if (records.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }

    // Add to buffer
    this.buffer.push(...records);

    // Flush if buffer is full
    if (this.buffer.length >= this.config.batchSize) {
      this.flushBuffer()
        .then(() => {
          resultCallback({ code: ExportResultCode.SUCCESS });
        })
        .catch((err) => {
          logger.error("Export error:", err);
          resultCallback({ code: ExportResultCode.FAILED });
        });
    } else {
      resultCallback({ code: ExportResultCode.SUCCESS });
    }
  }

  /**
   * Convert a ReadableSpan to a CostRecord
   * Returns null if the span doesn't have cost data
   */
  private spanToCostRecord(span: ReadableSpan): CostRecord | null {
    const attrs = span.attributes;

    // Only export spans with tokenmeter cost data
    const costUsd = attrs[TM_ATTRIBUTES.COST_USD] as number | undefined;
    const provider = attrs[TM_ATTRIBUTES.PROVIDER] as string | undefined;
    const model = attrs[TM_ATTRIBUTES.MODEL] as string | undefined;

    // Skip spans without cost data
    if (costUsd === undefined || !provider || !model) {
      return null;
    }

    const spanContext = span.spanContext();

    return {
      id: crypto.randomUUID(),
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      provider,
      model,
      organizationId: attrs[TM_ATTRIBUTES.ORG_ID] as string | undefined,
      userId: attrs[TM_ATTRIBUTES.USER_ID] as string | undefined,
      costUsd,
      inputUnits: attrs[TM_ATTRIBUTES.INPUT_UNITS] as number | undefined,
      outputUnits: attrs[TM_ATTRIBUTES.OUTPUT_UNITS] as number | undefined,
      attributes: this.extractCustomAttributes(attrs),
      createdAt: this.hrTimeToDate(span.startTime),
    };
  }

  /**
   * Extract custom attributes (exclude standard tokenmeter attributes)
   */
  private extractCustomAttributes(
    attrs: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    const standardKeys = new Set<string>(Object.values(TM_ATTRIBUTES));
    const custom: Record<string, unknown> = {};
    let hasCustom = false;

    for (const [key, value] of Object.entries(attrs)) {
      if (!standardKeys.has(key) && !key.startsWith("gen_ai.")) {
        custom[key] = value;
        hasCustom = true;
      }
    }

    return hasCustom ? custom : undefined;
  }

  /**
   * Convert HrTime to Date
   */
  private hrTimeToDate(hrTime: [number, number]): Date {
    const milliseconds = hrTime[0] * 1000 + hrTime[1] / 1_000_000;
    return new Date(milliseconds);
  }

  /**
   * Flush buffered records to the database
   */
  private async flushBuffer(): Promise<void> {
    // If already flushing, wait for that to complete
    if (this.flushPromise) {
      return this.flushPromise;
    }

    if (this.buffer.length === 0) {
      return;
    }

    // Take current buffer and clear it
    const records = this.buffer;
    this.buffer = [];

    this.flushPromise = this.insertRecords(records).finally(() => {
      this.flushPromise = null;
    });

    return this.flushPromise;
  }

  /**
   * Insert records into the database
   */
  private async insertRecords(records: CostRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const pool = await this.getPool();
    const tableName = this.config.tableName;

    // Build bulk insert query
    const columns = [
      "id",
      "trace_id",
      "span_id",
      "provider",
      "model",
      "organization_id",
      "user_id",
      "cost_usd",
      "input_tokens",
      "output_tokens",
      "metadata",
      "created_at",
    ];

    const values: unknown[] = [];
    const placeholders: string[] = [];

    records.forEach((record, i) => {
      const offset = i * columns.length;
      const rowPlaceholders = columns.map((_, j) => `$${offset + j + 1}`);
      placeholders.push(`(${rowPlaceholders.join(", ")})`);

      values.push(
        record.id,
        record.traceId,
        record.spanId,
        record.provider,
        record.model,
        record.organizationId ?? null,
        record.userId ?? null,
        record.costUsd,
        record.inputUnits ?? null,
        record.outputUnits ?? null,
        record.attributes ? JSON.stringify(record.attributes) : null,
        record.createdAt,
      );
    });

    const query = `
      INSERT INTO ${tableName} (${columns.join(", ")})
      VALUES ${placeholders.join(", ")}
      ON CONFLICT (id) DO NOTHING
    `;

    try {
      await pool.query(query, values);
    } catch (err) {
      logger.error("Failed to insert records:", err);
      throw err;
    }
  }

  /**
   * Shutdown the exporter
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    // Stop flush timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush remaining records
    await this.flushBuffer();

    // Close pool
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  /**
   * Force flush (for testing or manual control)
   */
  async forceFlush(): Promise<void> {
    await this.flushBuffer();
  }
}

export default PostgresExporter;
