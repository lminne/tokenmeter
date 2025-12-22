/**
 * Span Utilities
 *
 * Helpers for working with OpenTelemetry spans and usage data.
 */

import type { Span, Attributes } from "@opentelemetry/api";
import type { UsageData, StreamingCostCallback } from "../types.js";
import { TM_ATTRIBUTES, GEN_AI_ATTRIBUTES } from "../types.js";
import {
  getModelPricing,
  calculateCost,
  getCachedManifest,
} from "../pricing/manifest.js";
import { logger } from "../logger.js";

/**
 * Calculate cost for usage data.
 * Pricing data is always available via bundled manifest.
 *
 * @param usage - The usage data to calculate cost for
 * @returns The calculated cost in USD
 *
 * @internal
 */
export function calculateUsageCost(usage: UsageData): number {
  const manifest = getCachedManifest();
  const pricing = getModelPricing(usage.provider, usage.model, manifest);

  if (!pricing) {
    logger.warn(`Missing pricing for ${usage.provider}/${usage.model}`);
    return 0;
  }

  return calculateCost(
    {
      inputUnits: usage.inputUnits,
      outputUnits: usage.outputUnits,
      cachedInputUnits: usage.cachedInputUnits,
    },
    pricing,
  );
}

/**
 * Add usage data and calculated cost to a span.
 * Sets both TokenMeter-specific and GenAI semantic convention attributes.
 *
 * @param span - The span to add attributes to
 * @param usage - The usage data to add
 *
 * @internal
 */
export function addUsageToSpan(span: Span, usage: UsageData): void {
  const attributes: Attributes = {
    [TM_ATTRIBUTES.PROVIDER]: usage.provider,
    [TM_ATTRIBUTES.MODEL]: usage.model,
  };

  if (usage.inputUnits !== undefined) {
    attributes[TM_ATTRIBUTES.INPUT_UNITS] = usage.inputUnits;
    attributes[GEN_AI_ATTRIBUTES.INPUT_TOKENS] = usage.inputUnits;
  }

  if (usage.outputUnits !== undefined) {
    attributes[TM_ATTRIBUTES.OUTPUT_UNITS] = usage.outputUnits;
    attributes[GEN_AI_ATTRIBUTES.OUTPUT_TOKENS] = usage.outputUnits;
  }

  attributes[GEN_AI_ATTRIBUTES.MODEL] = usage.model;
  attributes[GEN_AI_ATTRIBUTES.SYSTEM] = usage.provider;

  // Calculate and add cost BEFORE span.end()
  const costUsd = calculateUsageCost(usage);
  attributes[TM_ATTRIBUTES.COST_USD] = costUsd;

  span.setAttributes(attributes);
}

/**
 * Invoke the streaming cost callback with current usage data.
 *
 * @param callback - The callback to invoke
 * @param usage - Current usage data (or null)
 * @param isComplete - Whether the stream has completed
 *
 * @internal
 */
export function invokeStreamingCallback(
  callback: StreamingCostCallback | undefined,
  usage: UsageData | null,
  isComplete: boolean,
): void {
  if (!callback) return;

  try {
    const estimatedCost = usage ? calculateUsageCost(usage) : 0;
    callback({
      estimatedCost,
      inputTokens: usage?.inputUnits ?? 0,
      outputTokens: usage?.outputUnits ?? 0,
      provider: usage?.provider ?? "unknown",
      model: usage?.model ?? "unknown",
      isComplete,
    });
  } catch (err) {
    logger.warn("Streaming cost callback error:", err);
  }
}

