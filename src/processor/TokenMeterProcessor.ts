/**
 * TokenMeter Span Processor
 *
 * An OpenTelemetry SpanProcessor that calculates and logs costs for spans
 * with usage data. Useful for debugging and observability of AI costs.
 *
 * ## Important Limitation
 *
 * This processor CANNOT add cost attributes to spans after they end.
 * OpenTelemetry's `ReadableSpan` interface doesn't allow attribute modification
 * after `span.end()` is called. The processor can only:
 * - Log calculated costs for debugging
 * - Validate pricing configuration
 * - Use with `pricingOverrides` for cost estimation
 *
 * ## When to Use
 *
 * 1. **Debugging**: Verify cost calculations during development
 * 2. **Monitoring non-monitor() spans**: Log costs for spans from external
 *    sources (e.g., Vercel AI SDK's experimental_telemetry) that already
 *    include usage data
 *
 * ## For Production Cost Tracking
 *
 * Use `monitor()` to wrap your AI clients instead - it calculates and adds
 * `tokenmeter.cost_usd` to spans BEFORE they end, which is the proper approach.
 *
 * @see monitor() for production cost tracking
 */

import type { Context } from "@opentelemetry/api";
import type {
  SpanProcessor,
  ReadableSpan,
  Span,
} from "@opentelemetry/sdk-trace-base";
import {
  loadManifest,
  getModelPricing,
  calculateCost,
  getCachedManifest,
} from "../pricing/manifest.js";
import type { TokenMeterProcessorConfig, PricingManifest } from "../types.js";
import { TM_ATTRIBUTES, GEN_AI_ATTRIBUTES } from "../types.js";
import { logger } from "../logger.js";

/**
 * TokenMeter SpanProcessor
 *
 * Calculates costs for spans with usage data and logs them.
 *
 * **Note**: This processor cannot add cost attributes to spans after they end.
 * For production cost tracking, use `monitor()` instead.
 *
 * @example
 * ```typescript
 * import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
 * import { TokenMeterProcessor, configureLogger } from 'tokenmeter';
 *
 * // Enable logging to see calculated costs
 * configureLogger({ level: 'debug' });
 *
 * const provider = new NodeTracerProvider();
 * provider.addSpanProcessor(new TokenMeterProcessor());
 * provider.register();
 * ```
 */
export class TokenMeterProcessor implements SpanProcessor {
  private manifest: PricingManifest | null = null;
  private manifestPromise: Promise<void> | null = null;
  private config: TokenMeterProcessorConfig;
  private pricingOverrides: PricingManifest["providers"];

  constructor(config: TokenMeterProcessorConfig = {}) {
    this.config = config;
    this.pricingOverrides = config.pricingOverrides || {};

    // Start loading manifest in background
    this.manifestPromise = this.loadManifestAsync();
  }

  private async loadManifestAsync(): Promise<void> {
    try {
      this.manifest = await loadManifest({
        manifestUrl: this.config.manifestUrl,
      });
    } catch (error) {
      logger.error("Failed to load pricing manifest:", error);
    }
  }

  /**
   * Called when a span starts (no-op for TokenMeter)
   */
  onStart(_span: Span, _parentContext: Context): void {
    // No-op: Cost calculation happens in onEnd
  }

  /**
   * Called when a span ends - calculates and logs cost.
   *
   * Note: Cannot add cost attribute to span after end() - use monitor() for that.
   */
  onEnd(span: ReadableSpan): void {
    const attrs = span.attributes;

    // Check if this span has usage data
    const inputUnits =
      (attrs[TM_ATTRIBUTES.INPUT_UNITS] as number) ||
      (attrs[GEN_AI_ATTRIBUTES.INPUT_TOKENS] as number);
    const outputUnits =
      (attrs[TM_ATTRIBUTES.OUTPUT_UNITS] as number) ||
      (attrs[GEN_AI_ATTRIBUTES.OUTPUT_TOKENS] as number);

    // If no usage data, skip
    if (inputUnits === undefined && outputUnits === undefined) {
      return;
    }

    // Get provider and model
    const provider =
      (attrs[TM_ATTRIBUTES.PROVIDER] as string) ||
      (attrs[GEN_AI_ATTRIBUTES.SYSTEM] as string) ||
      "unknown";
    const model =
      (attrs[TM_ATTRIBUTES.MODEL] as string) ||
      (attrs[GEN_AI_ATTRIBUTES.MODEL] as string) ||
      "unknown";

    // Calculate cost
    const cost = this.calculateSpanCost(provider, model, {
      inputUnits,
      outputUnits,
    });

    // Log calculated cost for debugging
    // Note: We cannot add this to the span - ReadableSpan is immutable after end()
    if (cost !== null) {
      logger.debug(`Calculated cost for ${provider}/${model}: $${cost.toFixed(6)}`);
    }
  }

  /**
   * Calculate cost for a span based on usage
   */
  private calculateSpanCost(
    provider: string,
    model: string,
    usage: { inputUnits?: number; outputUnits?: number },
  ): number | null {
    // Check overrides first
    if (this.pricingOverrides[provider]?.[model]) {
      return calculateCost(usage, this.pricingOverrides[provider][model]);
    }

    // Fall back to manifest
    const manifest = this.manifest || getCachedManifest();
    if (!manifest) {
      logger.warn("Pricing manifest not loaded, cannot calculate cost");
      return null;
    }

    const pricing = getModelPricing(provider, model, manifest);
    if (!pricing) {
      logger.warn(`No pricing found for ${provider}/${model}`);
      return 0; // Return 0, not null, to indicate we tried but found no pricing
    }

    return calculateCost(usage, pricing);
  }

  /**
   * Shutdown the processor
   */
  async shutdown(): Promise<void> {
    // Wait for manifest to finish loading
    if (this.manifestPromise) {
      await this.manifestPromise;
    }
  }

  /**
   * Force flush (no-op for this processor)
   */
  async forceFlush(): Promise<void> {
    // No buffering, nothing to flush
  }
}

export default TokenMeterProcessor;
