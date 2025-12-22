/**
 * withCost Utility
 *
 * Provides ergonomic access to request-level cost attribution.
 * Uses AsyncLocalStorage to capture cost from the afterResponse hook.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { UsageData } from "../types.js";

/**
 * Captured cost data from a monitored API call
 */
export interface CostCapture {
  /** Calculated cost in USD */
  cost: number;
  /** Extracted usage data */
  usage: UsageData | null;
}

/**
 * Result from withCost including the response and cost data
 */
export interface WithCostResult<T> {
  /** The API response */
  result: T;
  /** Calculated cost in USD */
  cost: number;
  /** Extracted usage data, or null if extraction failed */
  usage: UsageData | null;
}

// AsyncLocalStorage for capturing cost in the current execution context
const costCaptureStorage = new AsyncLocalStorage<CostCapture>();

/**
 * Get the current cost capture context (internal use by proxy)
 * @internal
 */
export function getCostCapture(): CostCapture | undefined {
  return costCaptureStorage.getStore();
}

/**
 * Set cost data in the current capture context (internal use by proxy)
 * @internal
 */
export function setCostCapture(cost: number, usage: UsageData | null): void {
  const capture = costCaptureStorage.getStore();
  if (capture) {
    capture.cost = cost;
    capture.usage = usage;
  }
}

/**
 * Execute a function and capture the cost of any monitored API calls within.
 *
 * This provides request-level cost attribution without needing to configure
 * hooks on every client.
 *
 * @param fn - Function that makes monitored API calls
 * @returns The result along with cost and usage data
 *
 * @example
 * ```typescript
 * import { monitor, withCost } from 'tokenmeter';
 *
 * const openai = monitor(new OpenAI());
 *
 * const { result, cost, usage } = await withCost(() =>
 *   openai.chat.completions.create({
 *     model: 'gpt-4o',
 *     messages: [{ role: 'user', content: 'Hello!' }]
 *   })
 * );
 *
 * console.log(`Response: ${result.choices[0].message.content}`);
 * console.log(`Cost: $${cost.toFixed(6)}`);
 * console.log(`Tokens: ${usage?.inputUnits} in, ${usage?.outputUnits} out`);
 * ```
 *
 * @example Multiple calls - captures total cost
 * ```typescript
 * const { result, cost } = await withCost(async () => {
 *   const response1 = await openai.chat.completions.create({...});
 *   const response2 = await openai.chat.completions.create({...});
 *   return { response1, response2 };
 * });
 *
 * console.log(`Total cost for both calls: $${cost.toFixed(6)}`);
 * ```
 */
export async function withCost<T>(
  fn: () => Promise<T>,
): Promise<WithCostResult<T>> {
  const capture: CostCapture = { cost: 0, usage: null };

  const result = await costCaptureStorage.run(capture, fn);

  return {
    result,
    cost: capture.cost,
    usage: capture.usage,
  };
}

/**
 * Synchronous version of withCost for sync API calls (rare)
 *
 * @param fn - Function that makes monitored API calls
 * @returns The result along with cost and usage data
 */
export function withCostSync<T>(fn: () => T): WithCostResult<T> {
  const capture: CostCapture = { cost: 0, usage: null };

  const result = costCaptureStorage.run(capture, fn);

  return {
    result,
    cost: capture.cost,
    usage: capture.usage,
  };
}

