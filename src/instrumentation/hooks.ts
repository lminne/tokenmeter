/**
 * Hook Invocation Helpers
 *
 * Safely invoke user-provided hooks with error handling.
 */

import type {
  RequestContext,
  ResponseContext,
  ErrorContext,
} from "../types.js";
import { logger } from "../logger.js";

/**
 * Check if a value is a Promise
 * @internal
 */
export function isPromise(value: unknown): value is Promise<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    "then" in value &&
    typeof (value as { then: unknown }).then === "function"
  );
}

/**
 * Safely invoke the beforeRequest hook.
 * Can throw to abort the request.
 * Returns the result directly (void or Promise<void>) to allow sync execution when possible.
 *
 * @param hook - The beforeRequest hook function
 * @param ctx - The request context
 * @returns void or Promise<void>
 *
 * @internal
 */
export function invokeBeforeRequest(
  hook: ((ctx: RequestContext) => void | Promise<void>) | undefined,
  ctx: RequestContext,
): void | Promise<void> {
  if (!hook) return;
  return hook(ctx);
}

/**
 * Safely invoke the afterResponse hook.
 * Errors in the hook are logged but don't affect the response.
 *
 * @param hook - The afterResponse hook function
 * @param ctx - The response context
 *
 * @internal
 */
export async function invokeAfterResponse(
  hook: ((ctx: ResponseContext) => void | Promise<void>) | undefined,
  ctx: ResponseContext,
): Promise<void> {
  if (!hook) return;

  try {
    const result = hook(ctx);
    if (isPromise(result)) {
      await result;
    }
  } catch (err) {
    logger.warn("afterResponse hook error:", err);
  }
}

/**
 * Safely invoke the onError hook.
 * Errors in the hook are logged but don't affect error propagation.
 *
 * @param hook - The onError hook function
 * @param ctx - The error context
 *
 * @internal
 */
export async function invokeOnError(
  hook: ((ctx: ErrorContext) => void | Promise<void>) | undefined,
  ctx: ErrorContext,
): Promise<void> {
  if (!hook) return;

  try {
    const result = hook(ctx);
    if (isPromise(result)) {
      await result;
    }
  } catch (err) {
    logger.warn("onError hook error:", err);
  }
}

