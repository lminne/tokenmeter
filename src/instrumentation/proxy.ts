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
  type Tracer,
} from "@opentelemetry/api";
import { extractUsage, setRegistryResolver } from "./strategies/index.js";
import { loadManifest } from "../pricing/manifest.js";
import type { MonitorOptions, RequestContext } from "../types.js";
import { setCostCapture } from "../client/withCost.js";
import { TM_ATTRIBUTES } from "../types.js";
import { logger } from "../logger.js";
import { getFactoryMethods, getRegisteredStrategy } from "../registry.js";
import { VERSION, PACKAGE_NAME } from "../config.js";
import { BLOCKED_PROPERTIES, FACTORY_METHODS } from "../constants.js";

// Import from helper modules
import { detectProvider } from "./provider-detect.js";
import {
  isPromise,
  invokeBeforeRequest,
  invokeAfterResponse,
  invokeOnError,
} from "./hooks.js";
import {
  calculateUsageCost,
  addUsageToSpan,
} from "./span-utils.js";
import {
  wrapAsyncIterator,
  isAsyncIterable,
  sanitizeErrorMessage,
} from "./stream-wrapper.js";

// The tracer instance
let tracer: Tracer | null = null;

// Connect strategies to registry (avoids circular dependency)
setRegistryResolver(getRegisteredStrategy);

// Try to fetch updated pricing manifest on module load (fire-and-forget)
// Bundled pricing is always available, this just refreshes with latest data
loadManifest().catch((err) => {
  logger.debug("Failed to fetch updated pricing manifest:", err);
});

/**
 * Get or create the TokenMeter tracer.
 * Lazily initializes the tracer on first access.
 *
 * @returns The TokenMeter tracer instance
 *
 * @internal
 */
function getTracer(): Tracer {
  if (!tracer) {
    tracer = trace.getTracer(PACKAGE_NAME, VERSION);
  }
  return tracer;
}

/**
 * Get baggage attributes from the current OpenTelemetry context.
 * These attributes are set by `withAttributes()` and should be
 * propagated to all spans created within that context.
 *
 * @returns Record of baggage key-value pairs (e.g., org.id, user.id)
 *
 * @internal
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
 * Check if a value should be recursively proxied.
 * We proxy plain objects and class instances, but not primitives,
 * arrays, built-in types, or API response objects.
 *
 * @param value - The value to check
 * @param methodPath - The current method path for context
 * @returns True if the value should be wrapped in a proxy
 *
 * @internal
 */
function shouldProxyReturnValue(value: unknown, methodPath: string[]): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }

  // Don't proxy arrays
  if (Array.isArray(value)) {
    return false;
  }

  // Don't proxy built-in types
  if (
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof Error ||
    value instanceof Map ||
    value instanceof Set ||
    value instanceof WeakMap ||
    value instanceof WeakSet ||
    value instanceof ArrayBuffer ||
    value instanceof DataView
  ) {
    return false;
  }

  // Don't proxy Buffer or typed arrays
  if (ArrayBuffer.isView(value)) {
    return false;
  }

  // Don't proxy if it looks like an API response (has usage data or common response fields)
  const v = value as Record<string, unknown>;
  if (
    "usage" in v ||
    "usageMetadata" in v ||
    "choices" in v ||
    "content" in v ||
    "candidates" in v ||
    "response" in v ||
    "id" in v
  ) {
    return false;
  }

  // Proxy objects that look like SDK clients/models (have methods we want to intercept)
  // This catches things like GenerativeModel returned from getGenerativeModel()
  if (
    "generateContent" in v ||
    "generateContentStream" in v ||
    "chat" in v ||
    "create" in v ||
    "messages" in v ||
    "embedContent" in v ||
    "countTokens" in v ||
    "startChat" in v
  ) {
    return true;
  }

  // For factory methods (like getGenerativeModel), proxy the returned object
  const methodName = methodPath[methodPath.length - 1];
  if (
    methodName?.startsWith("get") ||
    methodName?.startsWith("create") ||
    methodName === "model" ||
    methodName === "models"
  ) {
    return true;
  }

  return false;
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
  const onStreamingCost = options.onStreamingCost;
  const beforeRequest = options.beforeRequest;
  const afterResponse = options.afterResponse;
  const onError = options.onError;

  // WeakSet to track already-proxied objects and prevent double-wrapping
  const proxiedObjects = new WeakSet<object>();

  /**
   * Wrap a value in a proxy if it should be monitored
   */
  function wrapIfNeeded(value: object, path: string[]): object {
    // Don't double-wrap
    if (proxiedObjects.has(value)) {
      return value;
    }

    const proxy = new Proxy(value, createProxyHandler(path));
    proxiedObjects.add(proxy);
    return proxy;
  }

  /**
   * Create a recursive proxy handler
   */
  function createProxyHandler(path: string[] = []): ProxyHandler<object> {
    return {
      get(target: object, prop: string | symbol, receiver: unknown): unknown {
        // Skip symbols
        if (typeof prop === "symbol") {
          return Reflect.get(target, prop, receiver);
        }

        // Prototype pollution protection
        if (BLOCKED_PROPERTIES.has(prop)) {
          return Reflect.get(target, prop, receiver);
        }

        const value = Reflect.get(target, prop, receiver);

        // Skip internal properties
        if (prop.startsWith("_")) {
          return value;
        }

        // If it's a function, wrap it
        if (typeof value === "function") {
          return createMethodWrapper(
            value,
            target,
            receiver,
            prop,
            path,
          );
        }

        // If it's an object, recursively proxy it
        if (value !== null && typeof value === "object") {
          return wrapIfNeeded(value as object, [...path, prop]);
        }

        return value;
      },
    };
  }

  /**
   * Create a wrapper function for a method call
   */
  function createMethodWrapper(
    originalMethod: (...args: unknown[]) => unknown,
    target: object,
    receiver: unknown,
    prop: string,
    path: string[],
  ): (...args: unknown[]) => unknown {
    return function (this: unknown, ...args: unknown[]): unknown {
      const methodPath = [...path, prop];
      const spanName = `${clientName}.${methodPath.join(".")}`;

      // Check if this is a factory method that returns an object we should proxy
      // For these, we don't create spans but do wrap the returned object
      const registeredFactoryMethods = getFactoryMethods(provider);
      const isFactoryMethod =
        (FACTORY_METHODS as readonly string[]).includes(prop) ||
        registeredFactoryMethods.includes(prop);

      if (isFactoryMethod) {
        return handleFactoryMethod(
          originalMethod,
          target,
          receiver,
          args,
          methodPath,
        );
      }

      // Create request context for hooks (args as readonly)
      const requestContext: RequestContext = {
        methodPath,
        args: args as readonly unknown[],
        provider,
        spanName,
      };

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

      // Track start time for duration calculation
      const startTime = Date.now();

      // Helper to handle successful response
      const handleSuccess = async (resolved: unknown): Promise<unknown> => {
        const durationMs = Date.now() - startTime;

        // Check if result is a stream
        if (isAsyncIterable(resolved)) {
          return wrapAsyncIterator(resolved as AsyncIterable<unknown>, {
            span,
            provider,
            methodPath,
            args: requestContext.args,
            spanName,
            startTime,
            onStreamingCost,
            afterResponse,
            onError,
          });
        }

        // Extract usage from result
        const usage = extractUsage(methodPath, resolved, args, provider);
        const cost = usage ? calculateUsageCost(usage) : 0;

        // Capture cost for withCost() utility
        setCostCapture(cost, usage);

        if (usage) {
          addUsageToSpan(span, usage);
        }

        span.setStatus({ code: SpanStatusCode.OK });
        span.end();

        // Invoke afterResponse hook
        await invokeAfterResponse(afterResponse, {
          ...requestContext,
          result: resolved,
          cost,
          usage,
          durationMs,
        });

        // Wrap returned objects that should be monitored (e.g., chat sessions)
        if (
          resolved !== null &&
          typeof resolved === "object" &&
          shouldProxyReturnValue(resolved, methodPath)
        ) {
          return wrapIfNeeded(resolved as object, methodPath);
        }

        return resolved;
      };

      // Helper to handle errors
      const handleError = async (error: unknown): Promise<never> => {
        const durationMs = Date.now() - startTime;

        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: sanitizeErrorMessage(error),
        });
        span.end();

        // Invoke onError hook
        await invokeOnError(onError, {
          ...requestContext,
          error: error as Error,
          durationMs,
        });

        throw error;
      };

      // Execute within span context
      return context.with(trace.setSpan(context.active(), span), () => {
        try {
          // Invoke beforeRequest hook (can throw to abort)
          const beforePromise = invokeBeforeRequest(
            beforeRequest,
            requestContext,
          );

          // Handle async beforeRequest
          if (isPromise(beforePromise)) {
            return beforePromise.then(
              () => executeMethod(originalMethod, target, receiver, args, handleSuccess, handleError, methodPath, span, startTime, requestContext),
              handleError,
            );
          }

          // Sync beforeRequest completed, proceed with call
          return executeMethod(originalMethod, target, receiver, args, handleSuccess, handleError, methodPath, span, startTime, requestContext);
        } catch (error) {
          const durationMs = Date.now() - startTime;

          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: sanitizeErrorMessage(error),
          });
          span.end();

          // Fire onError hook (fire-and-forget for sync error)
          invokeOnError(onError, {
            ...requestContext,
            error: error as Error,
            durationMs,
          }).catch((err) => logger.warn("onError hook error:", err));

          // Return rejected promise for consistency with async APIs
          return Promise.reject(error);
        }
      });
    };
  }

  /**
   * Execute the original method and handle results
   */
  function executeMethod(
    originalMethod: (...args: unknown[]) => unknown,
    target: object,
    receiver: unknown,
    args: unknown[],
    handleSuccess: (resolved: unknown) => Promise<unknown>,
    handleError: (error: unknown) => Promise<never>,
    methodPath: string[],
    span: ReturnType<Tracer["startSpan"]>,
    startTime: number,
    requestContext: RequestContext,
  ): unknown {
    const result = originalMethod.apply(
      receiver === target ? target : receiver,
      args,
    );

    // Handle async results
    if (isPromise(result)) {
      return result.then(handleSuccess, handleError);
    }

    // Handle sync results (rare for API calls)
    if (isAsyncIterable(result)) {
      return wrapAsyncIterator(result as AsyncIterable<unknown>, {
        span,
        provider,
        methodPath,
        args: requestContext.args,
        spanName: requestContext.spanName,
        startTime,
        onStreamingCost,
        afterResponse,
        onError,
      });
    }

    // Sync result - handle inline
    const durationMs = Date.now() - startTime;
    const usage = extractUsage(methodPath, result, args, provider);
    const cost = usage ? calculateUsageCost(usage) : 0;

    // Capture cost for withCost() utility
    setCostCapture(cost, usage);

    if (usage) {
      addUsageToSpan(span, usage);
    }

    span.setStatus({ code: SpanStatusCode.OK });
    span.end();

    // Fire afterResponse hook (fire-and-forget for sync result)
    invokeAfterResponse(afterResponse, {
      ...requestContext,
      result,
      cost,
      usage,
      durationMs,
    }).catch((err) => logger.warn("afterResponse hook error:", err));

    // Wrap returned objects that should be monitored
    if (
      result !== null &&
      typeof result === "object" &&
      shouldProxyReturnValue(result, methodPath)
    ) {
      return wrapIfNeeded(result as object, methodPath);
    }

    return result;
  }

  /**
   * Handle factory method calls (don't create spans, but proxy results)
   */
  function handleFactoryMethod(
    originalMethod: (...args: unknown[]) => unknown,
    target: object,
    receiver: unknown,
    args: unknown[],
    methodPath: string[],
  ): unknown {
    const result = originalMethod.apply(
      receiver === target ? target : receiver,
      args,
    );

    // Handle async factory methods
    if (isPromise(result)) {
      return result.then((resolved) => {
        if (
          resolved !== null &&
          typeof resolved === "object" &&
          shouldProxyReturnValue(resolved, methodPath)
        ) {
          return wrapIfNeeded(resolved as object, methodPath);
        }
        return resolved;
      });
    }

    // Handle sync factory methods (like getGenerativeModel)
    if (
      result !== null &&
      typeof result === "object" &&
      shouldProxyReturnValue(result, methodPath)
    ) {
      return wrapIfNeeded(result as object, methodPath);
    }

    return result;
  }

  const proxy = new Proxy(client, createProxyHandler()) as T;
  proxiedObjects.add(proxy);
  return proxy;
}

export default monitor;
