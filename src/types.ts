/**
 * TokenMeter v5 - Core Types
 *
 * OpenTelemetry-native cost tracking for AI workflows.
 */

import type { Attributes } from "@opentelemetry/api";

// ============================================================================
// Pricing Types (Runtime representation)
// ============================================================================

/**
 * Runtime pricing unit types with explicit size.
 * These are the normalized units used in the pricing manifest at runtime.
 *
 * @see BillingUnit in pricing/schema.ts for JSON catalog format
 *
 * @example
 * "1m_tokens" = per million tokens (most LLMs)
 * "1k_characters" = per thousand characters (TTS)
 * "image" = per image generated
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
 * Runtime model pricing entry (normalized from JSON catalog).
 * Used by manifest.ts for cost calculation.
 *
 * @see CatalogModelPricing in pricing/schema.ts for JSON file format
 */
export interface ModelPricing {
  /** Cost per input unit */
  input?: number;
  /** Cost per output unit */
  output?: number;
  /** Flat cost per request (for request-based pricing) */
  cost?: number;
  /** The unit for pricing (includes size, e.g., "1m_tokens") */
  unit: PricingUnit;
  /** Cost for cached input (prompt caching) */
  cachedInput?: number;
  /** Cost for cached output */
  cachedOutput?: number;
  /** Cost for cache write operations */
  cacheWrite?: number;
  /** Cost for cache read operations */
  cacheRead?: number;

  /**
   * Per-type pricing for flexible multi-modal cost calculation.
   * Keys must match exactly with usageByType keys from UsageData.
   *
   * Follows Langfuse conventions applied to multi-modal workflows:
   * - For images: "output_images", "output_images_4k", "output_images_hd"
   * - For video: "output_seconds", "output_seconds_with_audio"
   * - For audio: "input_characters", "output_audio_seconds"
   * - For LLMs: "input", "output", "input_cached"
   *
   * @example
   * ```typescript
   * pricesByType: {
   *   "output_images": 0.04,      // Base rate
   *   "output_images_4k": 0.10,   // Higher resolution
   *   "output_seconds": 0.20,     // Video seconds
   *   "output_seconds_with_audio": 0.40  // Video with audio
   * }
   * ```
   */
  pricesByType?: Record<string, number>;
}

/**
 * Provider pricing catalog (runtime format)
 */
export interface ProviderPricing {
  [modelId: string]: ModelPricing;
}

/**
 * Complete pricing manifest (runtime format).
 * This is the normalized structure used for cost calculation.
 */
export interface PricingManifest {
  /** Manifest version */
  version: string;
  /** ISO 8601 timestamp of last update */
  updatedAt: string;
  /** Pricing data by provider */
  providers: {
    [providerId: string]: ProviderPricing;
  };
}

// ============================================================================
// Monitor Types
// ============================================================================

/**
 * Progress update during streaming responses.
 * Called on each chunk with accumulated usage data.
 */
export interface StreamingCostUpdate {
  /** Estimated cost based on tokens processed so far (USD) */
  estimatedCost: number;
  /** Total input tokens processed */
  inputTokens: number;
  /** Total output tokens generated so far */
  outputTokens: number;
  /** Provider name */
  provider: string;
  /** Model name */
  model: string;
  /** Whether the stream has completed */
  isComplete: boolean;
}

/**
 * Callback function for streaming cost updates
 */
export type StreamingCostCallback = (update: StreamingCostUpdate) => void;

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
  /**
   * Callback invoked during streaming responses with partial cost estimates.
   * Called on each chunk and once more on completion with isComplete=true.
   *
   * Note: Many APIs only report usage at stream completion, so intermediate
   * updates may have zero values until the final update.
   *
   * @example
   * ```typescript
   * const client = monitor(new OpenAI(), {
   *   onStreamingCost: (update) => {
   *     if (update.isComplete) {
   *       console.log(`Final cost: $${update.estimatedCost.toFixed(6)}`);
   *     }
   *   }
   * });
   * ```
   */
  onStreamingCost?: StreamingCostCallback;

  /**
   * Called before each API call. Can throw to abort the request.
   * Hooks are read-only and cannot modify request arguments.
   *
   * @example
   * ```typescript
   * const client = monitor(new OpenAI(), {
   *   beforeRequest: async (ctx) => {
   *     if (await isRateLimited(ctx.provider)) {
   *       throw new Error('Rate limited');
   *     }
   *     console.log(`Calling ${ctx.spanName}`);
   *   }
   * });
   * ```
   */
  beforeRequest?: (context: RequestContext) => void | Promise<void>;

  /**
   * Called after successful response with calculated cost.
   * Enables request-level cost attribution.
   *
   * @example
   * ```typescript
   * const client = monitor(new OpenAI(), {
   *   afterResponse: (ctx) => {
   *     console.log(`Request cost: $${ctx.cost.toFixed(6)}`);
   *     trackCost(ctx.usage, ctx.cost);
   *   }
   * });
   * ```
   */
  afterResponse?: (context: ResponseContext) => void | Promise<void>;

  /**
   * Called when an error occurs during the API call.
   *
   * @example
   * ```typescript
   * const client = monitor(new OpenAI(), {
   *   onError: (ctx) => {
   *     console.error(`Error in ${ctx.spanName}:`, ctx.error.message);
   *     alertOnError(ctx.error, ctx.provider);
   *   }
   * });
   * ```
   */
  onError?: (context: ErrorContext) => void | Promise<void>;
}

// ============================================================================
// Hook Context Types
// ============================================================================

/**
 * Context passed to the beforeRequest hook.
 * Provides read-only access to request information.
 */
export interface RequestContext {
  /** Method path as array, e.g., ['chat', 'completions', 'create'] */
  methodPath: string[];
  /** Original arguments passed to the method (read-only) */
  args: readonly unknown[];
  /** Detected or configured provider name */
  provider: string;
  /** Full span name, e.g., 'openai.chat.completions.create' */
  spanName: string;
}

/**
 * Context passed to the afterResponse hook.
 * Extends RequestContext with response data and calculated cost.
 */
export interface ResponseContext extends RequestContext {
  /** The API response (original, unmodified) */
  result: unknown;
  /** Calculated cost in USD */
  cost: number;
  /** Extracted usage data, or null if extraction failed */
  usage: UsageData | null;
  /** Request duration in milliseconds */
  durationMs: number;
}

/**
 * Context passed to the onError hook.
 * Extends RequestContext with error information.
 */
export interface ErrorContext extends RequestContext {
  /** The error that occurred */
  error: Error;
  /** Partial usage data if available (e.g., from streaming errors) */
  partialUsage?: UsageData;
  /** Request duration until error in milliseconds */
  durationMs: number;
}

/**
 * Usage data extracted from API responses.
 *
 * usageByType follows Langfuse conventions applied to multi-modal workflows:
 * - Keys are arbitrary strings describing the usage type
 * - For images: "output_images", "output_images_4k", "output_images_hd"
 * - For video: "output_seconds", "output_seconds_with_audio"
 * - For audio: "input_characters", "output_audio_seconds"
 * - For LLMs: "input", "output", "input_cached" (backwards compat)
 *
 * Keys must match exactly with pricesByType keys in ModelPricing for cost calculation.
 */
export interface UsageData {
  /** Provider name */
  provider: string;
  /** Model identifier */
  model: string;
  /** Input units (tokens, characters, etc.) - legacy field for backwards compat */
  inputUnits?: number;
  /** Output units (tokens, characters, images, seconds, etc.) - legacy field for backwards compat */
  outputUnits?: number;
  /** Cached input units */
  cachedInputUnits?: number;
  /** Raw cost if provided by the API */
  rawCost?: number;

  /**
   * Flexible usage breakdown by type (Langfuse-style, multi-modal).
   * Keys are arbitrary strings that must match pricesByType keys exactly.
   *
   * @example
   * ```typescript
   * // Image generation with resolution
   * usageByType: {
   *   "output_images": 4,      // Total images generated
   *   "output_images_4k": 4    // All at 4K resolution
   * }
   *
   * // Video generation with audio
   * usageByType: {
   *   "output_seconds": 8,              // Total video duration
   *   "output_seconds_with_audio": 8    // With audio generation
   * }
   *
   * // Text-to-speech
   * usageByType: {
   *   "input_characters": 5000
   * }
   * ```
   */
  usageByType?: Record<string, number>;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Provider-Specific Usage Types (Discriminated Union)
// ============================================================================

/**
 * Base interface for all provider-specific usage types.
 * Extends UsageData with provider-specific metadata exposed as first-class fields.
 */
interface BaseProviderUsage {
  model: string;
  /** Input units (tokens, characters, etc.) - normalized field */
  inputUnits?: number;
  /** Output units - normalized field */
  outputUnits?: number;
  /** Cached input units */
  cachedInputUnits?: number;
  /** Raw cost if provided by the API */
  rawCost?: number;
}

/**
 * OpenAI-specific usage data
 */
export interface OpenAIUsageData extends BaseProviderUsage {
  provider: "openai";
  /** Total tokens (sum of input + output) */
  totalTokens?: number;
}

/**
 * Anthropic-specific usage data
 */
export interface AnthropicUsageData extends BaseProviderUsage {
  provider: "anthropic";
  /** Tokens used to create cache entries */
  cacheCreationTokens?: number;
}

/**
 * Google (Gemini/Vertex AI)-specific usage data
 */
export interface GoogleUsageData extends BaseProviderUsage {
  provider: "google";
  /** Total token count */
  totalTokens?: number;
}

/**
 * AWS Bedrock-specific usage data
 */
export interface BedrockUsageData extends BaseProviderUsage {
  provider: "bedrock";
  /** Original Bedrock model ID (may include region prefix) */
  originalModelId?: string;
  /** Request ID from AWS */
  requestId?: string;
}

/**
 * fal.ai-specific usage data (image/video generation)
 */
export interface FalUsageData extends BaseProviderUsage {
  provider: "fal";
  /** Request ID */
  requestId?: string;
}

/**
 * ElevenLabs-specific usage data (text-to-speech)
 */
export interface ElevenLabsUsageData extends BaseProviderUsage {
  provider: "elevenlabs";
  /** Character count (same as inputUnits for TTS) */
  characterCount?: number;
}

/**
 * Black Forest Labs (BFL)-specific usage data (image generation)
 */
export interface BFLUsageData extends BaseProviderUsage {
  provider: "bfl";
  /** Request ID */
  requestId?: string;
}

/**
 * Vercel AI SDK-specific usage data
 */
export interface VercelAIUsageData extends BaseProviderUsage {
  provider: "vercel-ai";
  /** Underlying provider (openai, anthropic, etc.) */
  underlyingProvider?: string;
}

/**
 * Generic usage data for unknown/custom providers
 */
export interface GenericUsageData extends BaseProviderUsage {
  provider: string;
  metadata?: Record<string, unknown>;
}

/**
 * Discriminated union of all provider-specific usage types.
 * Use type guards (isOpenAIUsage, isAnthropicUsage, etc.) to narrow the type.
 *
 * @example
 * ```typescript
 * import { isOpenAIUsage, isAnthropicUsage } from 'tokenmeter';
 *
 * function handleUsage(usage: ProviderUsageData | null) {
 *   if (isOpenAIUsage(usage)) {
 *     console.log(`OpenAI: ${usage.inputUnits} in, ${usage.outputUnits} out`);
 *     if (usage.totalTokens) console.log(`Total: ${usage.totalTokens}`);
 *   } else if (isAnthropicUsage(usage)) {
 *     console.log(`Anthropic: ${usage.inputUnits} in, ${usage.outputUnits} out`);
 *     if (usage.cacheCreationTokens) console.log(`Cache: ${usage.cacheCreationTokens}`);
 *   }
 * }
 * ```
 */
export type ProviderUsageData =
  | OpenAIUsageData
  | AnthropicUsageData
  | GoogleUsageData
  | BedrockUsageData
  | FalUsageData
  | ElevenLabsUsageData
  | BFLUsageData
  | VercelAIUsageData
  | GenericUsageData;

// ============================================================================
// Type Guards for Provider-Specific Usage Data
// ============================================================================

/**
 * Input type for provider usage type guards.
 * Accepts any of the usage data types or null/undefined.
 */
type UsageGuardInput = ProviderUsageData | UsageData | null | undefined;

/**
 * Creates a type guard function for a specific provider's usage data.
 *
 * @param provider - The provider string to check against
 * @returns A type guard function that narrows to the specific provider's usage type
 *
 * @example
 * ```typescript
 * const isMyProviderUsage = createProviderGuard<MyProviderUsageData>('my-provider');
 * if (isMyProviderUsage(usage)) {
 *   // usage is now typed as MyProviderUsageData
 * }
 * ```
 *
 * @internal
 */
function createProviderGuard<T extends ProviderUsageData>(
  provider: T["provider"],
): (usage: UsageGuardInput) => usage is T {
  return (usage): usage is T => usage?.provider === provider;
}

/**
 * Type guard for OpenAI usage data
 */
export const isOpenAIUsage = createProviderGuard<OpenAIUsageData>("openai");

/**
 * Type guard for Anthropic usage data
 */
export const isAnthropicUsage =
  createProviderGuard<AnthropicUsageData>("anthropic");

/**
 * Type guard for Google (Gemini/Vertex AI) usage data
 */
export const isGoogleUsage = createProviderGuard<GoogleUsageData>("google");

/**
 * Type guard for AWS Bedrock usage data
 */
export const isBedrockUsage = createProviderGuard<BedrockUsageData>("bedrock");

/**
 * Type guard for fal.ai usage data
 */
export const isFalUsage = createProviderGuard<FalUsageData>("fal");

/**
 * Type guard for ElevenLabs usage data
 */
export const isElevenLabsUsage =
  createProviderGuard<ElevenLabsUsageData>("elevenlabs");

/**
 * Type guard for Black Forest Labs (BFL) usage data
 */
export const isBFLUsage = createProviderGuard<BFLUsageData>("bfl");

/**
 * Type guard for Vercel AI SDK usage data
 */
export const isVercelAIUsage =
  createProviderGuard<VercelAIUsageData>("vercel-ai");

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
  workflowId?: string;
  costUsd: number;
  inputUnits?: number;
  outputUnits?: number;
  attributes?: Record<string, unknown>;
  createdAt: Date;
}

// ============================================================================
// Type-Safe Attribute Mapping
// ============================================================================

/**
 * Mapping from TM_ATTRIBUTES to CostRecord fields.
 *
 * This mapping ensures compile-time safety: if you add a new attribute to
 * TM_ATTRIBUTES that should be persisted, you MUST:
 * 1. Add the field to CostRecord
 * 2. Add the mapping here
 * 3. Add the column to PERSISTED_ATTRIBUTE_COLUMNS
 *
 * TypeScript will error if the CostRecord field doesn't exist.
 *
 * @example Adding a new persisted attribute:
 * ```typescript
 * // 1. Add to TM_ATTRIBUTES
 * TM_ATTRIBUTES.PROJECT_ID = "project.id"
 *
 * // 2. Add to CostRecord interface
 * projectId?: string;
 *
 * // 3. Add mapping here (TypeScript ensures field exists)
 * PROJECT_ID: "projectId"
 *
 * // 4. Add column mapping
 * projectId: "project_id"
 * ```
 */
export const PERSISTED_ATTRIBUTE_MAP = {
  ORG_ID: "organizationId",
  USER_ID: "userId",
  WORKFLOW_ID: "workflowId",
  COST_USD: "costUsd",
  PROVIDER: "provider",
  MODEL: "model",
  INPUT_UNITS: "inputUnits",
  OUTPUT_UNITS: "outputUnits",
} as const satisfies {
  [K in keyof typeof TM_ATTRIBUTES]?: keyof CostRecord;
};

/**
 * Type representing TM_ATTRIBUTE keys that are persisted to the database.
 */
export type PersistedAttributeKey = keyof typeof PERSISTED_ATTRIBUTE_MAP;

/**
 * Maps CostRecord field names to PostgreSQL column names.
 * Used by PostgresExporter for INSERT statements.
 */
export const PERSISTED_ATTRIBUTE_COLUMNS = {
  organizationId: "organization_id",
  userId: "user_id",
  workflowId: "workflow_id",
  costUsd: "cost_usd",
  provider: "provider",
  model: "model",
  inputUnits: "input_units",
  outputUnits: "output_units",
} as const satisfies {
  [K in (typeof PERSISTED_ATTRIBUTE_MAP)[PersistedAttributeKey]]: string;
};

// ============================================================================
// Query Client Types
// ============================================================================

/**
 * Type-safe mapping of groupBy field names to SQL column names.
 *
 * This ensures compile-time safety: if you add a new groupable field,
 * TypeScript will enforce that:
 * 1. The field exists as a valid groupBy option
 * 2. The column mapping is provided
 * 3. The reverse mapping exists in QUERY_COLUMN_TO_FIELD
 *
 * @example Adding a new groupable field:
 * ```typescript
 * // 1. Add to QUERY_GROUP_BY_FIELDS
 * projectId: "project_id"
 *
 * // 2. Add to QUERY_COLUMN_TO_FIELD
 * project_id: "projectId"
 *
 * // 3. GroupByField type automatically updates
 * ```
 */
export const QUERY_GROUP_BY_FIELDS = {
  provider: "provider",
  model: "model",
  organizationId: "organization_id",
  userId: "user_id",
  workflowId: "workflow_id",
} as const;

/**
 * Valid field names for groupBy queries.
 * Derived from QUERY_GROUP_BY_FIELDS keys.
 */
export type GroupByField = keyof typeof QUERY_GROUP_BY_FIELDS;

/**
 * Reverse mapping from SQL column names to camelCase field names.
 * Must include all columns from QUERY_GROUP_BY_FIELDS.
 */
export const QUERY_COLUMN_TO_FIELD = {
  provider: "provider",
  model: "model",
  organization_id: "organizationId",
  user_id: "userId",
  workflow_id: "workflowId",
} as const satisfies {
  [K in (typeof QUERY_GROUP_BY_FIELDS)[GroupByField]]: GroupByField;
};

/**
 * Query options for cost aggregation
 */
export interface CostQueryOptions {
  /** Group results by these attributes */
  groupBy?: GroupByField[];
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
  /** Filter by workflow ID */
  workflowId?: string;
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
