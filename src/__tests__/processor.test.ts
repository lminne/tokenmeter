/**
 * Tests for TokenMeterProcessor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenMeterProcessor } from "../processor/TokenMeterProcessor.js";
import { TM_ATTRIBUTES, GEN_AI_ATTRIBUTES } from "../types.js";
import { configureLogger, resetLogger } from "../logger.js";
import type { ReadableSpan, Span } from "@opentelemetry/sdk-trace-base";
import type { Context, HrTime, SpanContext, SpanKind, SpanStatus, Link, Attributes } from "@opentelemetry/api";

// Mock ReadableSpan factory
function createMockSpan(attributes: Attributes = {}): ReadableSpan {
  return {
    name: "test-span",
    kind: 1 as SpanKind,
    spanContext: () => ({
      traceId: "abc123",
      spanId: "def456",
      traceFlags: 1,
    } as SpanContext),
    startTime: [0, 0] as HrTime,
    endTime: [1, 0] as HrTime,
    ended: true,
    status: { code: 0 } as SpanStatus,
    attributes,
    links: [] as Link[],
    events: [],
    duration: [1, 0] as HrTime,
    resource: {
      attributes: {},
      merge: () => ({} as any),
    },
    instrumentationLibrary: {
      name: "test",
      version: "1.0.0",
    },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

describe("TokenMeterProcessor", () => {
  let debugSpy: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    debugSpy = vi.fn();
    warnSpy = vi.fn();

    // Configure custom logger that captures calls
    configureLogger({
      level: "debug",
      custom: (level: string, message: string, ...args: unknown[]) => {
        if (level === "debug") {
          debugSpy(message, ...args);
        } else if (level === "warn") {
          warnSpy(message, ...args);
        }
      },
    });
  });

  afterEach(() => {
    resetLogger();
  });

  describe("Constructor", () => {
    it("should create processor with default config", () => {
      const processor = new TokenMeterProcessor();
      expect(processor).toBeInstanceOf(TokenMeterProcessor);
    });

    it("should accept custom config", () => {
      const processor = new TokenMeterProcessor({
        manifestUrl: "https://custom.url/manifest.json",
        pricingOverrides: {
          openai: {
            "gpt-4o-custom": {
              input: 1.0,
              output: 2.0,
              unit: "1m_tokens",
            },
          },
        },
      });
      expect(processor).toBeInstanceOf(TokenMeterProcessor);
    });
  });

  describe("onStart", () => {
    it("should be a no-op", () => {
      const processor = new TokenMeterProcessor();
      const mockSpan = {} as Span;
      const mockContext = {} as Context;

      // Should not throw
      expect(() => processor.onStart(mockSpan, mockContext)).not.toThrow();
    });
  });

  describe("onEnd", () => {
    it("should skip spans without usage data", () => {
      const processor = new TokenMeterProcessor();
      const span = createMockSpan({
        "http.method": "GET",
        "http.url": "https://example.com",
      });

      // Should not throw or log
      processor.onEnd(span);
      expect(debugSpy).not.toHaveBeenCalled();
    });

    it("should process spans with tokenmeter attributes", () => {
      const processor = new TokenMeterProcessor({
        pricingOverrides: {
          openai: {
            "gpt-4o": {
              input: 2.5,
              output: 10.0,
              unit: "1m_tokens",
            },
          },
        },
      });

      const span = createMockSpan({
        [TM_ATTRIBUTES.PROVIDER]: "openai",
        [TM_ATTRIBUTES.MODEL]: "gpt-4o",
        [TM_ATTRIBUTES.INPUT_UNITS]: 1000,
        [TM_ATTRIBUTES.OUTPUT_UNITS]: 500,
      });

      processor.onEnd(span);

      expect(debugSpy).toHaveBeenCalled();
      const logCall = debugSpy.mock.calls[0][0] as string;
      expect(logCall).toContain("openai/gpt-4o");
    });

    it("should process spans with gen_ai attributes", () => {
      const processor = new TokenMeterProcessor({
        pricingOverrides: {
          anthropic: {
            "claude-sonnet-4-20250514": {
              input: 3.0,
              output: 15.0,
              unit: "1m_tokens",
            },
          },
        },
      });

      const span = createMockSpan({
        [GEN_AI_ATTRIBUTES.SYSTEM]: "anthropic",
        [GEN_AI_ATTRIBUTES.MODEL]: "claude-sonnet-4-20250514",
        [GEN_AI_ATTRIBUTES.INPUT_TOKENS]: 2000,
        [GEN_AI_ATTRIBUTES.OUTPUT_TOKENS]: 1000,
      });

      processor.onEnd(span);

      expect(debugSpy).toHaveBeenCalled();
    });

    it("should use pricing overrides", () => {
      const processor = new TokenMeterProcessor({
        pricingOverrides: {
          custom: {
            "my-model": {
              input: 100.0, // Very expensive
              output: 200.0,
              unit: "1m_tokens",
            },
          },
        },
      });

      const span = createMockSpan({
        [TM_ATTRIBUTES.PROVIDER]: "custom",
        [TM_ATTRIBUTES.MODEL]: "my-model",
        [TM_ATTRIBUTES.INPUT_UNITS]: 1000000, // 1M tokens
        [TM_ATTRIBUTES.OUTPUT_UNITS]: 500000, // 500k tokens
      });

      processor.onEnd(span);

      const logCall = debugSpy.mock.calls[0][0] as string;
      // (1M / 1M) * 100 + (500k / 1M) * 200 = 100 + 100 = $200
      expect(logCall).toContain("$200");
    });

    it("should warn when pricing not found", () => {
      const processor = new TokenMeterProcessor({
        pricingOverrides: {}, // No overrides
      });

      const span = createMockSpan({
        [TM_ATTRIBUTES.PROVIDER]: "unknown-provider",
        [TM_ATTRIBUTES.MODEL]: "unknown-model",
        [TM_ATTRIBUTES.INPUT_UNITS]: 1000,
      });

      processor.onEnd(span);

      // Should warn about no pricing
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe("shutdown", () => {
    it("should resolve without error", async () => {
      const processor = new TokenMeterProcessor();
      await expect(processor.shutdown()).resolves.toBeUndefined();
    });
  });

  describe("forceFlush", () => {
    it("should resolve without error", async () => {
      const processor = new TokenMeterProcessor();
      await expect(processor.forceFlush()).resolves.toBeUndefined();
    });
  });

  describe("Cost Calculation", () => {
    it("should calculate correct cost for input only", () => {
      const processor = new TokenMeterProcessor({
        pricingOverrides: {
          openai: {
            "text-embedding-3-small": {
              input: 0.02, // $0.02 per 1M tokens
              unit: "1m_tokens",
            },
          },
        },
      });

      const span = createMockSpan({
        [TM_ATTRIBUTES.PROVIDER]: "openai",
        [TM_ATTRIBUTES.MODEL]: "text-embedding-3-small",
        [TM_ATTRIBUTES.INPUT_UNITS]: 50000, // 50k tokens
      });

      processor.onEnd(span);

      const logCall = debugSpy.mock.calls[0][0] as string;
      // (50000 / 1000000) * 0.02 = 0.001
      expect(logCall).toContain("$0.001");
    });

    it("should calculate correct cost for output only", () => {
      const processor = new TokenMeterProcessor({
        pricingOverrides: {
          fal: {
            "flux-pro": {
              output: 0.04, // $0.04 per image
              unit: "request",
            },
          },
        },
      });

      const span = createMockSpan({
        [TM_ATTRIBUTES.PROVIDER]: "fal",
        [TM_ATTRIBUTES.MODEL]: "flux-pro",
        [TM_ATTRIBUTES.OUTPUT_UNITS]: 4, // 4 images
      });

      processor.onEnd(span);

      const logCall = debugSpy.mock.calls[0][0] as string;
      // 4 * 0.04 = 0.16
      expect(logCall).toContain("$0.16");
    });
  });
});
