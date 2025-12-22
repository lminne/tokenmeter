/**
 * Proxy Engine
 *
 * Creates a recursive Proxy that intercepts method calls and creates OTel spans.
 * Calculates costs and adds them to spans before export.
 */

import {
  trace,
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  type Span,
  type Tracer,
  type Attributes,
} from "@opentelemetry/api";
import { extractUsage } from "./strategies/index.js";
import {
  getModelPricing,
  calculateCost,
  getCachedManifest,
  loadManifest,
} from "../pricing/manifest.js";
import type { MonitorOptions, UsageData, PricingManifest } from "../types.js";
import { TM_ATTRIBUTES, GEN_AI_ATTRIBUTES } from "../types.js";
import { logger } from "../logger.js";

// The tracer instance
let tracer: Tracer | null = null;

// Pricing manifest (loaded once)
let pricingManifest: PricingManifest | null = null;
let manifestLoadPromise: Promise<void> | null = null;

/**
 * Ensure pricing manifest is loaded
 */
async function ensureManifestLoaded(): Promise<void> {
  if (pricingManifest) return;
  if (manifestLoadPromise) {
    await manifestLoadPromise;
    return;
  }

  manifestLoadPromise = loadManifest()
    .then((manifest) => {
      pricingManifest = manifest;
    })
    .catch((err) => {
      logger.warn("Failed to load pricing manifest:", err);
    });

  await manifestLoadPromise;
}

// Start loading manifest immediately
ensureManifestLoaded();

/**
 * Get or create the TokenMeter tracer
 */
function getTracer(): Tracer {
  if (!tracer) {
    tracer = trace.getTracer("tokenmeter", "5.0.0");
  }
  return tracer;
}

/**
 * Get baggage attributes from current context
 */
function getBaggageAttributes(): Record<string, string> {
  const currentContext = context.active();
  const baggage = propagation.getBaggage(currentContext);

  if (!baggage) {
    return {};
  }

  const attributes: Record<string, string> = {};
  baggage.getAllEntries().forEach(([key, entry]) => {
    attributes[key] = entry.value;
  });

  return attributes;
}

/**
 * Detect the provider from the client instance
 */
function detectProvider(client: unknown): string {
  if (!client || typeof client !== "object") return "unknown";

  const c = client as Record<string, unknown>;

  // OpenAI: has chat.completions
  if (
    "chat" in c &&
    typeof c.chat === "object" &&
    c.chat &&
    "completions" in c.chat
  ) {
    return "openai";
  }

  // Anthropic: has messages.create
  if ("messages" in c && typeof c.messages === "object") {
    return "anthropic";
  }

  // fal.ai: has subscribe method
  if ("subscribe" in c && typeof c.subscribe === "function") {
    return "fal";
  }

  // ElevenLabs: has textToSpeech
  if ("textToSpeech" in c && typeof c.textToSpeech === "object") {
    return "elevenlabs";
  }

  return "unknown";
}

/**
 * Check if a value is a Promise
 */
function isPromise(value: unknown): value is Promise<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    "then" in value &&
    typeof (value as { then: unknown }).then === "function"
  );
}

/**
 * Check if a value is an async iterator (stream)
 */
function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value !== null && typeof value === "object" && Symbol.asyncIterator in value
  );
}

/**
 * Calculate cost for usage data
 */
function calculateUsageCost(usage: UsageData): number {
  const manifest = pricingManifest || getCachedManifest();
  if (!manifest) {
    logger.warn("Pricing manifest not loaded, cost will be 0");
    return 0;
  }

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
 * Add usage data and calculated cost to a span
 */
function addUsageToSpan(span: Span, usage: UsageData): void {
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
 * Wrap an async iterator to track usage from streamed responses
 */
function wrapAsyncIterator<T>(
  iterator: AsyncIterable<T>,
  span: Span,
  provider: string,
  methodPath: string[],
  args: unknown[],
): AsyncIterable<T> {
  const originalIterator = iterator[Symbol.asyncIterator]();
  let accumulatedUsage: UsageData | null = null;

  const wrappedIterator: AsyncIterator<T> = {
    async next(): Promise<IteratorResult<T>> {
      try {
        const result = await originalIterator.next();

        if (result.done) {
          // Stream completed - extract final usage if available
          if (accumulatedUsage) {
            addUsageToSpan(span, accumulatedUsage);
          }
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
        } else {
          // Accumulate usage from chunks (OpenAI streams include usage in final chunk)
          const chunk = result.value as Record<string, unknown>;
          if (chunk && typeof chunk === "object" && "usage" in chunk) {
            const usage = extractUsage(methodPath, chunk, args, provider);
            if (usage) {
              accumulatedUsage = usage;
            }
          }
        }

        return result;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        span.end();
        throw error;
      }
    },

    async return(value?: unknown): Promise<IteratorResult<T>> {
      // Stream was cancelled - still calculate cost for what we consumed
      if (accumulatedUsage) {
        addUsageToSpan(span, accumulatedUsage);
      }
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();

      if (originalIterator.return) {
        return originalIterator.return(value);
      }
      return { done: true, value: undefined as T };
    },

    async throw(error?: unknown): Promise<IteratorResult<T>> {
      // Stream errored - still calculate cost for what we consumed
      if (accumulatedUsage) {
        addUsageToSpan(span, accumulatedUsage);
      }
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.end();

      if (originalIterator.throw) {
        return originalIterator.throw(error);
      }
      throw error;
    },
  };

  return {
    [Symbol.asyncIterator]: () => wrappedIterator,
  };
}

/**
 * Create a monitored proxy for a client instance
 *
 * @param client - The SDK client instance to wrap
 * @param options - Configuration options
 * @returns A proxied version of the client that creates spans for method calls
 *
 * @example
 * ```typescript
 * import OpenAI from 'openai';
 * import { monitor } from 'tokenmeter';
 *
 * const openai = monitor(new OpenAI({ apiKey: '...' }));
 * await openai.chat.completions.create({ model: 'gpt-4o', messages: [...] });
 * ```
 */
export function monitor<T extends object>(
  client: T,
  options: MonitorOptions = {},
): T {
  const provider = options.provider || detectProvider(client);
  const clientName = options.name || provider;
  const baseAttributes = options.attributes || {};

  /**
   * Create a recursive proxy handler
   */
  function createProxyHandler(path: string[] = []): ProxyHandler<object> {
    return {
      get(target: object, prop: string | symbol, receiver: unknown): unknown {
        const value = Reflect.get(target, prop, receiver);

        // Skip symbols and internal properties
        if (typeof prop === "symbol" || prop.startsWith("_")) {
          return value;
        }

        // If it's a function, wrap it
        if (typeof value === "function") {
          return function (this: unknown, ...args: unknown[]): unknown {
            const methodPath = [...path, prop];
            const spanName = `${clientName}.${methodPath.join(".")}`;

            // Get baggage attributes from context (set by withAttributes)
            const baggageAttrs = getBaggageAttributes();

            // Start span with base + baggage attributes
            const currentTracer = getTracer();
            const span = currentTracer.startSpan(spanName, {
              kind: SpanKind.CLIENT,
              attributes: {
                ...baseAttributes,
                ...baggageAttrs, // Include baggage attributes (org.id, user.id, etc.)
                [TM_ATTRIBUTES.PROVIDER]: provider,
                "rpc.service": clientName,
                "rpc.method": methodPath.join("."),
              },
            });

            // Execute within span context
            return context.with(trace.setSpan(context.active(), span), () => {
              try {
                const result = value.apply(
                  this === receiver ? target : this,
                  args,
                );

                // Handle async results
                if (isPromise(result)) {
                  return result.then(
                    (resolved) => {
                      // Check if result is a stream
                      if (isAsyncIterable(resolved)) {
                        return wrapAsyncIterator(
                          resolved as AsyncIterable<unknown>,
                          span,
                          provider,
                          methodPath,
                          args,
                        );
                      }

                      // Extract usage from result
                      const usage = extractUsage(
                        methodPath,
                        resolved,
                        args,
                        provider,
                      );
                      if (usage) {
                        addUsageToSpan(span, usage);
                      }

                      span.setStatus({ code: SpanStatusCode.OK });
                      span.end();
                      return resolved;
                    },
                    (error) => {
                      span.recordException(error);
                      span.setStatus({
                        code: SpanStatusCode.ERROR,
                        message:
                          error instanceof Error
                            ? error.message
                            : String(error),
                      });
                      span.end();
                      throw error;
                    },
                  );
                }

                // Handle sync results (rare for API calls)
                if (isAsyncIterable(result)) {
                  return wrapAsyncIterator(
                    result as AsyncIterable<unknown>,
                    span,
                    provider,
                    methodPath,
                    args,
                  );
                }

                const usage = extractUsage(methodPath, result, args, provider);
                if (usage) {
                  addUsageToSpan(span, usage);
                }

                span.setStatus({ code: SpanStatusCode.OK });
                span.end();
                return result;
              } catch (error) {
                span.recordException(error as Error);
                span.setStatus({
                  code: SpanStatusCode.ERROR,
                  message:
                    error instanceof Error ? error.message : String(error),
                });
                span.end();
                throw error;
              }
            });
          };
        }

        // If it's an object, recursively proxy it
        if (value !== null && typeof value === "object") {
          return new Proxy(
            value as object,
            createProxyHandler([...path, prop]),
          );
        }

        return value;
      },
    };
  }

  return new Proxy(client, createProxyHandler()) as T;
}

export default monitor;
