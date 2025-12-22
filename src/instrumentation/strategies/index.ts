/**
 * Extraction Strategies
 *
 * Each strategy knows how to extract usage data from a specific provider's API responses.
 */

import type { ExtractionStrategy, UsageData } from "../../types.js";

/**
 * OpenAI extraction strategy
 */
export const openaiStrategy: ExtractionStrategy = {
  provider: "openai",

  canHandle(methodPath: string[], result: unknown): boolean {
    // Handle chat.completions.create, completions.create, embeddings.create, etc.
    if (!result || typeof result !== "object") return false;

    const r = result as Record<string, unknown>;

    // Check for OpenAI response structure
    return (
      "usage" in r &&
      typeof r.usage === "object" &&
      r.usage !== null &&
      ("prompt_tokens" in (r.usage as object) ||
        "total_tokens" in (r.usage as object))
    );
  },

  extract(
    methodPath: string[],
    result: unknown,
    args: unknown[],
  ): UsageData | null {
    const r = result as {
      model?: string;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        cached_tokens?: number;
      };
    };

    if (!r.usage) return null;

    // Extract model from result or from request args
    let model = r.model || "unknown";
    if (!r.model && args.length > 0) {
      const params = args[0] as { model?: string } | undefined;
      if (params?.model) {
        model = params.model;
      }
    }

    return {
      provider: "openai",
      model,
      inputUnits: r.usage.prompt_tokens,
      outputUnits: r.usage.completion_tokens,
      cachedInputUnits: r.usage.cached_tokens,
      metadata: {
        totalTokens: r.usage.total_tokens,
      },
    };
  },
};

/**
 * Anthropic extraction strategy
 */
export const anthropicStrategy: ExtractionStrategy = {
  provider: "anthropic",

  canHandle(methodPath: string[], result: unknown): boolean {
    if (!result || typeof result !== "object") return false;

    const r = result as Record<string, unknown>;

    // Anthropic responses have usage with input_tokens/output_tokens
    return (
      "usage" in r &&
      typeof r.usage === "object" &&
      r.usage !== null &&
      "input_tokens" in (r.usage as object)
    );
  },

  extract(
    methodPath: string[],
    result: unknown,
    args: unknown[],
  ): UsageData | null {
    const r = result as {
      model?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };

    if (!r.usage) return null;

    let model = r.model || "unknown";
    if (!r.model && args.length > 0) {
      const params = args[0] as { model?: string } | undefined;
      if (params?.model) {
        model = params.model;
      }
    }

    return {
      provider: "anthropic",
      model,
      inputUnits: r.usage.input_tokens,
      outputUnits: r.usage.output_tokens,
      cachedInputUnits: r.usage.cache_read_input_tokens,
      metadata: {
        cacheCreationTokens: r.usage.cache_creation_input_tokens,
      },
    };
  },
};

/**
 * fal.ai extraction strategy
 */
export const falStrategy: ExtractionStrategy = {
  provider: "fal",

  canHandle(methodPath: string[], result: unknown): boolean {
    if (!result || typeof result !== "object") return false;

    const r = result as Record<string, unknown>;

    // fal.ai responses typically have requestId and data
    return "requestId" in r || "request_id" in r;
  },

  extract(
    methodPath: string[],
    result: unknown,
    args: unknown[],
  ): UsageData | null {
    const r = result as {
      data?: {
        images?: Array<{ url?: string; width?: number; height?: number }>;
        image?: { url?: string; width?: number; height?: number };
        video?: { url?: string };
        audio?: { url?: string };
        duration?: number;
      };
      requestId?: string;
      request_id?: string;
    };

    // Extract endpoint ID from args
    let model = "unknown";
    if (args.length > 0 && typeof args[0] === "string") {
      // fal.subscribe("fal-ai/flux-pro", {...})
      model = args[0].replace("fal-ai/", "");
    }

    const data = r.data || r;
    let outputUnits = 1; // Default to 1 for request-based pricing

    // Image generation: count images
    if ("images" in data && Array.isArray(data.images)) {
      outputUnits = data.images.length;
    } else if ("image" in data && data.image) {
      outputUnits = 1;
    }

    // Video generation: use duration in seconds
    if ("video" in data && data.video && "duration" in data) {
      outputUnits = (data as { duration?: number }).duration || 1;
    }

    return {
      provider: "fal",
      model,
      outputUnits,
      metadata: {
        requestId: r.requestId || r.request_id,
      },
    };
  },
};

/**
 * ElevenLabs extraction strategy
 */
export const elevenlabsStrategy: ExtractionStrategy = {
  provider: "elevenlabs",

  canHandle(methodPath: string[], result: unknown): boolean {
    // ElevenLabs returns audio buffers, we detect by method path
    return (
      methodPath.includes("textToSpeech") ||
      methodPath.includes("generate") ||
      methodPath.includes("convert")
    );
  },

  extract(
    methodPath: string[],
    result: unknown,
    args: unknown[],
  ): UsageData | null {
    // For ElevenLabs, we need to extract character count from the input
    // The result is typically a Buffer/ArrayBuffer

    let text = "";
    let model = "eleven_multilingual_v2"; // Default model

    // Extract from args based on method signature
    if (args.length >= 2) {
      // textToSpeech.convert(voiceId, { text, modelId })
      const options = args[1] as
        | { text?: string; modelId?: string; model_id?: string }
        | undefined;
      if (options?.text) {
        text = options.text;
      }
      if (options?.modelId || options?.model_id) {
        model = options.modelId || options.model_id || model;
      }
    } else if (args.length === 1) {
      // generate({ text, voice, modelId })
      const options = args[0] as
        | { text?: string; modelId?: string; model_id?: string }
        | undefined;
      if (options?.text) {
        text = options.text;
      }
      if (options?.modelId || options?.model_id) {
        model = options.modelId || options.model_id || model;
      }
    }

    return {
      provider: "elevenlabs",
      model,
      inputUnits: text.length, // Character count
      metadata: {
        characterCount: text.length,
      },
    };
  },
};

/**
 * Parse Bedrock model ID to extract canonical model name
 *
 * @example
 * "us.anthropic.claude-sonnet-4-20250514-v1:0" -> "anthropic.claude-sonnet-4"
 * "eu.anthropic.claude-3-5-sonnet-20241022-v2:0" -> "anthropic.claude-3-5-sonnet"
 */
function parseBedrockModelId(modelId: string): string {
  // Remove region prefix (us., eu., ap., etc.)
  let parsed = modelId.replace(/^[a-z]{2}\./, "");

  // Remove version suffix (-v1:0, -v2:0, etc.)
  parsed = parsed.replace(/-v\d+:\d+$/, "");

  // Remove date suffix (-20250514, -20241022, etc.)
  parsed = parsed.replace(/-\d{8}$/, "");

  return parsed;
}

/**
 * AWS Bedrock extraction strategy
 */
export const bedrockStrategy: ExtractionStrategy = {
  provider: "bedrock",

  canHandle(methodPath: string[], result: unknown): boolean {
    if (!result || typeof result !== "object") return false;

    const r = result as Record<string, unknown>;

    // Bedrock responses have usage with inputTokens/outputTokens
    // and typically include $metadata or modelId
    return (
      "usage" in r &&
      typeof r.usage === "object" &&
      r.usage !== null &&
      "inputTokens" in (r.usage as object) &&
      ("modelId" in r || "$metadata" in r)
    );
  },

  extract(
    methodPath: string[],
    result: unknown,
    args: unknown[],
  ): UsageData | null {
    const r = result as {
      modelId?: string;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
      };
      $metadata?: {
        httpStatusCode?: number;
        requestId?: string;
      };
    };

    if (!r.usage) return null;

    let model = r.modelId || "unknown";

    // Try to get model from args if not in result
    if (!r.modelId && args.length > 0) {
      const params = args[0] as { modelId?: string } | undefined;
      if (params?.modelId) {
        model = params.modelId;
      }
    }

    // Parse the Bedrock model ID to canonical form
    const canonicalModel = parseBedrockModelId(model);

    return {
      provider: "bedrock",
      model: canonicalModel,
      inputUnits: r.usage.inputTokens,
      outputUnits: r.usage.outputTokens,
      metadata: {
        originalModelId: model,
        requestId: r.$metadata?.requestId,
      },
    };
  },
};

/**
 * Google Vertex AI / Gemini extraction strategy
 */
export const vertexAIStrategy: ExtractionStrategy = {
  provider: "google",

  canHandle(methodPath: string[], result: unknown): boolean {
    if (!result || typeof result !== "object") return false;

    const r = result as Record<string, unknown>;

    // Vertex AI / Gemini responses have usageMetadata with promptTokenCount/candidatesTokenCount
    return (
      "usageMetadata" in r &&
      typeof r.usageMetadata === "object" &&
      r.usageMetadata !== null &&
      "promptTokenCount" in (r.usageMetadata as object)
    );
  },

  extract(
    methodPath: string[],
    result: unknown,
    args: unknown[],
  ): UsageData | null {
    const r = result as {
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
        cachedContentTokenCount?: number;
      };
      modelVersion?: string;
    };

    if (!r.usageMetadata) return null;

    // Try to extract model from result or args
    let model = "unknown";
    if (r.modelVersion) {
      model = r.modelVersion;
    } else if (args.length > 0) {
      const params = args[0] as { model?: string } | undefined;
      if (params?.model) {
        model = params.model;
      }
    }

    return {
      provider: "google",
      model,
      inputUnits: r.usageMetadata.promptTokenCount,
      outputUnits: r.usageMetadata.candidatesTokenCount,
      cachedInputUnits: r.usageMetadata.cachedContentTokenCount,
      metadata: {
        totalTokens: r.usageMetadata.totalTokenCount,
      },
    };
  },
};

/**
 * BFL (Black Forest Labs) extraction strategy
 *
 * Note: BFL responses are similar to fal.ai but use "id" (not "requestId")
 * and have "sample" field for images. fal.ai uses "requestId" (camelCase).
 */
export const bflStrategy: ExtractionStrategy = {
  provider: "bfl",

  canHandle(methodPath: string[], result: unknown): boolean {
    if (!result || typeof result !== "object") return false;

    const r = result as Record<string, unknown>;

    // BFL API responses have:
    // - "id" field (not "requestId" which is fal.ai's format)
    // - "sample" field with base64 image data
    // Explicitly exclude fal.ai responses which have "requestId" (camelCase)
    if ("requestId" in r) return false;

    return "id" in r && ("sample" in r || "images" in r);
  },

  extract(
    methodPath: string[],
    result: unknown,
    args: unknown[],
  ): UsageData | null {
    const r = result as {
      id?: string;
      request_id?: string;
      sample?: string | string[];
      images?: Array<{ url?: string }>;
      result?: { sample?: string };
    };

    // Extract model from args (BFL uses model in request body or endpoint)
    let model = "flux-pro"; // Default
    if (args.length > 0) {
      const params = args[0] as
        | { model?: string; endpoint?: string }
        | undefined;
      if (params?.model) {
        model = params.model;
      } else if (params?.endpoint) {
        // Extract model from endpoint like "/v1/flux-pro-1.1"
        const match = params.endpoint.match(/\/(flux-[\w.-]+)/);
        if (match) {
          model = match[1];
        }
      }
    }

    // Count output images
    let outputUnits = 1;
    if (r.images && Array.isArray(r.images)) {
      outputUnits = r.images.length;
    } else if (r.sample && Array.isArray(r.sample)) {
      outputUnits = r.sample.length;
    }

    return {
      provider: "bfl",
      model,
      outputUnits,
      metadata: {
        requestId: r.id || r.request_id,
      },
    };
  },
};

/**
 * Vercel AI SDK extraction strategy
 * Handles generateText, streamText, generateObject, streamObject results
 */
export const vercelAIStrategy: ExtractionStrategy = {
  provider: "vercel-ai",

  canHandle(methodPath: string[], result: unknown): boolean {
    if (!result || typeof result !== "object") return false;

    const r = result as Record<string, unknown>;

    // Vercel AI SDK responses have usage with promptTokens/completionTokens
    return (
      "usage" in r &&
      typeof r.usage === "object" &&
      r.usage !== null &&
      "promptTokens" in (r.usage as object)
    );
  },

  extract(
    methodPath: string[],
    result: unknown,
    args: unknown[],
  ): UsageData | null {
    const r = result as {
      usage?: {
        promptTokens?: number;
        completionTokens?: number;
      };
      response?: {
        modelId?: string;
      };
    };

    if (!r.usage) return null;

    // Try to determine provider and model
    let provider = "unknown";
    let model = "unknown";

    if (r.response?.modelId) {
      model = r.response.modelId;
      // Infer provider from model
      if (
        model.startsWith("gpt-") ||
        model.startsWith("o1") ||
        model.startsWith("o3")
      ) {
        provider = "openai";
      } else if (model.startsWith("claude-")) {
        provider = "anthropic";
      } else if (model.startsWith("gemini-")) {
        provider = "google";
      }
    }

    // Try to get model from args
    if (args.length > 0) {
      const params = args[0] as
        | { model?: { modelId?: string; provider?: string } }
        | undefined;
      if (params?.model?.modelId) {
        model = params.model.modelId;
      }
      if (params?.model?.provider) {
        provider = params.model.provider;
      }
    }

    return {
      provider,
      model,
      inputUnits: r.usage.promptTokens,
      outputUnits: r.usage.completionTokens,
    };
  },
};

/**
 * All registered strategies
 */
export const strategies: ExtractionStrategy[] = [
  openaiStrategy,
  anthropicStrategy,
  bedrockStrategy,
  vertexAIStrategy,
  falStrategy,
  bflStrategy,
  elevenlabsStrategy,
  vercelAIStrategy,
];

/**
 * Find the appropriate strategy for a given result
 */
export function findStrategy(
  methodPath: string[],
  result: unknown,
): ExtractionStrategy | null {
  for (const strategy of strategies) {
    if (strategy.canHandle(methodPath, result)) {
      return strategy;
    }
  }
  return null;
}

/**
 * Extract usage data using the appropriate strategy
 */
export function extractUsage(
  methodPath: string[],
  result: unknown,
  args: unknown[],
  providerHint?: string,
): UsageData | null {
  // If provider hint is given, try that strategy first
  if (providerHint) {
    const hintedStrategy = strategies.find((s) => s.provider === providerHint);
    if (hintedStrategy?.canHandle(methodPath, result)) {
      return hintedStrategy.extract(methodPath, result, args);
    }
  }

  // Otherwise, try all strategies
  const strategy = findStrategy(methodPath, result);
  if (strategy) {
    return strategy.extract(methodPath, result, args);
  }

  return null;
}
