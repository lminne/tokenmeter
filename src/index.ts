/**
 * TokenMeter v5
 *
 * OpenTelemetry-native cost tracking for AI workflows.
 *
 * @example
 * ```typescript
 * import OpenAI from 'openai';
 * import { monitor, withAttributes } from 'tokenmeter';
 *
 * // 1. Wrap your client
 * const openai = monitor(new OpenAI({ apiKey: '...' }));
 *
 * // 2. Track with attributes
 * await withAttributes({ 'org.id': 'org_123' }, async () => {
 *   await openai.chat.completions.create({
 *     model: 'gpt-4o',
 *     messages: [{ role: 'user', content: 'Hello!' }]
 *   });
 * });
 * ```
 */

// Core instrumentation
export { monitor } from "./instrumentation/proxy.js";

// Context management
export {
  withAttributes,
  withAttributesSync,
  getCurrentAttributes,
  getAttribute,
  extractTraceHeaders,
  contextFromHeaders,
  withExtractedContext,
} from "./context.js";

// Processor
export { TokenMeterProcessor } from "./processor/TokenMeterProcessor.js";

// Pricing utilities
export {
  loadManifest,
  getModelPricing,
  calculateCost,
  getCachedManifest,
  clearManifestCache,
  configurePricing,
  getPricingConfig,
  type PricingConfig,
} from "./pricing/manifest.js";

// Types
export type {
  // Pricing types
  PricingUnit,
  ModelPricing,
  ProviderPricing,
  PricingManifest,
  // Monitor types
  MonitorOptions,
  UsageData,
  ExtractionStrategy,
  // Context types
  TokenMeterAttributes,
  // Processor types
  TokenMeterProcessorConfig,
  // Exporter types
  PostgresExporterConfig,
  CostRecord,
  // Query types
  CostQueryOptions,
  CostResult,
} from "./types.js";

// Semantic conventions
export { TM_ATTRIBUTES, GEN_AI_ATTRIBUTES } from "./types.js";

// Logger configuration
export {
  configureLogger,
  getLoggerConfig,
  resetLogger,
  type LogLevel,
  type LoggerConfig,
} from "./logger.js";

// Extraction strategies (for custom implementations)
export {
  strategies,
  findStrategy,
  extractUsage,
  openaiStrategy,
  anthropicStrategy,
  falStrategy,
  elevenlabsStrategy,
  vercelAIStrategy,
} from "./instrumentation/strategies/index.js";
