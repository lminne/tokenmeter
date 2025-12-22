/**
 * Tests for Query Client
 *
 * Note: These tests mock the pg module since we can't connect to a real database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pg module
vi.mock("pg", () => {
  const mockQuery = vi.fn();
  const mockEnd = vi.fn();

  return {
    Pool: vi.fn().mockImplementation(() => ({
      query: mockQuery,
      end: mockEnd,
    })),
    __mockQuery: mockQuery,
    __mockEnd: mockEnd,
  };
});

import { createQueryClient, type QueryClient } from "../query/client.js";

describe("Query Client", () => {
  let client: QueryClient;
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();

    // Get mock functions
    const pg = await import("pg");
    mockQuery = (pg as unknown as { __mockQuery: ReturnType<typeof vi.fn> })
      .__mockQuery;

    // Create client
    client = await createQueryClient({
      connectionString: "postgresql://localhost/test",
    });
  });

  describe("getCosts", () => {
    it("should return aggregated costs without grouping", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ total_cost: "123.456", count: 100 }],
      });

      const result = await client.getCosts();

      expect(result.totalCost).toBeCloseTo(123.456);
      expect(result.count).toBe(100);
      expect(result.groups).toBeUndefined();
    });

    it("should filter by date range", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ total_cost: "50.00", count: 25 }],
      });

      const result = await client.getCosts({
        from: "2024-01-01",
        to: "2024-01-31",
      });

      expect(result.totalCost).toBeCloseTo(50.0);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("WHERE"),
        expect.arrayContaining([expect.any(Date), expect.any(Date)]),
      );
    });

    it("should filter by provider", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ total_cost: "75.00", count: 50 }],
      });

      const result = await client.getCosts({
        provider: "openai",
      });

      expect(result.totalCost).toBeCloseTo(75.0);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("provider ="),
        expect.arrayContaining(["openai"]),
      );
    });

    it("should group by model", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { model: "gpt-4o", cost: "100.00", count: 50 },
          { model: "gpt-4o-mini", cost: "10.00", count: 100 },
        ],
      });

      const result = await client.getCosts({
        groupBy: ["model"],
      });

      expect(result.totalCost).toBeCloseTo(110.0);
      expect(result.count).toBe(150);
      expect(result.groups).toHaveLength(2);
      expect(result.groups?.[0].key.model).toBe("gpt-4o");
      expect(result.groups?.[0].cost).toBeCloseTo(100.0);
    });

    it("should group by multiple fields", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { provider: "openai", model: "gpt-4o", cost: "100.00", count: 50 },
          {
            provider: "anthropic",
            model: "claude-sonnet-4-20250514",
            cost: "80.00",
            count: 40,
          },
        ],
      });

      const result = await client.getCosts({
        groupBy: ["provider", "model"],
      });

      expect(result.totalCost).toBeCloseTo(180.0);
      expect(result.groups).toHaveLength(2);
      expect(result.groups?.[0].key.provider).toBe("openai");
      expect(result.groups?.[0].key.model).toBe("gpt-4o");
    });
  });

  describe("getCostByUser", () => {
    it("should filter by user ID", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ total_cost: "25.00", count: 10 }],
      });

      const result = await client.getCostByUser("user_123");

      expect(result.totalCost).toBeCloseTo(25.0);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("user_id ="),
        expect.arrayContaining(["user_123"]),
      );
    });

    it("should combine with other filters", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ total_cost: "15.00", count: 5 }],
      });

      const result = await client.getCostByUser("user_123", {
        provider: "openai",
        from: "2024-01-01",
      });

      expect(result.totalCost).toBeCloseTo(15.0);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("user_id ="),
        expect.arrayContaining(["user_123", "openai"]),
      );
    });
  });

  describe("getCostByOrg", () => {
    it("should filter by organization ID", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ total_cost: "500.00", count: 200 }],
      });

      const result = await client.getCostByOrg("org_abc");

      expect(result.totalCost).toBeCloseTo(500.0);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("organization_id ="),
        expect.arrayContaining(["org_abc"]),
      );
    });
  });

  describe("getCostByModel", () => {
    it("should filter by model", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ total_cost: "200.00", count: 80 }],
      });

      const result = await client.getCostByModel("gpt-4o");

      expect(result.totalCost).toBeCloseTo(200.0);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("model ="),
        expect.arrayContaining(["gpt-4o"]),
      );
    });
  });

  describe("getCostByProvider", () => {
    it("should filter by provider", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ total_cost: "300.00", count: 120 }],
      });

      const result = await client.getCostByProvider("anthropic");

      expect(result.totalCost).toBeCloseTo(300.0);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("provider ="),
        expect.arrayContaining(["anthropic"]),
      );
    });
  });

  describe("getWorkflowCost", () => {
    it("should query by trace ID", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ total_cost: "2.50", count: 5 }],
      });

      const result = await client.getWorkflowCost("trace_abc123");

      expect(result.totalCost).toBeCloseTo(2.5);
      expect(result.count).toBe(5);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("trace_id ="),
        ["trace_abc123"],
      );
    });
  });

  describe("close", () => {
    it("should close the connection pool", async () => {
      const pg = await import("pg");
      const mockEnd = (
        pg as unknown as { __mockEnd: ReturnType<typeof vi.fn> }
      ).__mockEnd;

      await client.close();

      expect(mockEnd).toHaveBeenCalled();
    });
  });
});
