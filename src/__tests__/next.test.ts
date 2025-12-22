/**
 * Tests for Next.js integration
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  withTokenmeter,
  createTokenmeterWrapper,
  headerExtractors,
  type TokenMeterContext,
} from "../integrations/next/index.js";
import { getAttribute } from "../context.js";

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

// Helper to create mock Request
function createMockRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers,
  });
}

describe("Next.js Integration", () => {
  describe("withTokenmeter", () => {
    it("should wrap handler and return response", async () => {
      const handler = withTokenmeter(async (req) => {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      });

      const response = await handler(createMockRequest());

      expect(response).toBeInstanceOf(Response);
      const body = await response.json();
      expect(body.ok).toBe(true);
    });

    it("should extract context from headers by default", async () => {
      let capturedUserId: string | undefined;
      let capturedOrgId: string | undefined;

      const handler = withTokenmeter(async (req) => {
        capturedUserId = getAttribute("user.id");
        capturedOrgId = getAttribute("org.id");
        return new Response("ok");
      });

      await handler(
        createMockRequest({
          "x-user-id": "user_123",
          "x-org-id": "org_456",
        }),
      );

      expect(capturedUserId).toBe("user_123");
      expect(capturedOrgId).toBe("org_456");
    });

    it("should generate workflow ID from x-request-id", async () => {
      let capturedWorkflowId: string | undefined;

      const handler = withTokenmeter(async (req) => {
        capturedWorkflowId = getAttribute("workflow.id");
        return new Response("ok");
      });

      await handler(
        createMockRequest({
          "x-request-id": "req_abc123",
        }),
      );

      expect(capturedWorkflowId).toBe("req_abc123");
    });

    it("should generate random workflow ID if no request ID", async () => {
      let capturedWorkflowId: string | undefined;

      const handler = withTokenmeter(async (req) => {
        capturedWorkflowId = getAttribute("workflow.id");
        return new Response("ok");
      });

      await handler(createMockRequest());

      expect(capturedWorkflowId).toBeDefined();
      expect(capturedWorkflowId?.length).toBeGreaterThan(0);
    });

    it("should use custom context extractor", async () => {
      let capturedUserId: string | undefined;

      const handler = withTokenmeter(
        async (req) => {
          capturedUserId = getAttribute("user.id");
          return new Response("ok");
        },
        {
          getContext: async (req) => ({
            userId: "custom_user",
            orgId: "custom_org",
          }),
        },
      );

      await handler(createMockRequest());

      expect(capturedUserId).toBe("custom_user");
    });

    it("should use custom header names", async () => {
      let capturedUserId: string | undefined;

      const handler = withTokenmeter(
        async (req) => {
          capturedUserId = getAttribute("user.id");
          return new Response("ok");
        },
        {
          userIdHeader: "x-custom-user",
        },
      );

      await handler(
        createMockRequest({
          "x-custom-user": "custom_123",
        }),
      );

      expect(capturedUserId).toBe("custom_123");
    });

    it("should pass route context to handler", async () => {
      let receivedParams: Record<string, string> | undefined;

      const handler = withTokenmeter(async (req, ctx) => {
        receivedParams = await ctx?.params;
        return new Response("ok");
      });

      await handler(createMockRequest(), {
        params: Promise.resolve({ id: "123" }),
      });

      expect(receivedParams).toEqual({ id: "123" });
    });

    it("should include metadata in context", async () => {
      let capturedMeta: string | undefined;

      const handler = withTokenmeter(
        async (req) => {
          capturedMeta = getAttribute("custom.meta");
          return new Response("ok");
        },
        {
          getContext: async (req) => ({
            metadata: { "custom.meta": "value123" },
          }),
        },
      );

      await handler(createMockRequest());

      expect(capturedMeta).toBe("value123");
    });
  });

  describe("createTokenmeterWrapper", () => {
    it("should create reusable wrapper with preset options", async () => {
      const withCostTracking = createTokenmeterWrapper({
        getContext: async (req) => ({
          userId: "preset_user",
          orgId: "preset_org",
        }),
      });

      let capturedUserId: string | undefined;

      const handler = withCostTracking(async (req) => {
        capturedUserId = getAttribute("user.id");
        return new Response("ok");
      });

      await handler(createMockRequest());

      expect(capturedUserId).toBe("preset_user");
    });

    it("should allow overriding options per handler", async () => {
      const withCostTracking = createTokenmeterWrapper({
        getContext: async (req) => ({
          userId: "default_user",
        }),
      });

      let capturedUserId: string | undefined;

      const handler = withCostTracking(
        async (req) => {
          capturedUserId = getAttribute("user.id");
          return new Response("ok");
        },
        {
          getContext: async (req) => ({
            userId: "override_user",
          }),
        },
      );

      await handler(createMockRequest());

      expect(capturedUserId).toBe("override_user");
    });
  });

  describe("headerExtractors", () => {
    it("should extract user ID from x-user-id header", () => {
      const req = createMockRequest({ "x-user-id": "user_abc" });
      expect(headerExtractors.userId(req)).toBe("user_abc");
    });

    it("should return undefined for missing user ID", () => {
      const req = createMockRequest();
      expect(headerExtractors.userId(req)).toBeUndefined();
    });

    it("should extract org ID from x-org-id header", () => {
      const req = createMockRequest({ "x-org-id": "org_xyz" });
      expect(headerExtractors.orgId(req)).toBe("org_xyz");
    });

    it("should extract API key from Bearer token", () => {
      const req = createMockRequest({ authorization: "Bearer sk_test_123" });
      expect(headerExtractors.apiKey(req)).toBe("sk_test_123");
    });

    it("should return undefined for non-Bearer auth", () => {
      const req = createMockRequest({ authorization: "Basic abc123" });
      expect(headerExtractors.apiKey(req)).toBeUndefined();
    });

    it("should extract request ID from x-request-id header", () => {
      const req = createMockRequest({ "x-request-id": "req_123" });
      expect(headerExtractors.requestId(req)).toBe("req_123");
    });
  });
});
