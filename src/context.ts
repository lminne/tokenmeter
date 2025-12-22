/**
 * Context Management
 *
 * Provides a simple API for setting attributes that propagate to all spans
 * created within a scope. Abstracts OTel Baggage/Context complexity.
 */

import {
  context,
  propagation,
  ROOT_CONTEXT,
  type Context,
  type Baggage,
  type BaggageEntry,
} from "@opentelemetry/api";
import type { TokenMeterAttributes } from "./types.js";

/**
 * Run a function with custom attributes that will be added to all spans created within.
 *
 * Uses OTel Baggage for propagation across async boundaries and to child spans.
 *
 * @param attributes - Key-value pairs to add to all spans in this scope
 * @param fn - The async function to execute
 * @returns The result of the function
 *
 * @example
 * ```typescript
 * import { withAttributes } from 'tokenmeter';
 *
 * await withAttributes({
 *   'org.id': 'org_123',
 *   'user.id': 'user_456',
 *   'workflow.id': 'video-gen-99'
 * }, async () => {
 *   // All spans created here will have these attributes
 *   await openai.chat.completions.create({...});
 *   await fal.subscribe({...});
 * });
 * ```
 */
export async function withAttributes<T>(
  attributes: TokenMeterAttributes,
  fn: () => Promise<T>,
): Promise<T> {
  // Get current baggage or create new one
  const currentContext = context.active();
  let baggage =
    propagation.getBaggage(currentContext) || propagation.createBaggage();

  // Add attributes to baggage
  for (const [key, value] of Object.entries(attributes)) {
    baggage = baggage.setEntry(key, {
      value: String(value),
    });
  }

  // Create new context with updated baggage
  const newContext = propagation.setBaggage(currentContext, baggage);

  // Run function within the new context
  return context.with(newContext, fn);
}

/**
 * Synchronous version of withAttributes for cases where async isn't needed
 *
 * @param attributes - Key-value pairs to add to all spans in this scope
 * @param fn - The function to execute
 * @returns The result of the function
 */
export function withAttributesSync<T>(
  attributes: TokenMeterAttributes,
  fn: () => T,
): T {
  const currentContext = context.active();
  let baggage =
    propagation.getBaggage(currentContext) || propagation.createBaggage();

  for (const [key, value] of Object.entries(attributes)) {
    baggage = baggage.setEntry(key, {
      value: String(value),
    });
  }

  const newContext = propagation.setBaggage(currentContext, baggage);
  return context.with(newContext, fn);
}

/**
 * Get the current attributes from the active context's baggage
 *
 * @returns Record of current baggage entries
 */
export function getCurrentAttributes(): Record<string, string> {
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
 * Get a specific attribute from the current context
 *
 * @param key - The attribute key to retrieve
 * @returns The attribute value, or undefined if not set
 */
export function getAttribute(key: string): string | undefined {
  const currentContext = context.active();
  const baggage = propagation.getBaggage(currentContext);

  if (!baggage) {
    return undefined;
  }

  const entry = baggage.getEntry(key);
  return entry?.value;
}

/**
 * Extract traceparent header for cross-service propagation
 *
 * Useful for propagating context to external services (e.g., Inngest jobs)
 *
 * @returns Object with traceparent and tracestate headers
 */
export function extractTraceHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  propagation.inject(context.active(), headers);
  return headers;
}

/**
 * Create a context from trace headers (for receiving propagated context)
 *
 * @param headers - Object containing traceparent/tracestate headers
 * @returns OTel Context with extracted trace info
 */
export function contextFromHeaders(headers: Record<string, string>): Context {
  return propagation.extract(ROOT_CONTEXT, headers);
}

/**
 * Run a function within a context extracted from headers
 *
 * Useful for continuing a trace from an external source (e.g., incoming webhook)
 *
 * @param headers - Object containing traceparent/tracestate headers
 * @param fn - The async function to execute
 * @returns The result of the function
 */
export async function withExtractedContext<T>(
  headers: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const extractedContext = contextFromHeaders(headers);
  return context.with(extractedContext, fn);
}
