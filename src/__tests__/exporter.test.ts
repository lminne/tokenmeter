/**
 * Tests for PostgresExporter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TM_ATTRIBUTES } from "../types.js";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type {
  HrTime,
  SpanContext,
  SpanKind,
  SpanStatus,
  Attributes,
} from "@opentelemetry/api";

// Mock pg module before importing PostgresExporter
const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
const mockEnd = vi.fn().mockResolvedValue(undefined);

vi.mock("pg", () => {
  return {
    Pool: vi.fn().mockImplementation(() => ({
      query: mockQuery,
      end: mockEnd,
    })),
  };
});

import { PostgresExporter } from "../exporter/PostgresExporter.js";

// Mock ReadableSpan factory
function createMockSpan(attributes: Attributes = {}): ReadableSpan {
  return {
    name: "test-span",
    kind: 1 as SpanKind,
    spanContext: () =>
      ({
        traceId: "abc123def456",
        spanId: "span789",
        traceFlags: 1,
      }) as SpanContext,
    startTime: [1700000000, 0] as HrTime,
    endTime: [1700000001, 0] as HrTime,
    ended: true,
    status: { code: 0 } as SpanStatus,
    attributes,
    links: [],
    events: [],
    duration: [1, 0] as HrTime,
    resource: {
      attributes: {},
      merge: () => ({}) as any,
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

describe("PostgresExporter", () => {
  describe("Constructor", () => {
    it("should create exporter with required config", () => {
      const exporter = new PostgresExporter({
        connectionString: "postgresql://localhost/test",
      });
      expect(exporter).toBeInstanceOf(PostgresExporter);
    });

    it("should accept optional config", () => {
      const exporter = new PostgresExporter({
        connectionString: "postgresql://localhost/test",
        tableName: "custom_table",
        batchSize: 50,
        flushIntervalMs: 10000,
      });
      expect(exporter).toBeInstanceOf(PostgresExporter);
    });
  });

  describe("export", () => {
    let exporter: PostgresExporter;

    beforeEach(() => {
      exporter = new PostgresExporter({
        connectionString: "postgresql://localhost/test",
        batchSize: 10,
        flushIntervalMs: 60000, // Long interval so we control flushing
      });
    });

    afterEach(async () => {
      await exporter.shutdown();
    });

    it("should skip spans without cost data", () => {
      const span = createMockSpan({
        "http.method": "GET",
        "http.url": "https://example.com",
      });

      let callbackCalled = false;
      exporter.export([span], (result) => {
        callbackCalled = true;
        expect(result.code).toBe(0); // SUCCESS
      });

      expect(callbackCalled).toBe(true);
    });

    it("should accept spans with tokenmeter cost data", () => {
      const span = createMockSpan({
        [TM_ATTRIBUTES.PROVIDER]: "openai",
        [TM_ATTRIBUTES.MODEL]: "gpt-4o",
        [TM_ATTRIBUTES.COST_USD]: 0.05,
        [TM_ATTRIBUTES.INPUT_UNITS]: 1000,
        [TM_ATTRIBUTES.OUTPUT_UNITS]: 500,
        [TM_ATTRIBUTES.ORG_ID]: "org_123",
        [TM_ATTRIBUTES.USER_ID]: "user_456",
      });

      let callbackCalled = false;
      exporter.export([span], (result) => {
        callbackCalled = true;
        expect(result.code).toBe(0); // SUCCESS
      });

      expect(callbackCalled).toBe(true);
    });

    it("should filter out spans without required fields", () => {
      const validSpan = createMockSpan({
        [TM_ATTRIBUTES.PROVIDER]: "openai",
        [TM_ATTRIBUTES.MODEL]: "gpt-4o",
        [TM_ATTRIBUTES.COST_USD]: 0.05,
      });

      const invalidSpan = createMockSpan({
        [TM_ATTRIBUTES.PROVIDER]: "openai",
        // Missing model and cost
      });

      let callbackCalled = false;
      exporter.export([validSpan, invalidSpan], (result) => {
        callbackCalled = true;
        expect(result.code).toBe(0); // SUCCESS
      });

      expect(callbackCalled).toBe(true);
    });
  });

  describe("shutdown", () => {
    it("should shutdown cleanly", async () => {
      const exporter = new PostgresExporter({
        connectionString: "postgresql://localhost/test",
      });

      // Should not throw
      await expect(exporter.shutdown()).resolves.toBeUndefined();
    });

    it("should reject new exports after shutdown", async () => {
      const exporter = new PostgresExporter({
        connectionString: "postgresql://localhost/test",
      });

      await exporter.shutdown();

      const span = createMockSpan({
        [TM_ATTRIBUTES.PROVIDER]: "openai",
        [TM_ATTRIBUTES.MODEL]: "gpt-4o",
        [TM_ATTRIBUTES.COST_USD]: 0.05,
      });

      let callbackCalled = false;
      exporter.export([span], (result) => {
        callbackCalled = true;
        expect(result.code).toBe(1); // FAILED
      });

      expect(callbackCalled).toBe(true);
    });
  });

  describe("forceFlush", () => {
    it("should flush without error when buffer is empty", async () => {
      const exporter = new PostgresExporter({
        connectionString: "postgresql://localhost/test",
      });

      await expect(exporter.forceFlush()).resolves.toBeUndefined();
      await exporter.shutdown();
    });
  });

  describe("Data extraction", () => {
    let exporter: PostgresExporter;

    beforeEach(() => {
      exporter = new PostgresExporter({
        connectionString: "postgresql://localhost/test",
        batchSize: 100,
        flushIntervalMs: 60000,
      });
    });

    afterEach(async () => {
      await exporter.shutdown();
    });

    it("should extract all standard attributes", () => {
      const span = createMockSpan({
        [TM_ATTRIBUTES.PROVIDER]: "anthropic",
        [TM_ATTRIBUTES.MODEL]: "claude-sonnet-4-20250514",
        [TM_ATTRIBUTES.COST_USD]: 0.12,
        [TM_ATTRIBUTES.INPUT_UNITS]: 2000,
        [TM_ATTRIBUTES.OUTPUT_UNITS]: 1000,
        [TM_ATTRIBUTES.ORG_ID]: "org_abc",
        [TM_ATTRIBUTES.USER_ID]: "user_xyz",
        "custom.attribute": "custom_value",
      });

      // Export should succeed
      let success = false;
      exporter.export([span], (result) => {
        success = result.code === 0;
      });

      expect(success).toBe(true);
    });
  });

  describe("Attribute persistence", () => {
    /**
     * This test ensures all persisted TM_ATTRIBUTES are properly mapped.
     * It verifies the SQL INSERT includes values for org.id, user.id, and workflow.id.
     *
     * If you add a new attribute to TM_ATTRIBUTES that should be persisted,
     * add it to this test to ensure it's properly mapped in PostgresExporter.
     */
    it("should persist all identity attributes (org.id, user.id, workflow.id)", async () => {
      mockQuery.mockClear();

      const exporter = new PostgresExporter({
        connectionString: "postgresql://localhost/test",
        batchSize: 1, // Flush immediately
        flushIntervalMs: 60000,
      });

      const span = createMockSpan({
        [TM_ATTRIBUTES.PROVIDER]: "openai",
        [TM_ATTRIBUTES.MODEL]: "gpt-4o",
        [TM_ATTRIBUTES.COST_USD]: 0.05,
        [TM_ATTRIBUTES.ORG_ID]: "org_test",
        [TM_ATTRIBUTES.USER_ID]: "user_test",
        [TM_ATTRIBUTES.WORKFLOW_ID]: "workflow_test",
      });

      await new Promise<void>((resolve) => {
        exporter.export([span], () => resolve());
      });

      // Wait for flush
      await exporter.forceFlush();

      // Verify the query was called with all identity attributes
      expect(mockQuery).toHaveBeenCalled();
      const [query, values] = mockQuery.mock.calls[0];

      // Verify columns are present in INSERT statement
      expect(query).toContain("organization_id");
      expect(query).toContain("user_id");
      expect(query).toContain("workflow_id");

      // Verify values are passed (not null)
      expect(values).toContain("org_test");
      expect(values).toContain("user_test");
      expect(values).toContain("workflow_test");

      await exporter.shutdown();
    });

    it("should include custom attributes in metadata but exclude standard TM_ATTRIBUTES", async () => {
      mockQuery.mockClear();

      const exporter = new PostgresExporter({
        connectionString: "postgresql://localhost/test",
        batchSize: 1,
        flushIntervalMs: 60000,
      });

      const span = createMockSpan({
        [TM_ATTRIBUTES.PROVIDER]: "openai",
        [TM_ATTRIBUTES.MODEL]: "gpt-4o",
        [TM_ATTRIBUTES.COST_USD]: 0.05,
        [TM_ATTRIBUTES.WORKFLOW_ID]: "should-not-be-in-metadata",
        "custom.tenant": "acme-corp",
        "custom.feature": "chat",
      });

      await new Promise<void>((resolve) => {
        exporter.export([span], () => resolve());
      });
      await exporter.forceFlush();

      expect(mockQuery).toHaveBeenCalled();
      const [, values] = mockQuery.mock.calls[0];

      // Find the metadata JSON value (it's stringified)
      const metadataValue = values.find(
        (v: unknown) => typeof v === "string" && v.includes("custom.tenant"),
      );
      expect(metadataValue).toBeDefined();

      const metadata = JSON.parse(metadataValue as string);
      expect(metadata["custom.tenant"]).toBe("acme-corp");
      expect(metadata["custom.feature"]).toBe("chat");

      // Standard attributes should NOT be in metadata
      expect(metadata[TM_ATTRIBUTES.WORKFLOW_ID]).toBeUndefined();
      expect(metadata[TM_ATTRIBUTES.ORG_ID]).toBeUndefined();

      await exporter.shutdown();
    });
  });
});
