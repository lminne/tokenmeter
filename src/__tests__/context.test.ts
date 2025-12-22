/**
 * Tests for the context system (withAttributes)
 *
 * Note: These tests require OTel SDK to be set up for context propagation to work.
 * We set up a minimal SDK for testing purposes.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  withAttributes,
  withAttributesSync,
  getCurrentAttributes,
  getAttribute,
  extractTraceHeaders,
  contextFromHeaders,
  withExtractedContext,
} from "../context.js";

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

describe("Context Management", () => {
  describe("withAttributes", () => {
    it("should make attributes available within the scope", async () => {
      let capturedAttributes: Record<string, string> = {};

      await withAttributes(
        {
          "org.id": "org_123",
          "user.id": "user_456",
        },
        async () => {
          capturedAttributes = getCurrentAttributes();
        },
      );

      expect(capturedAttributes["org.id"]).toBe("org_123");
      expect(capturedAttributes["user.id"]).toBe("user_456");
    });

    it("should convert non-string values to strings", async () => {
      let capturedAttributes: Record<string, string> = {};

      await withAttributes(
        {
          count: 42,
          enabled: true,
        },
        async () => {
          capturedAttributes = getCurrentAttributes();
        },
      );

      expect(capturedAttributes["count"]).toBe("42");
      expect(capturedAttributes["enabled"]).toBe("true");
    });

    it("should nest attributes correctly", async () => {
      let innerAttributes: Record<string, string> = {};

      await withAttributes(
        {
          "org.id": "org_123",
        },
        async () => {
          await withAttributes(
            {
              "user.id": "user_456",
            },
            async () => {
              innerAttributes = getCurrentAttributes();
            },
          );
        },
      );

      expect(innerAttributes["org.id"]).toBe("org_123");
      expect(innerAttributes["user.id"]).toBe("user_456");
    });

    it("should not leak attributes outside the scope", async () => {
      await withAttributes(
        {
          "scoped.attr": "value",
        },
        async () => {
          // Attribute available here
          expect(getAttribute("scoped.attr")).toBe("value");
        },
      );

      // Attribute not available outside
      expect(getAttribute("scoped.attr")).toBeUndefined();
    });

    it("should return the function result", async () => {
      const result = await withAttributes({}, async () => {
        return 42;
      });

      expect(result).toBe(42);
    });

    it("should handle async operations within scope", async () => {
      let asyncCaptured: string | undefined;

      await withAttributes(
        {
          "async.attr": "async_value",
        },
        async () => {
          // Simulate async operation
          await new Promise((resolve) => setTimeout(resolve, 10));
          asyncCaptured = getAttribute("async.attr");
        },
      );

      expect(asyncCaptured).toBe("async_value");
    });
  });

  describe("withAttributesSync", () => {
    it("should work synchronously", () => {
      let capturedAttributes: Record<string, string> = {};

      withAttributesSync(
        {
          "org.id": "org_sync",
        },
        () => {
          capturedAttributes = getCurrentAttributes();
        },
      );

      expect(capturedAttributes["org.id"]).toBe("org_sync");
    });

    it("should return the function result", () => {
      const result = withAttributesSync({}, () => 100);
      expect(result).toBe(100);
    });

    it("should nest correctly", () => {
      let innerAttrs: Record<string, string> = {};

      withAttributesSync({ outer: "1" }, () => {
        withAttributesSync({ inner: "2" }, () => {
          innerAttrs = getCurrentAttributes();
        });
      });

      expect(innerAttrs.outer).toBe("1");
      expect(innerAttrs.inner).toBe("2");
    });
  });

  describe("getAttribute", () => {
    it("should return undefined when no attributes are set", () => {
      expect(getAttribute("nonexistent")).toBeUndefined();
    });

    it("should return specific attribute value", async () => {
      await withAttributes(
        {
          "test.key": "test_value",
        },
        async () => {
          expect(getAttribute("test.key")).toBe("test_value");
        },
      );
    });
  });

  describe("getCurrentAttributes", () => {
    it("should return empty object when no attributes are set", () => {
      const attrs = getCurrentAttributes();
      expect(attrs).toEqual({});
    });

    it("should return all attributes", async () => {
      await withAttributes(
        {
          a: "1",
          b: "2",
          c: "3",
        },
        async () => {
          const attrs = getCurrentAttributes();
          expect(Object.keys(attrs)).toHaveLength(3);
          expect(attrs.a).toBe("1");
          expect(attrs.b).toBe("2");
          expect(attrs.c).toBe("3");
        },
      );
    });
  });

  describe("extractTraceHeaders", () => {
    it("should return an object (empty when no active trace)", () => {
      const headers = extractTraceHeaders();
      expect(typeof headers).toBe("object");
    });
  });

  describe("contextFromHeaders and withExtractedContext", () => {
    it("should create context from headers", () => {
      const headers = {
        traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
      };

      const ctx = contextFromHeaders(headers);
      expect(ctx).toBeDefined();
    });

    it("should run function within extracted context", async () => {
      const headers = {};

      const result = await withExtractedContext(headers, async () => {
        return "completed";
      });

      expect(result).toBe("completed");
    });
  });
});
