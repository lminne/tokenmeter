/**
 * Tests for extraction strategies
 */

import { describe, it, expect } from "vitest";
import {
  openaiStrategy,
  anthropicStrategy,
  falStrategy,
  elevenlabsStrategy,
  vercelAIStrategy,
  findStrategy,
  extractUsage,
} from "../instrumentation/strategies/index.js";

describe("Extraction Strategies", () => {
  describe("OpenAI Strategy", () => {
    const openaiResponse = {
      id: "chatcmpl-abc123",
      model: "gpt-4o-2024-05-13",
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      },
      choices: [{ message: { content: "Hello!" } }],
    };

    it("should detect OpenAI responses", () => {
      expect(
        openaiStrategy.canHandle(["chat", "completions", "create"], openaiResponse),
      ).toBe(true);
    });

    it("should not detect non-OpenAI responses", () => {
      expect(openaiStrategy.canHandle([], {})).toBe(false);
      expect(openaiStrategy.canHandle([], null)).toBe(false);
      expect(openaiStrategy.canHandle([], { data: "something" })).toBe(false);
    });

    it("should extract usage data correctly", () => {
      const usage = openaiStrategy.extract(
        ["chat", "completions", "create"],
        openaiResponse,
        [{ model: "gpt-4o" }],
      );

      expect(usage).not.toBeNull();
      expect(usage?.provider).toBe("openai");
      expect(usage?.model).toBe("gpt-4o-2024-05-13");
      expect(usage?.inputUnits).toBe(100);
      expect(usage?.outputUnits).toBe(50);
    });

    it("should use model from args if not in response", () => {
      const responseWithoutModel = {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
        },
      };

      const usage = openaiStrategy.extract(
        ["chat", "completions", "create"],
        responseWithoutModel,
        [{ model: "gpt-4o-mini" }],
      );

      expect(usage?.model).toBe("gpt-4o-mini");
    });

    it("should handle cached tokens", () => {
      const responseWithCache = {
        model: "gpt-4o",
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          cached_tokens: 80,
        },
      };

      const usage = openaiStrategy.extract([], responseWithCache, []);
      expect(usage?.cachedInputUnits).toBe(80);
    });
  });

  describe("Anthropic Strategy", () => {
    const anthropicResponse = {
      id: "msg_abc123",
      model: "claude-sonnet-4-20250514",
      usage: {
        input_tokens: 200,
        output_tokens: 100,
      },
      content: [{ type: "text", text: "Hello!" }],
    };

    it("should detect Anthropic responses", () => {
      expect(
        anthropicStrategy.canHandle(["messages", "create"], anthropicResponse),
      ).toBe(true);
    });

    it("should not detect OpenAI responses", () => {
      const openaiResponse = {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
        },
      };
      // OpenAI uses prompt_tokens, not input_tokens
      expect(anthropicStrategy.canHandle([], openaiResponse)).toBe(false);
    });

    it("should extract usage data correctly", () => {
      const usage = anthropicStrategy.extract(
        ["messages", "create"],
        anthropicResponse,
        [],
      );

      expect(usage).not.toBeNull();
      expect(usage?.provider).toBe("anthropic");
      expect(usage?.model).toBe("claude-sonnet-4-20250514");
      expect(usage?.inputUnits).toBe(200);
      expect(usage?.outputUnits).toBe(100);
    });

    it("should handle cache read tokens", () => {
      const responseWithCache = {
        model: "claude-sonnet-4-20250514",
        usage: {
          input_tokens: 200,
          output_tokens: 100,
          cache_read_input_tokens: 150,
          cache_creation_input_tokens: 50,
        },
      };

      const usage = anthropicStrategy.extract([], responseWithCache, []);
      expect(usage?.cachedInputUnits).toBe(150);
      expect(usage?.metadata?.cacheCreationTokens).toBe(50);
    });
  });

  describe("fal.ai Strategy", () => {
    const falResponse = {
      requestId: "req_abc123",
      data: {
        images: [
          { url: "https://...", width: 1024, height: 1024 },
          { url: "https://...", width: 1024, height: 1024 },
        ],
      },
    };

    it("should detect fal.ai responses", () => {
      expect(falStrategy.canHandle(["subscribe"], falResponse)).toBe(true);
    });

    it("should detect responses with request_id", () => {
      expect(
        falStrategy.canHandle([], { request_id: "abc123" }),
      ).toBe(true);
    });

    it("should extract usage data correctly", () => {
      const usage = falStrategy.extract(
        ["subscribe"],
        falResponse,
        ["fal-ai/flux-pro"],
      );

      expect(usage).not.toBeNull();
      expect(usage?.provider).toBe("fal");
      expect(usage?.model).toBe("flux-pro");
      expect(usage?.outputUnits).toBe(2); // 2 images
    });

    it("should handle single image response", () => {
      const singleImageResponse = {
        requestId: "req_abc123",
        data: {
          image: { url: "https://..." },
        },
      };

      const usage = falStrategy.extract(
        [],
        singleImageResponse,
        ["fast-sdxl"],
      );

      expect(usage?.outputUnits).toBe(1);
    });
  });

  describe("ElevenLabs Strategy", () => {
    it("should detect textToSpeech methods", () => {
      expect(
        elevenlabsStrategy.canHandle(
          ["textToSpeech", "convert"],
          Buffer.from([]),
        ),
      ).toBe(true);
    });

    it("should detect generate methods", () => {
      expect(
        elevenlabsStrategy.canHandle(["generate"], Buffer.from([])),
      ).toBe(true);
    });

    it("should extract character count from text", () => {
      const usage = elevenlabsStrategy.extract(
        ["textToSpeech", "convert"],
        Buffer.from([]), // Audio buffer result
        ["voice_id", { text: "Hello, world!", modelId: "eleven_turbo_v2_5" }],
      );

      expect(usage).not.toBeNull();
      expect(usage?.provider).toBe("elevenlabs");
      expect(usage?.model).toBe("eleven_turbo_v2_5");
      expect(usage?.inputUnits).toBe(13); // "Hello, world!" length
    });

    it("should use default model if not specified", () => {
      const usage = elevenlabsStrategy.extract(
        ["textToSpeech", "convert"],
        Buffer.from([]),
        ["voice_id", { text: "Hi" }],
      );

      expect(usage?.model).toBe("eleven_multilingual_v2");
    });
  });

  describe("Vercel AI SDK Strategy", () => {
    const vercelAIResponse = {
      text: "Hello!",
      usage: {
        promptTokens: 150,
        completionTokens: 75,
      },
      response: {
        modelId: "gpt-4o",
      },
    };

    it("should detect Vercel AI responses", () => {
      expect(
        vercelAIStrategy.canHandle(["generateText"], vercelAIResponse),
      ).toBe(true);
    });

    it("should not detect OpenAI responses", () => {
      const openaiResponse = {
        usage: {
          prompt_tokens: 100, // snake_case
        },
      };
      expect(vercelAIStrategy.canHandle([], openaiResponse)).toBe(false);
    });

    it("should extract usage data correctly", () => {
      const usage = vercelAIStrategy.extract(
        ["generateText"],
        vercelAIResponse,
        [],
      );

      expect(usage).not.toBeNull();
      expect(usage?.provider).toBe("openai");
      expect(usage?.model).toBe("gpt-4o");
      expect(usage?.inputUnits).toBe(150);
      expect(usage?.outputUnits).toBe(75);
    });

    it("should infer provider from claude model", () => {
      const claudeResponse = {
        usage: {
          promptTokens: 100,
          completionTokens: 50,
        },
        response: {
          modelId: "claude-sonnet-4-20250514",
        },
      };

      const usage = vercelAIStrategy.extract([], claudeResponse, []);
      expect(usage?.provider).toBe("anthropic");
    });
  });

  describe("findStrategy", () => {
    it("should find OpenAI strategy for OpenAI responses", () => {
      const response = {
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      };

      const strategy = findStrategy([], response);
      expect(strategy?.provider).toBe("openai");
    });

    it("should find Anthropic strategy for Anthropic responses", () => {
      const response = {
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      const strategy = findStrategy([], response);
      expect(strategy?.provider).toBe("anthropic");
    });

    it("should return null for unknown responses", () => {
      const strategy = findStrategy([], { unknown: "data" });
      expect(strategy).toBeNull();
    });
  });

  describe("extractUsage", () => {
    it("should extract usage with provider hint", () => {
      const response = {
        usage: { prompt_tokens: 100, completion_tokens: 50 },
        model: "gpt-4o",
      };

      const usage = extractUsage([], response, [], "openai");
      expect(usage?.provider).toBe("openai");
    });

    it("should fall back to auto-detection if hint fails", () => {
      const response = {
        usage: { input_tokens: 100, output_tokens: 50 },
        model: "claude-sonnet-4-20250514",
      };

      // Wrong hint, but should still find Anthropic strategy
      const usage = extractUsage([], response, [], "openai");
      expect(usage?.provider).toBe("anthropic");
    });

    it("should return null for unrecognized responses", () => {
      const usage = extractUsage([], { foo: "bar" }, []);
      expect(usage).toBeNull();
    });
  });
});
