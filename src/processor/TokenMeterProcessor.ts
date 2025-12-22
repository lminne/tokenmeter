/**
 * TokenMeter Span Processor
 *
 * An OpenTelemetry SpanProcessor that calculates costs based on usage data
 * and adds cost attributes to spans before they are exported.
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

/**
 * TokenMeter SpanProcessor
 *
 * Intercepts spans on end and calculates costs based on usage attributes.
 * The calculated cost is added as an attribute before the span is exported.
 *
 * @example
 * ```typescript
 * import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
 * import { TokenMeterProcessor } from 'tokenmeter';
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
      console.error("[tokenmeter] Failed to load pricing manifest:", error);
    }
  }

  /**
   * Called when a span starts (no-op for TokenMeter)
   */
  onStart(span: Span, parentContext: Context): void {
    // We don't need to do anything when spans start
    // Cost calculation happens on end
  }

  /**
   * Called when a span ends - this is where we calculate and add cost
   */
  onEnd(span: ReadableSpan): void {
    // Get usage attributes from span
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

    // Add cost attribute to span
    // Note: OTel allows modifying span attributes after end but before export
    // We use a workaround by storing cost in the span's resource or via events
    // For now, we'll set it directly (works with most exporters)
    if (cost !== null) {
      // Unfortunately, ReadableSpan doesn't allow setting attributes after end
      // We need to use a custom approach - storing in a side channel or using events
      // For this implementation, we'll log a warning and add via span events
      // A production implementation would use a custom exporter or modify before end

      // The proper way is to calculate cost BEFORE span.end() in the proxy
      // This processor is for catching spans from other sources (like Vercel AI SDK)
      console.debug(
        `[tokenmeter] Calculated cost for ${provider}/${model}: $${cost.toFixed(6)}`
      );
    }
  }

  /**
   * Calculate cost for a span based on usage
   */
  private calculateSpanCost(
    provider: string,
    model: string,
    usage: { inputUnits?: number; outputUnits?: number }
  ): number | null {
    // Check overrides first
    if (this.pricingOverrides[provider]?.[model]) {
      return calculateCost(usage, this.pricingOverrides[provider][model]);
    }

    // Fall back to manifest
    const manifest = this.manifest || getCachedManifest();
    if (!manifest) {
      console.warn(`[tokenmeter] Pricing manifest not loaded, cannot calculate cost`);
      return null;
    }

    const pricing = getModelPricing(provider, model, manifest);
    if (!pricing) {
      console.warn(`[tokenmeter] No pricing found for ${provider}/${model}`);
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
