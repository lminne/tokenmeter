/**
 * Stream Wrapper
 *
 * Wraps async iterators to track usage from streamed API responses.
 */

import { SpanStatusCode, type Span } from "@opentelemetry/api";
import type {
  UsageData,
  StreamingCostCallback,
  ResponseContext,
  ErrorContext,
} from "../types.js";
import { setCostCapture } from "../client/withCost.js";
import { extractUsage } from "./strategies/index.js";
import { logger } from "../logger.js";
import {
  calculateUsageCost,
  addUsageToSpan,
  invokeStreamingCallback,
} from "./span-utils.js";
import { invokeAfterResponse, invokeOnError } from "./hooks.js";

/**
 * Sanitize error messages to prevent leaking sensitive information.
 *
 * @param error - The error to sanitize
 * @returns A sanitized error message
 *
 * @internal
 */
export function sanitizeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unknown error";
  }

  let message = error.message;

  // Redact common API key patterns
  message = message.replace(/sk-[a-zA-Z0-9]{20,}/g, "sk-***"); // OpenAI
  message = message.replace(/sk-ant-[a-zA-Z0-9-]{20,}/g, "sk-ant-***"); // Anthropic
  message = message.replace(/AIza[a-zA-Z0-9_-]{35}/g, "AIza***"); // Google
  message = message.replace(/xai-[a-zA-Z0-9]{20,}/g, "xai-***"); // xAI

  // Redact Bearer tokens
  message = message.replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, "Bearer ***");

  // Redact api_key parameters
  message = message.replace(/api[_-]?key[:=]\s*[^\s&"']+/gi, "api_key=***");

  // Redact authorization headers
  message = message.replace(
    /authorization[:=]\s*[^\s&"']+/gi,
    "authorization=***",
  );

  return message;
}

/**
 * Options for wrapping an async iterator
 */
export interface WrapAsyncIteratorOptions {
  span: Span;
  provider: string;
  methodPath: string[];
  args: readonly unknown[];
  spanName: string;
  startTime: number;
  onStreamingCost?: StreamingCostCallback;
  afterResponse?: (ctx: ResponseContext) => void | Promise<void>;
  onError?: (ctx: ErrorContext) => void | Promise<void>;
}

/**
 * Wrap an async iterator to track usage from streamed responses.
 * Handles completion, cancellation, and error cases.
 *
 * @param iterator - The original async iterator to wrap
 * @param options - Configuration options
 * @returns A wrapped async iterator that tracks usage
 *
 * @internal
 */
export function wrapAsyncIterator<T>(
  iterator: AsyncIterable<T>,
  options: WrapAsyncIteratorOptions,
): AsyncIterable<T> {
  const {
    span,
    provider,
    methodPath,
    args,
    spanName,
    startTime,
    onStreamingCost,
    afterResponse,
    onError,
  } = options;
  const originalIterator = iterator[Symbol.asyncIterator]();
  let accumulatedUsage: UsageData | null = null;
  let streamResult: unknown = undefined;

  const wrappedIterator: AsyncIterator<T> = {
    async next(): Promise<IteratorResult<T>> {
      try {
        const result = await originalIterator.next();

        if (result.done) {
          // Stream completed - extract final usage if available
          const cost = accumulatedUsage
            ? calculateUsageCost(accumulatedUsage)
            : 0;

          // Capture cost for withCost() utility
          setCostCapture(cost, accumulatedUsage);

          if (accumulatedUsage) {
            addUsageToSpan(span, accumulatedUsage);
          }
          // Notify callback with final (complete) update
          invokeStreamingCallback(onStreamingCost, accumulatedUsage, true);
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();

          // Invoke afterResponse hook once at stream end
          const durationMs = Date.now() - startTime;
          await invokeAfterResponse(afterResponse, {
            methodPath,
            args,
            provider,
            spanName,
            result: streamResult,
            cost,
            usage: accumulatedUsage,
            durationMs,
          });
        } else {
          // Track stream result for final hook
          streamResult = result.value;
          // Accumulate usage from chunks (OpenAI streams include usage in final chunk)
          const chunk = result.value as Record<string, unknown>;
          if (chunk && typeof chunk === "object" && "usage" in chunk) {
            const usage = extractUsage(
              methodPath,
              chunk,
              args as unknown[],
              provider,
            );
            if (usage) {
              accumulatedUsage = usage;
              // Notify callback with intermediate update
              invokeStreamingCallback(onStreamingCost, accumulatedUsage, false);
            }
          }
        }

        return result;
      } catch (error) {
        const durationMs = Date.now() - startTime;
        // Capture partial usage before recording error
        if (accumulatedUsage) {
          try {
            addUsageToSpan(span, accumulatedUsage);
          } catch (usageError) {
            logger.warn("Failed to add partial usage to span:", usageError);
          }
        }
        // Notify callback of completion on error
        invokeStreamingCallback(onStreamingCost, accumulatedUsage, true);
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: sanitizeErrorMessage(error),
        });
        span.end();

        // Invoke onError hook
        await invokeOnError(onError, {
          methodPath,
          args,
          provider,
          spanName,
          error: error as Error,
          partialUsage: accumulatedUsage ?? undefined,
          durationMs,
        });

        throw error;
      }
    },

    async return(value?: unknown): Promise<IteratorResult<T>> {
      const durationMs = Date.now() - startTime;
      // Stream was cancelled - still calculate cost for what we consumed
      const cost = accumulatedUsage ? calculateUsageCost(accumulatedUsage) : 0;

      // Capture cost for withCost() utility
      setCostCapture(cost, accumulatedUsage);

      try {
        if (accumulatedUsage) {
          addUsageToSpan(span, accumulatedUsage);
        }
        // Notify callback of completion on cancellation
        invokeStreamingCallback(onStreamingCost, accumulatedUsage, true);
        span.setStatus({ code: SpanStatusCode.OK });
      } catch (error) {
        logger.warn("Failed to finalize stream span:", error);
        span.setStatus({ code: SpanStatusCode.ERROR });
      } finally {
        span.end();
      }

      // Invoke afterResponse hook on stream cancellation
      await invokeAfterResponse(afterResponse, {
        methodPath,
        args,
        provider,
        spanName,
        result: streamResult,
        cost,
        usage: accumulatedUsage,
        durationMs,
      });

      if (originalIterator.return) {
        return originalIterator.return(value);
      }
      return { done: true, value: value as T };
    },

    async throw(error?: unknown): Promise<IteratorResult<T>> {
      const durationMs = Date.now() - startTime;
      // Stream errored - still calculate cost for what we consumed
      try {
        if (accumulatedUsage) {
          addUsageToSpan(span, accumulatedUsage);
        }
      } catch (usageError) {
        logger.warn("Failed to add usage on stream error:", usageError);
      }
      // Notify callback of completion on error
      invokeStreamingCallback(onStreamingCost, accumulatedUsage, true);
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: sanitizeErrorMessage(error),
      });
      span.end();

      // Invoke onError hook
      await invokeOnError(onError, {
        methodPath,
        args,
        provider,
        spanName,
        error: error as Error,
        partialUsage: accumulatedUsage ?? undefined,
        durationMs,
      });

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
 * Check if a value is an async iterator (stream)
 *
 * @param value - The value to check
 * @returns True if the value is an async iterable
 *
 * @internal
 */
export function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value !== null && typeof value === "object" && Symbol.asyncIterator in value
  );
}

