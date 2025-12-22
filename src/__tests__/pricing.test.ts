/**
 * Tests for the pricing manifest system
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  calculateCost,
  getModelPricing,
  clearManifestCache,
  getCachedManifest,
  configurePricing,
  setModelAliases,
  clearModelAliases,
} from "../pricing/manifest.js";
import type { PricingManifest, ModelPricing } from "../types.js";

describe("Pricing Manifest", () => {
  beforeEach(() => {
    clearManifestCache();
    clearModelAliases();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearModelAliases();
  });

  describe("Bundled Manifest Availability", () => {
    it("should always have a manifest available (never null)", () => {
      // After clearing cache, bundled manifest should still be available
      clearManifestCache();
      const manifest = getCachedManifest();

      expect(manifest).not.toBeNull();
      expect(manifest.version).toBeDefined();
      expect(manifest.providers).toBeDefined();
    });

    it("should have pricing data for major providers in bundled manifest", () => {
      const manifest = getCachedManifest();

      // Should have major providers
      expect(manifest.providers.openai).toBeDefined();
      expect(manifest.providers.anthropic).toBeDefined();
      expect(manifest.providers.google).toBeDefined();

      // Should have common models
      expect(manifest.providers.openai["gpt-4o"]).toBeDefined();
      expect(manifest.providers.anthropic["claude-sonnet-4-20250514"]).toBeDefined();
    });

    it("should be able to calculate costs immediately without network", () => {
      clearManifestCache();

      const manifest = getCachedManifest();
      const pricing = getModelPricing("openai", "gpt-4o", manifest);

      expect(pricing).not.toBeNull();

      // Calculate cost synchronously (no await needed)
      const cost = calculateCost(
        { inputUnits: 1000, outputUnits: 500 },
        pricing!,
      );

      expect(cost).toBeGreaterThan(0);
    });
  });

  describe("calculateCost", () => {
    it("should calculate cost for token-based pricing (1m_tokens)", () => {
      const pricing: ModelPricing = {
        input: 2.5, // $2.50 per million input tokens
        output: 10.0, // $10.00 per million output tokens
        unit: "1m_tokens",
      };

      const cost = calculateCost(
        {
          inputUnits: 1000, // 1000 input tokens
          outputUnits: 500, // 500 output tokens
        },
        pricing,
      );

      // (1000 / 1_000_000) * 2.5 + (500 / 1_000_000) * 10.0
      // = 0.0025 + 0.005 = 0.0075
      expect(cost).toBeCloseTo(0.0075, 6);
    });

    it("should calculate cost for character-based pricing (1k_characters)", () => {
      const pricing: ModelPricing = {
        input: 0.3, // $0.30 per 1k characters
        unit: "1k_characters",
      };

      const cost = calculateCost(
        {
          inputUnits: 5000, // 5000 characters
        },
        pricing,
      );

      // (5000 / 1000) * 0.30 = 1.50
      expect(cost).toBeCloseTo(1.5, 6);
    });

    it("should calculate cost for flat request-based pricing", () => {
      const pricing: ModelPricing = {
        cost: 0.04, // $0.04 per request
        unit: "request",
      };

      const cost = calculateCost({}, pricing);

      expect(cost).toBeCloseTo(0.04, 6);
    });

    it("should include cached input cost when available", () => {
      const pricing: ModelPricing = {
        input: 3.0, // $3.00 per million input tokens
        output: 15.0, // $15.00 per million output tokens
        cachedInput: 0.3, // $0.30 per million cached tokens (90% discount)
        unit: "1m_tokens",
      };

      const cost = calculateCost(
        {
          inputUnits: 1000,
          outputUnits: 500,
          cachedInputUnits: 5000, // 5000 cached tokens
        },
        pricing,
      );

      // (1000 / 1_000_000) * 3.0 + (500 / 1_000_000) * 15.0 + (5000 / 1_000_000) * 0.3
      // = 0.003 + 0.0075 + 0.0015 = 0.012
      expect(cost).toBeCloseTo(0.012, 6);
    });

    it("should handle zero usage gracefully", () => {
      const pricing: ModelPricing = {
        input: 2.5,
        output: 10.0,
        unit: "1m_tokens",
      };

      const cost = calculateCost({}, pricing);
      expect(cost).toBe(0);
    });

    it("should handle missing pricing fields", () => {
      const pricing: ModelPricing = {
        input: 2.5, // Only input pricing
        unit: "1m_tokens",
      };

      const cost = calculateCost(
        {
          inputUnits: 1000,
          outputUnits: 500, // Output provided but no pricing
        },
        pricing,
      );

      // Only input should be calculated
      expect(cost).toBeCloseTo(0.0025, 6);
    });

    it("should handle negative input values by treating them as zero", () => {
      const pricing: ModelPricing = {
        input: 2.5,
        output: 10.0,
        unit: "1m_tokens",
      };

      const cost = calculateCost(
        {
          inputUnits: -1000, // Negative should be treated as 0
          outputUnits: 500,
        },
        pricing,
      );

      // Only output should be calculated
      expect(cost).toBeCloseTo(0.005, 6);
    });

    it("should handle NaN values by treating them as zero", () => {
      const pricing: ModelPricing = {
        input: 2.5,
        output: 10.0,
        unit: "1m_tokens",
      };

      const cost = calculateCost(
        {
          inputUnits: NaN,
          outputUnits: 500,
        },
        pricing,
      );

      expect(cost).toBeCloseTo(0.005, 6);
    });

    it("should handle Infinity values by treating them as zero", () => {
      const pricing: ModelPricing = {
        input: 2.5,
        output: 10.0,
        unit: "1m_tokens",
      };

      const cost = calculateCost(
        {
          inputUnits: Infinity,
          outputUnits: 500,
        },
        pricing,
      );

      expect(cost).toBeCloseTo(0.005, 6);
    });

    it("should handle undefined values gracefully", () => {
      const pricing: ModelPricing = {
        input: 2.5,
        output: 10.0,
        unit: "1m_tokens",
      };

      const cost = calculateCost(
        {
          inputUnits: undefined,
          outputUnits: undefined,
        },
        pricing,
      );

      expect(cost).toBe(0);
    });

    it("should never return negative cost", () => {
      const pricing: ModelPricing = {
        input: -2.5, // Invalid negative pricing
        output: 10.0,
        unit: "1m_tokens",
      };

      const cost = calculateCost(
        {
          inputUnits: 1000,
          outputUnits: 500,
        },
        pricing,
      );

      // Negative pricing should be ignored, only output calculated
      expect(cost).toBeGreaterThanOrEqual(0);
    });
  });

  describe("getModelPricing", () => {
    const testManifest: PricingManifest = {
      version: "1.0.0",
      updatedAt: "2024-01-01T00:00:00Z",
      providers: {
        openai: {
          "gpt-4o": {
            input: 2.5,
            output: 10.0,
            unit: "1m_tokens",
          },
          "gpt-4o-mini": {
            input: 0.15,
            output: 0.6,
            unit: "1m_tokens",
          },
        },
        anthropic: {
          "claude-sonnet-4-20250514": {
            input: 3.0,
            output: 15.0,
            cachedInput: 0.3,
            unit: "1m_tokens",
          },
        },
      },
    };

    it("should find exact model match", () => {
      const pricing = getModelPricing("openai", "gpt-4o", testManifest);

      expect(pricing).not.toBeNull();
      expect(pricing?.input).toBe(2.5);
      expect(pricing?.output).toBe(10.0);
    });

    it("should return null for unknown provider", () => {
      const pricing = getModelPricing("unknown", "gpt-4o", testManifest);
      expect(pricing).toBeNull();
    });

    it("should return null for unknown model", () => {
      const pricing = getModelPricing("openai", "unknown-model", testManifest);
      expect(pricing).toBeNull();
    });

    it("should strip date suffix for model lookup", () => {
      // Add a model without date suffix
      const manifest: PricingManifest = {
        ...testManifest,
        providers: {
          openai: {
            "gpt-4o": {
              input: 2.5,
              output: 10.0,
              unit: "1m_tokens",
            },
          },
        },
      };

      // Request with date suffix should find base model
      const pricing = getModelPricing("openai", "gpt-4o-2024-05-13", manifest);

      expect(pricing).not.toBeNull();
      expect(pricing?.input).toBe(2.5);
    });

    it("should handle provider prefix in model name", () => {
      const manifest: PricingManifest = {
        ...testManifest,
        providers: {
          fal: {
            "fast-sdxl": {
              cost: 0.04,
              unit: "request",
            },
          },
        },
      };

      // Request with provider prefix
      const pricing = getModelPricing("fal", "fal/fast-sdxl", manifest);

      expect(pricing).not.toBeNull();
      expect(pricing?.cost).toBe(0.04);
    });

    it("should support provider-specific model aliases", () => {
      const manifest: PricingManifest = {
        version: "1.0.0",
        updatedAt: "2024-01-01T00:00:00Z",
        providers: {
          openai: {
            "gpt-4o-realtime": {
              input: 5.0,
              output: 20.0,
              unit: "1m_tokens",
            },
          },
          azure: {
            "gpt-4o-azure": {
              input: 4.0,
              output: 16.0,
              unit: "1m_tokens",
            },
          },
        },
      };

      // Set provider-specific aliases
      setModelAliases({
        "openai:my-model": { provider: "openai", model: "gpt-4o-realtime" },
        "azure:my-model": { provider: "azure", model: "gpt-4o-azure" },
      });

      // Same alias name, different providers
      const openaiPricing = getModelPricing("openai", "my-model", manifest);
      const azurePricing = getModelPricing("azure", "my-model", manifest);

      expect(openaiPricing?.input).toBe(5.0);
      expect(azurePricing?.input).toBe(4.0);
    });
  });

  describe("calculateCost - image pricing", () => {
    it("should multiply flat cost by number of images", () => {
      const pricing: ModelPricing = {
        cost: 0.04, // $0.04 per image
        unit: "image",
      };

      const cost = calculateCost(
        {
          outputUnits: 3, // 3 images generated
        },
        pricing,
      );

      // 0.04 * 3 = 0.12
      expect(cost).toBeCloseTo(0.12, 6);
    });

    it("should default to 1 image if outputUnits not specified", () => {
      const pricing: ModelPricing = {
        cost: 0.04,
        unit: "image",
      };

      const cost = calculateCost({}, pricing);

      expect(cost).toBeCloseTo(0.04, 6);
    });
  });

  describe("configurePricing validation", () => {
    it("should reject invalid URLs", () => {
      expect(() =>
        configurePricing({ apiUrl: "http://malicious.com/api" }),
      ).toThrow("Invalid apiUrl");
    });

    it("should reject non-HTTPS URLs", () => {
      expect(() =>
        configurePricing({ cdnUrl: "http://cdn.jsdelivr.net/manifest.json" }),
      ).toThrow("Invalid cdnUrl");
    });

    it("should accept valid HTTPS URLs from allowed domains", () => {
      expect(() =>
        configurePricing({
          apiUrl: "https://pricing.tokenmeter.dev/api/v2",
        }),
      ).not.toThrow();
    });

    it("should reject invalid timeout values", () => {
      expect(() => configurePricing({ fetchTimeout: -1000 })).toThrow(
        "Invalid fetchTimeout",
      );

      expect(() => configurePricing({ fetchTimeout: 200000 })).toThrow(
        "Invalid fetchTimeout",
      );
    });

    it("should reject invalid model aliases", () => {
      expect(() =>
        configurePricing({
          modelAliases: {
            "bad-alias": { provider: "", model: "gpt-4" },
          },
        }),
      ).toThrow("missing or invalid provider");

      expect(() =>
        configurePricing({
          modelAliases: {
            "bad-alias": { provider: "openai", model: "" },
          },
        }),
      ).toThrow("missing or invalid model");
    });

    it("should accept valid configuration", () => {
      expect(() =>
        configurePricing({
          offlineMode: true,
          fetchTimeout: 3000,
          modelAliases: {
            "my-model": { provider: "openai", model: "gpt-4o" },
          },
        }),
      ).not.toThrow();
    });
  });
});
