/**
 * Tests for Inngest integration
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  getInngestTraceHeaders,
  createTracedEvent,
  withInngestTrace,
  withInngestTraceAndAttributes,
  createInngestMiddleware,
} from "../integrations/inngest/index.js";
import { withAttributes, getAttribute } from "../context.js";

// Set up context manager for tests
let contextManager: AsyncLocalStorageContextManager;

beforeAll(() => {
  contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);
});

afterAll(() => {
  contextManager.disable();
  context.disable();
});

describe("Inngest Integration", () => {
  describe("getInngestTraceHeaders", () => {
    it("should return an object", () => {
      const headers = getInngestTraceHeaders();
      expect(typeof headers).toBe("object");
    });
  });

  describe("createTracedEvent", () => {
    it("should create event with trace headers", () => {
      const event = createTracedEvent({
        name: "document/process",
        data: { documentId: "123" },
      });

      expect(event.name).toBe("document/process");
      expect(event.data).toEqual({ documentId: "123" });
      expect(event.trace).toBeDefined();
      expect(typeof event.trace).toBe("object");
    });

    it("should preserve original event properties", () => {
      const event = createTracedEvent({
        name: "user/signup",
        data: { email: "test@example.com", plan: "pro" },
      });

      expect(event.name).toBe("user/signup");
      expect(event.data.email).toBe("test@example.com");
      expect(event.data.plan).toBe("pro");
    });
  });

  describe("withInngestTrace", () => {
    it("should execute function and return result", async () => {
      const event = { trace: {} };

      const result = await withInngestTrace(event, async () => {
        return "completed";
      });

      expect(result).toBe("completed");
    });

    it("should handle events without trace headers", async () => {
      const event = {}; // No trace property

      const result = await withInngestTrace(event, async () => {
        return 42;
      });

      expect(result).toBe(42);
    });

    it("should propagate trace context from headers", async () => {
      const event = {
        trace: {
          traceparent:
            "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
        },
      };

      const result = await withInngestTrace(event, async () => {
        // Context should be available
        return "traced";
      });

      expect(result).toBe("traced");
    });
  });

  describe("withInngestTraceAndAttributes", () => {
    it("should set attributes within the trace context", async () => {
      const event = { trace: {} };
      let capturedUserId: string | undefined;

      await withInngestTraceAndAttributes(
        event,
        { "user.id": "user_123", "workflow.type": "document-processing" },
        async () => {
          capturedUserId = getAttribute("user.id");
        },
      );

      expect(capturedUserId).toBe("user_123");
    });

    it("should return function result", async () => {
      const event = { trace: {} };

      const result = await withInngestTraceAndAttributes(
        event,
        { "org.id": "org_abc" },
        async () => {
          return { success: true, count: 5 };
        },
      );

      expect(result).toEqual({ success: true, count: 5 });
    });

    it("should set multiple attributes", async () => {
      const event = { trace: {} };
      let capturedOrgId: string | undefined;
      let capturedUserId: string | undefined;

      await withInngestTraceAndAttributes(
        event,
        { "org.id": "org_123", "user.id": "user_456" },
        async () => {
          capturedOrgId = getAttribute("org.id");
          capturedUserId = getAttribute("user.id");
        },
      );

      expect(capturedOrgId).toBe("org_123");
      expect(capturedUserId).toBe("user_456");
    });
  });

  describe("createInngestMiddleware", () => {
    it("should create middleware object", () => {
      const middleware = createInngestMiddleware();

      expect(middleware.name).toBe("tokenmeter");
      expect(typeof middleware.init).toBe("function");
    });

    it("should return handlers from init", () => {
      const middleware = createInngestMiddleware();
      const handlers = middleware.init();

      expect(typeof handlers.onFunctionRun).toBe("function");
    });

    it("should handle function run lifecycle", () => {
      const middleware = createInngestMiddleware();
      const handlers = middleware.init();

      const runHandler = handlers.onFunctionRun({
        fn: {},
        ctx: { event: { trace: {} } },
      });

      expect(typeof runHandler.transformInput).toBe("function");
    });

    it("should transform input with trace headers", () => {
      const middleware = createInngestMiddleware();
      const handlers = middleware.init();

      const runHandler = handlers.onFunctionRun({
        fn: {},
        ctx: {
          event: {
            trace: {
              traceparent:
                "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
            },
          },
        },
      });

      const result = runHandler.transformInput({
        ctx: {
          event: {
            trace: {
              traceparent:
                "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
            },
          },
        },
        steps: {},
      });

      expect(result.ctx).toBeDefined();
      expect(result.steps).toBeDefined();
    });
  });
});
