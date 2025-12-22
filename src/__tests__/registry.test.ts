/**
 * Tests for the Provider Registry
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  TOKENMETER_PROVIDER,
  registerProvider,
  unregisterProvider,
  getProvider,
  getRegisteredProviders,
  clearProviderRegistry,
  detectProviderFromRegistry,
} from "../registry.js";
import { monitor } from "../instrumentation/proxy.js";

describe("Provider Registry", () => {
  beforeEach(() => {
    clearProviderRegistry();
  });

  afterEach(() => {
    clearProviderRegistry();
  });

  describe("registerProvider", () => {
    it("should register a provider with basic config", () => {
      registerProvider({
        name: "custom-ai",
        detect: (client) =>
          client !== null &&
          typeof client === "object" &&
          "customMethod" in client,
      });

      const provider = getProvider("custom-ai");
      expect(provider).toBeDefined();
      expect(provider?.name).toBe("custom-ai");
    });

    it("should throw if name is missing", () => {
      expect(() =>
        registerProvider({ name: "" } as any)
      ).toThrow("Provider name is required");
    });

    it("should create strategy from extractUsage function", () => {
      registerProvider({
        name: "test-provider",
        extractUsage: (response) => {
          const r = response as { tokens?: { input?: number; output?: number } };
          return {
            inputUnits: r.tokens?.input,
            outputUnits: r.tokens?.output,
          };
        },
        extractModel: (args) => {
          const a = args[0] as { model?: string } | undefined;
          return a?.model || "default-model";
        },
      });

      const provider = getProvider("test-provider");
      expect(provider?.strategy).toBeDefined();
      expect(provider?.strategy?.provider).toBe("test-provider");
    });
  });

  describe("unregisterProvider", () => {
    it("should remove a registered provider", () => {
      registerProvider({ name: "temp-provider" });
      expect(getProvider("temp-provider")).toBeDefined();

      const result = unregisterProvider("temp-provider");
      expect(result).toBe(true);
      expect(getProvider("temp-provider")).toBeUndefined();
    });

    it("should return false for non-existent provider", () => {
      const result = unregisterProvider("non-existent");
      expect(result).toBe(false);
    });
  });

  describe("getRegisteredProviders", () => {
    it("should return all registered providers", () => {
      registerProvider({ name: "provider-a" });
      registerProvider({ name: "provider-b" });
      registerProvider({ name: "provider-c" });

      const providers = getRegisteredProviders();
      expect(providers).toHaveLength(3);
      expect(providers.map((p) => p.name)).toContain("provider-a");
      expect(providers.map((p) => p.name)).toContain("provider-b");
      expect(providers.map((p) => p.name)).toContain("provider-c");
    });
  });

  describe("TOKENMETER_PROVIDER Symbol", () => {
    it("should detect provider from Symbol", () => {
      const client = {
        someMethod: () => {},
        [TOKENMETER_PROVIDER]: "my-custom-provider",
      };

      const detected = detectProviderFromRegistry(client);
      expect(detected).toBe("my-custom-provider");
    });

    it("should work with monitor()", () => {
      const client = {
        generate: async () => ({ text: "hello" }),
        [TOKENMETER_PROVIDER]: "symbol-provider",
      };

      // Should not throw - provider is detected from symbol
      const monitored = monitor(client);
      expect(monitored.generate).toBeDefined();
    });
  });

  describe("detectProviderFromRegistry", () => {
    it("should detect using registered detect function", () => {
      registerProvider({
        name: "detectable-ai",
        detect: (client) =>
          client !== null &&
          typeof client === "object" &&
          "uniqueMarker" in client,
      });

      const client = { uniqueMarker: true, call: () => {} };
      const detected = detectProviderFromRegistry(client);
      expect(detected).toBe("detectable-ai");
    });

    it("should return undefined for unknown clients", () => {
      const client = { unknownMethod: () => {} };
      const detected = detectProviderFromRegistry(client);
      expect(detected).toBeUndefined();
    });

    it("should prefer Symbol over detect function", () => {
      registerProvider({
        name: "detect-provider",
        detect: () => true, // Would match everything
      });

      const client = {
        [TOKENMETER_PROVIDER]: "symbol-wins",
      };

      const detected = detectProviderFromRegistry(client);
      expect(detected).toBe("symbol-wins");
    });
  });

  describe("factoryMethods", () => {
    it("should register factory methods", () => {
      registerProvider({
        name: "factory-provider",
        factoryMethods: ["createClient", "getModel"],
      });

      const provider = getProvider("factory-provider");
      expect(provider?.factoryMethods).toContain("createClient");
      expect(provider?.factoryMethods).toContain("getModel");
    });
  });

  describe("Integration with monitor()", () => {
    it("should use registered provider for detection", () => {
      registerProvider({
        name: "integrated-ai",
        detect: (client) =>
          client !== null &&
          typeof client === "object" &&
          "integratedCall" in client,
      });

      const client = {
        integratedCall: async () => ({ result: "test" }),
      };

      // Should detect as "integrated-ai"
      const monitored = monitor(client);
      expect(monitored.integratedCall).toBeDefined();
    });

    it("should use registered extraction strategy", async () => {
      registerProvider({
        name: "extractable-ai",
        detect: (client) =>
          client !== null &&
          typeof client === "object" &&
          "callWithUsage" in client,
        extractUsage: (response) => {
          const r = response as {
            meta?: { inputTokens?: number; outputTokens?: number };
          };
          if (!r.meta) return null;
          return {
            inputUnits: r.meta.inputTokens,
            outputUnits: r.meta.outputTokens,
          };
        },
        extractModel: () => "extractable-model",
      });

      const client = {
        callWithUsage: async () => ({
          text: "response",
          meta: {
            inputTokens: 100,
            outputTokens: 50,
          },
        }),
      };

      const monitored = monitor(client);
      const result = await monitored.callWithUsage();

      expect(result.meta.inputTokens).toBe(100);
      expect(result.meta.outputTokens).toBe(50);
    });
  });
});
