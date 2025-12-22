/**
 * Next.js Integration
 *
 * Provides helpers for App Router route handlers to automatically
 * set up cost tracking context.
 */

import { withAttributes } from "../../context.js";
import type { TokenMeterAttributes } from "../../types.js";

/**
 * Context for tokenmeter tracking
 */
export interface TokenMeterContext {
  /** User ID for cost attribution */
  userId?: string;
  /** Organization ID for cost attribution */
  orgId?: string;
  /** Workflow ID for grouping related calls */
  workflowId?: string;
  /** Additional metadata */
  metadata?: Record<string, string>;
}

/**
 * Next.js App Router route handler type
 */
export type RouteHandler = (
  request: Request,
  context?: { params?: Promise<Record<string, string>> },
) => Response | Promise<Response>;

/**
 * Function to extract context from a request
 */
export type ContextExtractor = (
  request: Request,
) => TokenMeterContext | Promise<TokenMeterContext>;

/**
 * Options for withTokenmeter wrapper
 */
export interface WithTokenmeterOptions {
  /** Custom context extractor function */
  getContext?: ContextExtractor;
  /** Header name for user ID (default: x-user-id) */
  userIdHeader?: string;
  /** Header name for org ID (default: x-org-id) */
  orgIdHeader?: string;
  /** Header name for workflow ID (default: x-request-id) */
  workflowIdHeader?: string;
}

/**
 * Default context extractor that reads from common headers
 */
function defaultContextExtractor(
  request: Request,
  options: WithTokenmeterOptions,
): TokenMeterContext {
  const userIdHeader = options.userIdHeader ?? "x-user-id";
  const orgIdHeader = options.orgIdHeader ?? "x-org-id";
  const workflowIdHeader = options.workflowIdHeader ?? "x-request-id";

  return {
    userId: request.headers.get(userIdHeader) ?? undefined,
    orgId: request.headers.get(orgIdHeader) ?? undefined,
    workflowId:
      request.headers.get(workflowIdHeader) ?? crypto.randomUUID(),
  };
}

/**
 * Convert TokenMeterContext to attributes
 */
function contextToAttributes(ctx: TokenMeterContext): TokenMeterAttributes {
  const attrs: TokenMeterAttributes = {};

  if (ctx.userId) {
    attrs["user.id"] = ctx.userId;
  }
  if (ctx.orgId) {
    attrs["org.id"] = ctx.orgId;
  }
  if (ctx.workflowId) {
    attrs["workflow.id"] = ctx.workflowId;
  }
  if (ctx.metadata) {
    for (const [key, value] of Object.entries(ctx.metadata)) {
      attrs[key] = value;
    }
  }

  return attrs;
}

/**
 * Wrap a Next.js App Router route handler with tokenmeter context.
 *
 * All AI calls made with `monitor()`-wrapped clients within the handler
 * will automatically be attributed to the user/org extracted from the request.
 *
 * @example
 * ```typescript
 * // app/api/chat/route.ts
 * import { withTokenmeter } from 'tokenmeter/next';
 * import { monitor } from 'tokenmeter';
 * import OpenAI from 'openai';
 *
 * const openai = monitor(new OpenAI());
 *
 * export const POST = withTokenmeter(async (req) => {
 *   const { message } = await req.json();
 *
 *   // This call is automatically attributed to the user
 *   const result = await openai.chat.completions.create({
 *     model: 'gpt-4o',
 *     messages: [{ role: 'user', content: message }],
 *   });
 *
 *   return Response.json({ reply: result.choices[0].message.content });
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With custom context extraction (e.g., from auth)
 * import { auth } from '@clerk/nextjs/server';
 *
 * export const POST = withTokenmeter(
 *   async (req) => {
 *     // Handler code
 *   },
 *   {
 *     getContext: async (req) => {
 *       const { userId, orgId } = await auth();
 *       return { userId, orgId };
 *     },
 *   }
 * );
 * ```
 */
export function withTokenmeter(
  handler: RouteHandler,
  options: WithTokenmeterOptions = {},
): RouteHandler {
  return async (request: Request, routeContext?: { params?: Promise<Record<string, string>> }) => {
    // Extract context
    let ctx: TokenMeterContext;
    if (options.getContext) {
      ctx = await options.getContext(request);
    } else {
      ctx = defaultContextExtractor(request, options);
    }

    // Convert to attributes
    const attrs = contextToAttributes(ctx);

    // Execute handler within context
    return withAttributes(attrs, async () => {
      return handler(request, routeContext);
    });
  };
}

/**
 * Create a reusable tokenmeter wrapper with preset options.
 *
 * Useful when you have common context extraction logic across multiple routes.
 *
 * @example
 * ```typescript
 * // lib/tokenmeter.ts
 * import { createTokenmeterWrapper } from 'tokenmeter/next';
 * import { auth } from '@clerk/nextjs/server';
 *
 * export const withCostTracking = createTokenmeterWrapper({
 *   getContext: async (req) => {
 *     const { userId, orgId } = await auth();
 *     return { userId, orgId };
 *   },
 * });
 *
 * // app/api/chat/route.ts
 * import { withCostTracking } from '@/lib/tokenmeter';
 *
 * export const POST = withCostTracking(async (req) => {
 *   // ...
 * });
 * ```
 */
export function createTokenmeterWrapper(
  defaultOptions: WithTokenmeterOptions,
): (handler: RouteHandler, options?: WithTokenmeterOptions) => RouteHandler {
  return (handler: RouteHandler, options?: WithTokenmeterOptions) => {
    return withTokenmeter(handler, { ...defaultOptions, ...options });
  };
}

/**
 * Helper to extract common headers from a request
 */
export const headerExtractors = {
  /**
   * Extract user ID from x-user-id header
   */
  userId: (request: Request): string | undefined => {
    return request.headers.get("x-user-id") ?? undefined;
  },

  /**
   * Extract org ID from x-org-id header
   */
  orgId: (request: Request): string | undefined => {
    return request.headers.get("x-org-id") ?? undefined;
  },

  /**
   * Extract API key from Authorization header (Bearer token)
   */
  apiKey: (request: Request): string | undefined => {
    const auth = request.headers.get("authorization");
    if (auth?.startsWith("Bearer ")) {
      return auth.slice(7);
    }
    return undefined;
  },

  /**
   * Extract request ID from x-request-id header
   */
  requestId: (request: Request): string | undefined => {
    return request.headers.get("x-request-id") ?? undefined;
  },
};
