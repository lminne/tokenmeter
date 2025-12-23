/**
 * Tests for extraction strategies
 */

import { describe, it, expect } from "vitest";
import {
  openaiStrategy,
  anthropicStrategy,
  bedrockStrategy,
  vertexAIStrategy,
  falStrategy,
  bflStrategy,
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
        openaiStrategy.canHandle(
          ["chat", "completions", "create"],
          openaiResponse,
        ),
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

  describe("AWS Bedrock Strategy", () => {
    const bedrockResponse = {
      modelId: "us.anthropic.claude-sonnet-4-20250514-v1:0",
      usage: {
        inputTokens: 250,
        outputTokens: 120,
      },
      $metadata: {
        httpStatusCode: 200,
        requestId: "abc-123-def",
      },
      output: {
        message: {
          content: [{ text: "Hello from Bedrock!" }],
        },
      },
    };

    it("should detect Bedrock responses", () => {
      expect(bedrockStrategy.canHandle(["invokeModel"], bedrockResponse)).toBe(
        true,
      );
    });

    it("should detect Bedrock responses with $metadata only", () => {
      const responseWithMetadataOnly = {
        usage: {
          inputTokens: 100,
          outputTokens: 50,
        },
        $metadata: {
          httpStatusCode: 200,
        },
      };
      expect(bedrockStrategy.canHandle([], responseWithMetadataOnly)).toBe(
        true,
      );
    });

    it("should not detect OpenAI responses (snake_case tokens)", () => {
      const openaiResponse = {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
        },
      };
      expect(bedrockStrategy.canHandle([], openaiResponse)).toBe(false);
    });

    it("should not detect Anthropic responses (no $metadata or modelId)", () => {
      const anthropicResponse = {
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
      };
      expect(bedrockStrategy.canHandle([], anthropicResponse)).toBe(false);
    });

    it("should extract usage data correctly", () => {
      const usage = bedrockStrategy.extract(
        ["invokeModel"],
        bedrockResponse,
        [],
      );

      expect(usage).not.toBeNull();
      expect(usage?.provider).toBe("bedrock");
      expect(usage?.inputUnits).toBe(250);
      expect(usage?.outputUnits).toBe(120);
    });

    it("should parse model ID and strip region prefix", () => {
      const usage = bedrockStrategy.extract([], bedrockResponse, []);
      // "us.anthropic.claude-sonnet-4-20250514-v1:0" -> "anthropic.claude-sonnet-4"
      expect(usage?.model).toBe("anthropic.claude-sonnet-4");
    });

    it("should parse EU region model IDs", () => {
      const euResponse = {
        modelId: "eu.anthropic.claude-3-5-sonnet-20241022-v2:0",
        usage: { inputTokens: 100, outputTokens: 50 },
        $metadata: {},
      };
      const usage = bedrockStrategy.extract([], euResponse, []);
      expect(usage?.model).toBe("anthropic.claude-3-5-sonnet");
    });

    it("should parse model IDs without region prefix", () => {
      const noRegionResponse = {
        modelId: "anthropic.claude-3-haiku-20240307-v1:0",
        usage: { inputTokens: 100, outputTokens: 50 },
        $metadata: {},
      };
      const usage = bedrockStrategy.extract([], noRegionResponse, []);
      expect(usage?.model).toBe("anthropic.claude-3-haiku");
    });

    it("should parse Amazon Titan model IDs", () => {
      const titanResponse = {
        modelId: "amazon.titan-text-express-v1",
        usage: { inputTokens: 100, outputTokens: 50 },
        $metadata: {},
      };
      const usage = bedrockStrategy.extract([], titanResponse, []);
      expect(usage?.model).toBe("amazon.titan-text-express-v1");
    });

    it("should parse Meta Llama model IDs", () => {
      const llamaResponse = {
        modelId: "us.meta.llama3-1-70b-instruct-v1:0",
        usage: { inputTokens: 100, outputTokens: 50 },
        $metadata: {},
      };
      const usage = bedrockStrategy.extract([], llamaResponse, []);
      expect(usage?.model).toBe("meta.llama3-1-70b-instruct");
    });

    it("should include original model ID in metadata", () => {
      const usage = bedrockStrategy.extract([], bedrockResponse, []);
      expect(usage?.metadata?.originalModelId).toBe(
        "us.anthropic.claude-sonnet-4-20250514-v1:0",
      );
    });

    it("should include request ID in metadata", () => {
      const usage = bedrockStrategy.extract([], bedrockResponse, []);
      expect(usage?.metadata?.requestId).toBe("abc-123-def");
    });

    it("should get model from args if not in response", () => {
      const responseWithoutModel = {
        usage: { inputTokens: 100, outputTokens: 50 },
        $metadata: {},
      };
      const usage = bedrockStrategy.extract([], responseWithoutModel, [
        { modelId: "anthropic.claude-3-haiku-20240307-v1:0" },
      ]);
      expect(usage?.model).toBe("anthropic.claude-3-haiku");
    });
  });

  describe("Google Vertex AI Strategy", () => {
    const vertexResponse = {
      candidates: [
        {
          content: {
            parts: [{ text: "Hello from Gemini!" }],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 180,
        candidatesTokenCount: 90,
        totalTokenCount: 270,
      },
      modelVersion: "gemini-1.5-flash",
    };

    it("should detect Vertex AI responses", () => {
      expect(
        vertexAIStrategy.canHandle(["generateContent"], vertexResponse),
      ).toBe(true);
    });

    it("should detect responses with usageMetadata", () => {
      const minimalResponse = {
        usageMetadata: {
          promptTokenCount: 100,
        },
      };
      expect(vertexAIStrategy.canHandle([], minimalResponse)).toBe(true);
    });

    it("should not detect OpenAI responses", () => {
      const openaiResponse = {
        usage: {
          prompt_tokens: 100,
        },
      };
      expect(vertexAIStrategy.canHandle([], openaiResponse)).toBe(false);
    });

    it("should not detect Anthropic responses", () => {
      const anthropicResponse = {
        usage: {
          input_tokens: 100,
        },
      };
      expect(vertexAIStrategy.canHandle([], anthropicResponse)).toBe(false);
    });

    it("should extract usage data correctly", () => {
      const usage = vertexAIStrategy.extract(
        ["generateContent"],
        vertexResponse,
        [],
      );

      expect(usage).not.toBeNull();
      expect(usage?.provider).toBe("google-vertex");
      expect(usage?.model).toBe("gemini-1.5-flash");
      expect(usage?.inputUnits).toBe(180);
      expect(usage?.outputUnits).toBe(90);
    });

    it("should include total tokens in metadata", () => {
      const usage = vertexAIStrategy.extract([], vertexResponse, []);
      expect(usage?.metadata?.totalTokens).toBe(270);
    });

    it("should handle cached content tokens", () => {
      const cachedResponse = {
        usageMetadata: {
          promptTokenCount: 200,
          candidatesTokenCount: 100,
          cachedContentTokenCount: 150,
        },
      };
      const usage = vertexAIStrategy.extract([], cachedResponse, []);
      expect(usage?.cachedInputUnits).toBe(150);
    });

    it("should get model from args if not in response", () => {
      const responseWithoutModel = {
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
        },
      };
      const usage = vertexAIStrategy.extract([], responseWithoutModel, [
        { model: "gemini-2.5-flash" },
      ]);
      expect(usage?.model).toBe("gemini-2.5-flash");
    });

    it("should return unknown model if not available", () => {
      const responseWithoutModel = {
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
        },
      };
      const usage = vertexAIStrategy.extract([], responseWithoutModel, []);
      expect(usage?.model).toBe("unknown");
    });
  });

  describe("BFL (Black Forest Labs) Strategy", () => {
    const bflResponse = {
      id: "task_abc123",
      sample: "base64_encoded_image_data...",
    };

    it("should detect BFL responses with id and sample", () => {
      expect(bflStrategy.canHandle(["generate"], bflResponse)).toBe(true);
    });

    it("should detect BFL responses with images array", () => {
      const responseWithImages = {
        id: "task_abc123",
        images: [{ url: "https://..." }],
      };
      expect(bflStrategy.canHandle([], responseWithImages)).toBe(true);
    });

    it("should NOT detect fal.ai responses (has requestId)", () => {
      const falResponse = {
        requestId: "req_abc123",
        data: {
          images: [{ url: "https://..." }],
        },
      };
      expect(bflStrategy.canHandle([], falResponse)).toBe(false);
    });

    it("should NOT detect responses without id", () => {
      const noIdResponse = {
        sample: "base64_data",
      };
      expect(bflStrategy.canHandle([], noIdResponse)).toBe(false);
    });

    it("should NOT detect responses without sample or images", () => {
      const noSampleResponse = {
        id: "task_abc123",
        status: "completed",
      };
      expect(bflStrategy.canHandle([], noSampleResponse)).toBe(false);
    });

    it("should extract usage data correctly", () => {
      const usage = bflStrategy.extract(["generate"], bflResponse, [
        { model: "flux-pro-1.1" },
      ]);

      expect(usage).not.toBeNull();
      expect(usage?.provider).toBe("bfl");
      expect(usage?.model).toBe("flux-pro-1.1");
      expect(usage?.outputUnits).toBe(1);
    });

    it("should count multiple images", () => {
      const multiImageResponse = {
        id: "task_abc123",
        images: [
          { url: "https://1..." },
          { url: "https://2..." },
          { url: "https://3..." },
        ],
      };
      const usage = bflStrategy.extract([], multiImageResponse, []);
      expect(usage?.outputUnits).toBe(3);
    });

    it("should count multiple samples", () => {
      const multiSampleResponse = {
        id: "task_abc123",
        sample: ["base64_1", "base64_2"],
      };
      const usage = bflStrategy.extract([], multiSampleResponse, []);
      expect(usage?.outputUnits).toBe(2);
    });

    it("should extract model from endpoint", () => {
      const usage = bflStrategy.extract([], bflResponse, [
        { endpoint: "/v1/flux-pro-1.1-ultra" },
      ]);
      expect(usage?.model).toBe("flux-pro-1.1-ultra");
    });

    it("should use default model if not specified", () => {
      const usage = bflStrategy.extract([], bflResponse, []);
      expect(usage?.model).toBe("flux-pro");
    });

    it("should include request ID in metadata", () => {
      const usage = bflStrategy.extract([], bflResponse, []);
      expect(usage?.metadata?.requestId).toBe("task_abc123");
    });

    it("should prefer model param over endpoint extraction", () => {
      const usage = bflStrategy.extract([], bflResponse, [
        { model: "flux-schnell", endpoint: "/v1/flux-pro" },
      ]);
      expect(usage?.model).toBe("flux-schnell");
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
      expect(falStrategy.canHandle([], { request_id: "abc123" })).toBe(true);
    });

    it("should extract usage data correctly", () => {
      const usage = falStrategy.extract(["subscribe"], falResponse, [
        "fal-ai/flux-pro",
      ]);

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

      const usage = falStrategy.extract([], singleImageResponse, ["fast-sdxl"]);

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
      expect(elevenlabsStrategy.canHandle(["generate"], Buffer.from([]))).toBe(
        true,
      );
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
