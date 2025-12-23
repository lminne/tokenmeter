/**
 * Provider Detection
 *
 * Detects the AI provider from a client instance using multiple strategies:
 * 1. Symbol-based identification
 * 2. Custom registered providers
 * 3. Built-in duck-typing detection
 */

import {
  TOKENMETER_PROVIDER,
  detectProviderFromRegistry,
} from "../registry.js";
import { PROVIDERS } from "../constants.js";

/**
 * Detect the provider from the client instance.
 *
 * Detection order:
 * 1. Symbol-based identification (TOKENMETER_PROVIDER)
 * 2. Custom registered providers (via registry)
 * 3. Built-in provider detection (duck-typing)
 *
 * @param client - The SDK client instance to detect
 * @returns The detected provider identifier string
 *
 * @internal
 */
export function detectProvider(client: unknown): string {
  if (!client || typeof client !== "object") return PROVIDERS.UNKNOWN;

  // 1. Check for Symbol-based provider identification
  if (TOKENMETER_PROVIDER in client) {
    const symbolProvider = (client as Record<symbol, unknown>)[
      TOKENMETER_PROVIDER
    ];
    if (typeof symbolProvider === "string") {
      return symbolProvider;
    }
  }

  // 2. Check registered providers from registry
  const registeredProvider = detectProviderFromRegistry(client);
  if (registeredProvider) {
    return registeredProvider;
  }

  // 3. Built-in provider detection (duck-typing fallback)
  const c = client as Record<string, unknown>;

  // OpenAI: has chat.completions
  if (
    "chat" in c &&
    typeof c.chat === "object" &&
    c.chat &&
    "completions" in c.chat
  ) {
    return PROVIDERS.OPENAI;
  }

  // Anthropic: has messages.create
  if ("messages" in c && typeof c.messages === "object") {
    return PROVIDERS.ANTHROPIC;
  }

  // fal.ai: has subscribe method
  if ("subscribe" in c && typeof c.subscribe === "function") {
    return PROVIDERS.FAL;
  }

  // ElevenLabs: has textToSpeech
  if ("textToSpeech" in c && typeof c.textToSpeech === "object") {
    return PROVIDERS.ELEVENLABS;
  }

  // @google/generative-ai: GoogleGenerativeAI has getGenerativeModel method (AI Studio)
  if ("getGenerativeModel" in c && typeof c.getGenerativeModel === "function") {
    return PROVIDERS.GOOGLE_AI_STUDIO;
  }

  // @google/generative-ai: GenerativeModel has generateContent method (AI Studio)
  if (
    "generateContent" in c &&
    typeof c.generateContent === "function" &&
    "model" in c
  ) {
    // Check if this is Vertex AI by looking for vertexai-specific properties
    if ("project" in c || "location" in c) {
      return PROVIDERS.GOOGLE_VERTEX;
    }
    return PROVIDERS.GOOGLE_AI_STUDIO;
  }

  // @google/genai: GoogleGenAI has models property with generateContent
  // Detect AI Studio vs Vertex by checking for apiKey vs vertexai config
  if (
    "models" in c &&
    typeof c.models === "object" &&
    c.models !== null &&
    "generateContent" in (c.models as object)
  ) {
    // If client has apiKey, it's AI Studio; otherwise assume Vertex
    if ("apiKey" in c) {
      return PROVIDERS.GOOGLE_AI_STUDIO;
    }
    return PROVIDERS.GOOGLE_VERTEX;
  }

  // @google-cloud/vertexai: VertexAI has getGenerativeModel with project/location
  if (
    "getGenerativeModel" in c &&
    ("project" in c || "location" in c)
  ) {
    return PROVIDERS.GOOGLE_VERTEX;
  }

  return PROVIDERS.UNKNOWN;
}
