/**
 * Inngest Integration
 *
 * Provides helpers for propagating trace context to and from Inngest functions.
 */

import {
  extractTraceHeaders,
  withExtractedContext,
  withAttributes,
} from "../../context.js";
import type { TokenMeterAttributes } from "../../types.js";

/**
 * Trace headers that can be passed in Inngest event metadata
 */
export interface TraceHeaders {
  traceparent?: string;
  tracestate?: string;
  baggage?: string;
}

/**
 * Inngest event with optional trace metadata
 */
export interface InngestEventWithTrace<T = unknown> {
  name: string;
  data: T;
  /** Trace headers for context propagation */
  trace?: TraceHeaders;
}

/**
 * Options for creating traced Inngest events
 */
export interface CreateTracedEventOptions {
  /** Additional attributes to include in the trace */
  attributes?: TokenMeterAttributes;
}

/**
 * Convert TraceHeaders to a Record for use with OTel propagation.
 * Filters out undefined values.
 *
 * @param trace - Optional trace headers object
 * @returns Record with only defined header values
 *
 * @internal
 */
function traceHeadersToRecord(trace?: TraceHeaders): Record<string, string> {
  const headers: Record<string, string> = {};
  if (trace?.traceparent) headers.traceparent = trace.traceparent;
  if (trace?.tracestate) headers.tracestate = trace.tracestate;
  if (trace?.baggage) headers.baggage = trace.baggage;
  return headers;
}

/**
 * Extract trace headers to include when sending an Inngest event.
 *
 * Call this in your API route before sending an Inngest event to propagate
 * the trace context to the Inngest function.
 *
 * @example
 * ```typescript
 * import { inngest } from './inngest';
 * import { getInngestTraceHeaders } from 'tokenmeter/inngest';
 *
 * // In your API route
 * export async function POST(req: Request) {
 *   const trace = getInngestTraceHeaders();
 *
 *   await inngest.send({
 *     name: 'document/process',
 *     data: { documentId: '123' },
 *     trace, // Pass trace headers
 *   });
 *
 *   return Response.json({ ok: true });
 * }
 * ```
 */
export function getInngestTraceHeaders(): TraceHeaders {
  return extractTraceHeaders() as TraceHeaders;
}

/**
 * Create a traced Inngest event with trace headers included.
 *
 * This is a convenience wrapper that combines your event data with trace headers.
 *
 * @example
 * ```typescript
 * import { inngest } from './inngest';
 * import { createTracedEvent } from 'tokenmeter/inngest';
 *
 * await inngest.send(createTracedEvent({
 *   name: 'document/process',
 *   data: { documentId: '123' },
 * }));
 * ```
 */
export function createTracedEvent<T>(
  event: { name: string; data: T },
  options?: CreateTracedEventOptions,
): InngestEventWithTrace<T> {
  return {
    ...event,
    trace: getInngestTraceHeaders(),
  };
}

/**
 * Run a function within the trace context from an Inngest event.
 *
 * Use this at the start of your Inngest function to resume the trace
 * from the parent request.
 *
 * @example
 * ```typescript
 * import { inngest } from './inngest';
 * import { withInngestTrace } from 'tokenmeter/inngest';
 * import { monitor } from 'tokenmeter';
 * import OpenAI from 'openai';
 *
 * const openai = monitor(new OpenAI());
 *
 * export const processDocument = inngest.createFunction(
 *   { id: 'process-document' },
 *   { event: 'document/process' },
 *   async ({ event }) => {
 *     return withInngestTrace(event, async () => {
 *       // All AI calls here are traced back to the original request
 *       const result = await openai.chat.completions.create({
 *         model: 'gpt-4o',
 *         messages: [{ role: 'user', content: 'Summarize this document' }],
 *       });
 *
 *       return { summary: result.choices[0].message.content };
 *     });
 *   }
 * );
 * ```
 */
export async function withInngestTrace<T>(
  event: { trace?: TraceHeaders },
  fn: () => Promise<T>,
): Promise<T> {
  return withExtractedContext(traceHeadersToRecord(event.trace), fn);
}

/**
 * Run a function within trace context and with additional attributes.
 *
 * Combines trace context restoration with attribute setting for Inngest functions.
 *
 * @example
 * ```typescript
 * export const processDocument = inngest.createFunction(
 *   { id: 'process-document' },
 *   { event: 'document/process' },
 *   async ({ event }) => {
 *     return withInngestTraceAndAttributes(
 *       event,
 *       { 'workflow.type': 'document-processing' },
 *       async () => {
 *         // AI calls have both parent trace and custom attributes
 *         const result = await openai.chat.completions.create({...});
 *         return { result };
 *       }
 *     );
 *   }
 * );
 * ```
 */
export async function withInngestTraceAndAttributes<T>(
  event: { trace?: TraceHeaders },
  attributes: TokenMeterAttributes,
  fn: () => Promise<T>,
): Promise<T> {
  return withInngestTrace(event, () => withAttributes(attributes, fn));
}

/**
 * Inngest handler context type
 */
export interface InngestHandlerContext<TEvent = unknown> {
  event: TEvent & { trace?: TraceHeaders };
  step: unknown;
  [key: string]: unknown;
}

/**
 * Inngest handler function type
 */
export type InngestHandler<TEvent, TResult> = (
  ctx: InngestHandlerContext<TEvent>,
) => Promise<TResult>;

/**
 * Wrap an Inngest function handler to automatically restore trace context.
 *
 * This is the recommended way to integrate TokenMeter with Inngest. It extracts
 * trace headers from the event and runs your handler within that context.
 *
 * @example
 * ```typescript
 * import { inngest } from './inngest';
 * import { withInngest } from 'tokenmeter/inngest';
 * import { monitor } from 'tokenmeter';
 * import OpenAI from 'openai';
 *
 * const openai = monitor(new OpenAI());
 *
 * export const processDocument = inngest.createFunction(
 *   { id: 'process-document' },
 *   { event: 'document/process' },
 *   withInngest(async ({ event, step }) => {
 *     // All AI calls here are traced back to the original request
 *     const result = await openai.chat.completions.create({
 *       model: 'gpt-4o',
 *       messages: [{ role: 'user', content: 'Summarize this document' }],
 *     });
 *
 *     return { summary: result.choices[0].message.content };
 *   })
 * );
 * ```
 */
export function withInngest<TEvent, TResult>(
  handler: InngestHandler<TEvent, TResult>,
): InngestHandler<TEvent, TResult> {
  return async (ctx: InngestHandlerContext<TEvent>): Promise<TResult> => {
    return withExtractedContext(traceHeadersToRecord(ctx.event?.trace), () =>
      handler(ctx),
    );
  };
}

