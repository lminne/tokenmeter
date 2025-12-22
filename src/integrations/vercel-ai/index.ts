/**
 * Vercel AI SDK Integration
 *
 * Provides a non-invasive integration with the Vercel AI SDK using
 * the built-in experimental_telemetry feature. No import changes required.
 *
 * @example
 * ```typescript
 * import { generateText } from 'ai';
 * import { openai } from '@ai-sdk/openai';
 * import { telemetry } from 'tokenmeter/vercel-ai';
 *
 * const result = await generateText({
 *   model: openai('gpt-4o'),
 *   prompt: 'Hello!',
 *   experimental_telemetry: telemetry({
 *     userId: 'user_123',
 *     orgId: 'org_456',
 *   }),
 * });
 * ```
 */

import { trace, type Tracer } from "@opentelemetry/api";

/**
 * Telemetry settings expected by Vercel AI SDK
 */
export interface TelemetrySettings {
  /**
   * Enable telemetry collection.
   * @default true
   */
  isEnabled?: boolean;

  /**
   * Identifier for this function call (appears in spans).
   */
  functionId?: string;

  /**
   * Custom metadata to include in telemetry.
   * These become span attributes prefixed with `ai.telemetry.metadata.`
   */
  metadata?: Record<string, string | number | boolean>;

  /**
   * Whether to record input values (prompts, messages).
   * Disable for privacy or performance.
   * @default true
   */
  recordInputs?: boolean;

  /**
   * Whether to record output values (responses).
   * Disable for privacy or performance.
   * @default true
   */
  recordOutputs?: boolean;

  /**
   * Custom OpenTelemetry tracer to use.
   * If not provided, uses the default tracer.
   */
  tracer?: Tracer;
}

/**
 * Options for tokenmeter telemetry configuration
 */
export interface TokenMeterTelemetryOptions {
  /**
   * User ID for cost attribution.
   * Will be added to span metadata as `userId`.
   */
  userId?: string;

  /**
   * Organization ID for cost attribution.
   * Will be added to span metadata as `orgId`.
   */
  orgId?: string;

  /**
   * Workflow ID for grouping related calls.
   * Will be added to span metadata as `workflowId`.
   */
  workflowId?: string;

  /**
   * Function identifier for the telemetry span.
   */
  functionId?: string;

  /**
   * Additional metadata to include.
   */
  metadata?: Record<string, string | number | boolean | undefined>;

  /**
   * Whether to record inputs (prompts/messages).
   * @default true
   */
  recordInputs?: boolean;

  /**
   * Whether to record outputs (responses).
   * @default true
   */
  recordOutputs?: boolean;
}

/**
 * Create telemetry configuration for Vercel AI SDK with tokenmeter attributes.
 *
 * This is the recommended way to integrate tokenmeter with the Vercel AI SDK.
 * It uses the SDK's built-in telemetry feature, requiring no import changes.
 *
 * The SDK will emit OpenTelemetry spans with usage data that can be processed
 * by the TokenMeterProcessor to calculate costs.
 *
 * @example Basic usage
 * ```typescript
 * import { generateText } from 'ai';
 * import { openai } from '@ai-sdk/openai';
 * import { telemetry } from 'tokenmeter/vercel-ai';
 *
 * const result = await generateText({
 *   model: openai('gpt-4o'),
 *   prompt: 'Hello!',
 *   experimental_telemetry: telemetry(),
 * });
 * ```
 *
 * @example With user attribution
 * ```typescript
 * const result = await generateText({
 *   model: openai('gpt-4o'),
 *   prompt: 'Hello!',
 *   experimental_telemetry: telemetry({
 *     userId: 'user_123',
 *     orgId: 'org_456',
 *     workflowId: 'chat-session-789',
 *   }),
 * });
 * ```
 *
 * @example With custom metadata
 * ```typescript
 * const result = await generateText({
 *   model: openai('gpt-4o'),
 *   prompt: 'Hello!',
 *   experimental_telemetry: telemetry({
 *     userId: currentUser.id,
 *     metadata: {
 *       feature: 'chat',
 *       tier: 'premium',
 *     },
 *   }),
 * });
 * ```
 *
 * @example Disable input/output recording for privacy
 * ```typescript
 * const result = await generateText({
 *   model: openai('gpt-4o'),
 *   prompt: sensitivePrompt,
 *   experimental_telemetry: telemetry({
 *     userId: 'user_123',
 *     recordInputs: false,
 *     recordOutputs: false,
 *   }),
 * });
 * ```
 */
export function telemetry(
  options: TokenMeterTelemetryOptions = {},
): TelemetrySettings {
  // Build metadata object with tokenmeter attributes
  const metadata: Record<string, string | number | boolean> = {};

  // Copy user-provided metadata, filtering out undefined values
  if (options.metadata) {
    for (const [key, value] of Object.entries(options.metadata)) {
      if (value !== undefined) {
        metadata[key] = value;
      }
    }
  }

  // Add tokenmeter-specific attributes
  if (options.userId) {
    metadata["tokenmeter.user_id"] = options.userId;
  }
  if (options.orgId) {
    metadata["tokenmeter.org_id"] = options.orgId;
  }
  if (options.workflowId) {
    metadata["tokenmeter.workflow_id"] = options.workflowId;
  }

  return {
    isEnabled: true,
    functionId: options.functionId,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    recordInputs: options.recordInputs ?? true,
    recordOutputs: options.recordOutputs ?? true,
    tracer: trace.getTracer("tokenmeter", "5.0.0"),
  };
}

/**
 * Create a reusable telemetry configuration factory.
 *
 * Useful when you have common attributes across multiple calls.
 *
 * @example
 * ```typescript
 * import { createTelemetry } from 'tokenmeter/vercel-ai';
 *
 * // Create once with common options
 * const withTelemetry = createTelemetry({
 *   orgId: 'org_456',
 *   recordInputs: false, // Privacy setting
 * });
 *
 * // Use in multiple calls
 * await generateText({
 *   model: openai('gpt-4o'),
 *   prompt: 'Hello!',
 *   experimental_telemetry: withTelemetry({ userId: 'user_123' }),
 * });
 *
 * await generateText({
 *   model: openai('gpt-4o'),
 *   prompt: 'Goodbye!',
 *   experimental_telemetry: withTelemetry({ userId: 'user_456' }),
 * });
 * ```
 */
export function createTelemetry(
  defaultOptions: TokenMeterTelemetryOptions = {},
): (options?: TokenMeterTelemetryOptions) => TelemetrySettings {
  return (options?: TokenMeterTelemetryOptions) => {
    return telemetry({
      ...defaultOptions,
      ...options,
      metadata: {
        ...defaultOptions.metadata,
        ...options?.metadata,
      },
    });
  };
}

/**
 * Vercel AI SDK span attribute names.
 *
 * These are the attributes emitted by the Vercel AI SDK when telemetry is enabled.
 * Use these constants when building custom processors or exporters.
 */
export const VERCEL_AI_ATTRIBUTES = {
  /** Model identifier (e.g., "gpt-4o") */
  MODEL_ID: "ai.model.id",
  /** Provider name (e.g., "openai") */
  MODEL_PROVIDER: "ai.model.provider",
  /** Input/prompt tokens used */
  USAGE_PROMPT_TOKENS: "ai.usage.promptTokens",
  /** Output/completion tokens used */
  USAGE_COMPLETION_TOKENS: "ai.usage.completionTokens",
  /** Function identifier from telemetry config */
  FUNCTION_ID: "ai.telemetry.functionId",
  /** Finish reason (e.g., "stop", "length") */
  FINISH_REASON: "ai.response.finishReason",
  /** The prompt text (if recordInputs is true) */
  PROMPT: "ai.prompt",
  /** The response text (if recordOutputs is true) */
  RESPONSE_TEXT: "ai.response.text",
} as const;

/**
 * Span names used by the Vercel AI SDK.
 *
 * Use these to filter/identify Vercel AI SDK spans in processors.
 */
export const VERCEL_AI_SPAN_NAMES = {
  /** Top-level generateText span */
  GENERATE_TEXT: "ai.generateText",
  /** Provider-level doGenerate span */
  GENERATE_TEXT_DO_GENERATE: "ai.generateText.doGenerate",
  /** Top-level streamText span */
  STREAM_TEXT: "ai.streamText",
  /** Provider-level doStream span */
  STREAM_TEXT_DO_STREAM: "ai.streamText.doStream",
  /** Top-level generateObject span */
  GENERATE_OBJECT: "ai.generateObject",
  /** Provider-level doGenerate span for objects */
  GENERATE_OBJECT_DO_GENERATE: "ai.generateObject.doGenerate",
  /** Top-level streamObject span */
  STREAM_OBJECT: "ai.streamObject",
  /** Tool call span */
  TOOL_CALL: "ai.toolCall",
  /** Embedding span */
  EMBED: "ai.embed",
  /** Batch embedding span */
  EMBED_MANY: "ai.embedMany",
} as const;

/**
 * Check if a span name is from the Vercel AI SDK.
 *
 * Useful in custom SpanProcessors to identify Vercel AI spans.
 *
 * @example
 * ```typescript
 * import { isVercelAISpan } from 'tokenmeter/vercel-ai';
 *
 * class MyProcessor implements SpanProcessor {
 *   onEnd(span: ReadableSpan) {
 *     if (isVercelAISpan(span.name)) {
 *       // Process Vercel AI SDK span
 *     }
 *   }
 * }
 * ```
 */
export function isVercelAISpan(spanName: string): boolean {
  return spanName.startsWith("ai.");
}

/**
 * Extract provider and model from Vercel AI SDK span attributes.
 *
 * @example
 * ```typescript
 * const { provider, model } = extractModelInfo(span.attributes);
 * // provider: "openai", model: "gpt-4o"
 * ```
 */
export function extractModelInfo(attributes: Record<string, unknown>): {
  provider: string;
  model: string;
} {
  return {
    provider:
      (attributes[VERCEL_AI_ATTRIBUTES.MODEL_PROVIDER] as string) || "unknown",
    model: (attributes[VERCEL_AI_ATTRIBUTES.MODEL_ID] as string) || "unknown",
  };
}

/**
 * Extract usage data from Vercel AI SDK span attributes.
 *
 * @example
 * ```typescript
 * const usage = extractUsage(span.attributes);
 * // { promptTokens: 100, completionTokens: 50 }
 * ```
 */
export function extractUsage(attributes: Record<string, unknown>): {
  promptTokens: number | undefined;
  completionTokens: number | undefined;
} {
  return {
    promptTokens: attributes[VERCEL_AI_ATTRIBUTES.USAGE_PROMPT_TOKENS] as
      | number
      | undefined,
    completionTokens: attributes[
      VERCEL_AI_ATTRIBUTES.USAGE_COMPLETION_TOKENS
    ] as number | undefined,
  };
}
