/**
 * Tests for Query Client
 *
 * Tests edge cases, error handling, and SQL injection protection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the pg module
vi.mock("pg", () => {
  const mockPool = {
    query: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
  };

  return {
    Pool: vi.fn(() => mockPool),
  };
});

// Import after mocking
import { createQueryClient } from "../query/client.js";
import { Pool } from "pg";

describe("Query Client", () => {
  let mockPool: ReturnType<typeof Pool>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = new Pool({});
  });

  describe("createQueryClient", () => {
    it("should test connection on initialization", async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ "?column?": 1 }],
      });

      const client = await createQueryClient({
        connectionString: "postgresql://localhost/test",
      });

      expect(mockPool.query).toHaveBeenCalledWith("SELECT 1");

      await client.close();
    });

    it("should throw error on connection failure", async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Connection refused"),
      );

      await expect(
        createQueryClient({
          connectionString: "postgresql://localhost/test",
        }),
      ).rejects.toThrow("Failed to connect to database: Connection refused");
    });

    it("should validate table name", async () => {
      await expect(
        createQueryClient({
          connectionString: "postgresql://localhost/test",
          tableName: "'; DROP TABLE users; --",
        }),
      ).rejects.toThrow("Invalid table name");
    });

    it("should accept valid table names", async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{}],
      });

      const client = await createQueryClient({
        connectionString: "postgresql://localhost/test",
        tableName: "my_custom_table",
      });

      await client.close();
    });

    it("should reject table names that are too long", async () => {
      const longName = "a".repeat(64);

      await expect(
        createQueryClient({
          connectionString: "postgresql://localhost/test",
          tableName: longName,
        }),
      ).rejects.toThrow("Table name too long");
    });
  });

  describe("getCosts with groupBy", () => {
    it("should throw error for invalid groupBy field", async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{}],
      });

      const client = await createQueryClient({
        connectionString: "postgresql://localhost/test",
      });

      await expect(
        client.getCosts({
          groupBy: ["invalidField"],
        }),
      ).rejects.toThrow('Invalid groupBy field: "invalidField"');

      await client.close();
    });

    it("should accept valid groupBy fields", async () => {
      // Connection test
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{}],
      });

      const client = await createQueryClient({
        connectionString: "postgresql://localhost/test",
      });

      // Actual query
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ provider: "openai", cost: "0.01", count: 5 }],
      });

      const result = await client.getCosts({
        groupBy: ["provider"],
      });

      expect(result.groups).toBeDefined();
      await client.close();
    });

    it("should handle multiple valid groupBy fields", async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{}],
      });

      const client = await createQueryClient({
        connectionString: "postgresql://localhost/test",
      });

      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          { provider: "openai", model: "gpt-4", cost: "0.05", count: 10 },
        ],
      });

      const result = await client.getCosts({
        groupBy: ["provider", "model"],
      });

      expect(result.groups).toBeDefined();
      await client.close();
    });
  });

  describe("getCosts empty results", () => {
    it("should handle empty result set", async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{}],
      });

      const client = await createQueryClient({
        connectionString: "postgresql://localhost/test",
      });

      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ total_cost: "0", count: 0 }],
      });

      const result = await client.getCosts();

      expect(result.totalCost).toBe(0);
      expect(result.count).toBe(0);
      await client.close();
    });

    it("should handle empty grouped results", async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{}],
      });

      const client = await createQueryClient({
        connectionString: "postgresql://localhost/test",
      });

      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
      });

      const result = await client.getCosts({
        groupBy: ["model"],
      });

      expect(result.totalCost).toBe(0);
      expect(result.count).toBe(0);
      expect(result.groups).toEqual([]);
      await client.close();
    });
  });

  describe("getCostByUser", () => {
    it("should filter by user", async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{}],
      });

      const client = await createQueryClient({
        connectionString: "postgresql://localhost/test",
      });

      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ total_cost: "1.50", count: 3 }],
      });

      const result = await client.getCostByUser("user_123");

      // Verify the query includes user_id filter
      const queryCall = (mockPool.query as ReturnType<typeof vi.fn>).mock
        .calls[1];
      expect(queryCall[0]).toContain("user_id");
      expect(queryCall[1]).toContain("user_123");
      expect(result.totalCost).toBe(1.5);
      await client.close();
    });
  });

  describe("getWorkflowCost", () => {
    it("should query by trace_id", async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{}],
      });

      const client = await createQueryClient({
        connectionString: "postgresql://localhost/test",
      });

      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ total_cost: "2.50", count: 5 }],
      });

      const result = await client.getWorkflowCost("workflow_abc");

      const queryCall = (mockPool.query as ReturnType<typeof vi.fn>).mock
        .calls[1];
      expect(queryCall[0]).toContain("trace_id");
      expect(queryCall[1]).toEqual(["workflow_abc"]);
      expect(result.totalCost).toBe(2.5);
      await client.close();
    });
  });

  describe("close", () => {
    it("should close the pool", async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{}],
      });

      const client = await createQueryClient({
        connectionString: "postgresql://localhost/test",
      });

      await client.close();

      expect(mockPool.end).toHaveBeenCalled();
    });
  });
});
