/**
 * TokenMeter v5 - Core Types
 *
 * OpenTelemetry-native cost tracking for AI workflows.
 */

import type { Span, SpanContext, Attributes } from "@opentelemetry/api";

// ============================================================================
// Pricing Types
// ============================================================================

/**
 * Pricing unit types
 */
export type PricingUnit =
  | "1m_tokens" // Per million tokens (LLMs)
  | "1k_tokens" // Per thousand tokens (legacy)
  | "1k_characters" // Per thousand characters (TTS)
  | "request" // Flat per-request (some image models)
  | "megapixel" // Per megapixel (image generation)
  | "second" // Per second (video/audio)
  | "minute" // Per minute (transcription)
  | "image"; // Per image generated

/**
 * Model pricing entry
 */
export interface ModelPricing {
  /** Cost per input unit */
  input?: number;
  /** Cost per output unit */
  output?: number;
  /** Flat cost per request (for request-based pricing) */
  cost?: number;
  /** The unit for pricing */
  unit: PricingUnit;
  /** Cost for cached input (prompt caching) */
  cachedInput?: number;
  /** Cost for cached output */
  cachedOutput?: number;
  /** Cost for cache write operations */
  cacheWrite?: number;
  /** Cost for cache read operations */
  cacheRead?: number;
}

/**
 * Provider pricing catalog
 */
export interface ProviderPricing {
  [modelId: string]: ModelPricing;
}

/**
 * Complete pricing manifest
 */
export interface PricingManifest {
  version: string;
  updatedAt: string;
  providers: {
    [providerId: string]: ProviderPricing;
  };
}

// ============================================================================
// Monitor Types
// ============================================================================

/**
 * Options for the monitor() function
 */
export interface MonitorOptions {
  /** Name for the instrumented client (used in span names) */
  name?: string;
  /** Override provider detection */
  provider?: string;
  /** Custom attributes to add to all spans from this client */
  attributes?: Attributes;
}

/**
 * Usage data extracted from API responses
 */
export interface UsageData {
  /** Provider name */
  provider: string;
  /** Model identifier */
  model: string;
  /** Input units (tokens, characters, etc.) */
  inputUnits?: number;
  /** Output units (tokens, characters, images, seconds, etc.) */
  outputUnits?: number;
  /** Cached input units */
  cachedInputUnits?: number;
  /** Raw cost if provided by the API */
  rawCost?: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Extraction strategy for parsing API responses
 */
export interface ExtractionStrategy {
  /** Provider this strategy handles */
  provider: string;
  /** Check if this strategy can handle the given method/result */
  canHandle(methodPath: string[], result: unknown): boolean;
  /** Extract usage data from the result */
  extract(
    methodPath: string[],
    result: unknown,
    args: unknown[],
  ): UsageData | null;
}

// ============================================================================
// Context Types
// ============================================================================

/**
 * Attributes that can be set via withAttributes()
 */
export type TokenMeterAttributes = Record<string, string | number | boolean>;

// ============================================================================
// Processor Types
// ============================================================================

/**
 * Configuration for TokenMeterProcessor
 */
export interface TokenMeterProcessorConfig {
  /** Pricing manifest URL (for remote fetch) */
  manifestUrl?: string;
  /** Local fallback manifest path */
  fallbackManifestPath?: string;
  /** Custom pricing overrides */
  pricingOverrides?: PricingManifest["providers"];
}

// ============================================================================
// Exporter Types
// ============================================================================

/**
 * Configuration for PostgresExporter
 */
export interface PostgresExporterConfig {
  /** PostgreSQL connection string */
  connectionString: string;
  /** Table name (default: tokenmeter_costs) */
  tableName?: string;
  /** Batch size for inserts */
  batchSize?: number;
  /** Flush interval in milliseconds */
  flushIntervalMs?: number;
}

/**
 * A cost record for the database
 */
export interface CostRecord {
  id: string;
  traceId: string;
  spanId: string;
  provider: string;
  model: string;
  organizationId?: string;
  userId?: string;
  costUsd: number;
  inputUnits?: number;
  outputUnits?: number;
  attributes?: Record<string, unknown>;
  createdAt: Date;
}

// ============================================================================
// Query Client Types
// ============================================================================

/**
 * Query options for cost aggregation
 */
export interface CostQueryOptions {
  /** Group results by these attributes */
  groupBy?: string[];
  /** Filter by start date */
  from?: Date | string;
  /** Filter by end date */
  to?: Date | string;
  /** Filter by provider */
  provider?: string;
  /** Filter by model */
  model?: string;
  /** Filter by organization ID */
  organizationId?: string;
  /** Filter by user ID */
  userId?: string;
  /** Limit results */
  limit?: number;
}

/**
 * Aggregated cost result
 */
export interface CostResult {
  /** Total cost in USD */
  totalCost: number;
  /** Number of records */
  count: number;
  /** Grouped results (if groupBy specified) */
  groups?: Array<{
    key: Record<string, string>;
    cost: number;
    count: number;
  }>;
}

// ============================================================================
// Semantic Conventions (OTel Attributes)
// ============================================================================

/**
 * TokenMeter-specific span attributes
 */
export const TM_ATTRIBUTES = {
  /** Calculated cost in USD */
  COST_USD: "tokenmeter.cost_usd",
  /** Provider name */
  PROVIDER: "tokenmeter.provider",
  /** Model name */
  MODEL: "tokenmeter.model",
  /** Pricing unit used */
  UNIT: "tokenmeter.unit",
  /** Input units consumed */
  INPUT_UNITS: "tokenmeter.input_units",
  /** Output units consumed */
  OUTPUT_UNITS: "tokenmeter.output_units",
  /** Organization ID (from withAttributes) */
  ORG_ID: "org.id",
  /** User ID (from withAttributes) */
  USER_ID: "user.id",
  /** Workflow ID (from withAttributes) */
  WORKFLOW_ID: "workflow.id",
} as const;

/**
 * Standard GenAI semantic conventions
 */
export const GEN_AI_ATTRIBUTES = {
  /** Input tokens */
  INPUT_TOKENS: "gen_ai.usage.input_tokens",
  /** Output tokens */
  OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
  /** Model name */
  MODEL: "gen_ai.request.model",
  /** System/provider */
  SYSTEM: "gen_ai.system",
} as const;
