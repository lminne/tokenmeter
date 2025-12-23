/**
 * TokenMeter Constants
 *
 * Centralized constants used across the library to avoid magic strings.
 * All mappings use TypeScript's `satisfies` constraint for compile-time safety.
 */

/**
 * HTTP header names used for context propagation and identification.
 */
export const HEADERS = {
  /** User ID header for cost attribution */
  USER_ID: "x-user-id",
  /** Organization ID header for cost attribution */
  ORG_ID: "x-org-id",
  /** Request ID header for tracing */
  REQUEST_ID: "x-request-id",
  /** W3C Trace Context traceparent header */
  TRACEPARENT: "traceparent",
  /** W3C Trace Context tracestate header */
  TRACESTATE: "tracestate",
  /** W3C Baggage header */
  BAGGAGE: "baggage",
} as const;

/**
 * Provider identifiers used throughout the library.
 *
 * Note: Google is split into two providers:
 * - GOOGLE_AI_STUDIO: Google AI Studio (@google/generative-ai SDK, API key auth)
 * - GOOGLE_VERTEX: Google Vertex AI (@google-cloud/vertexai SDK, Google Cloud auth)
 */
export const PROVIDERS = {
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  GOOGLE_AI_STUDIO: "google-ai-studio",
  GOOGLE_VERTEX: "google-vertex",
  BEDROCK: "bedrock",
  FAL: "fal",
  ELEVENLABS: "elevenlabs",
  BFL: "bfl",
  VERCEL_AI: "vercel-ai",
  UNKNOWN: "unknown",
} as const;

/**
 * Provider type derived from PROVIDERS constant.
 */
export type Provider = (typeof PROVIDERS)[keyof typeof PROVIDERS];

/**
 * Provider key type (the uppercase keys like OPENAI, ANTHROPIC, etc.)
 */
export type ProviderKey = keyof typeof PROVIDERS;

/**
 * Known providers that have extraction strategies.
 * Excludes UNKNOWN which is a fallback, not a real provider.
 */
export type KnownProvider = Exclude<Provider, "unknown">;

/**
 * Keys for known providers (excludes UNKNOWN).
 */
export type KnownProviderKey = Exclude<ProviderKey, "UNKNOWN">;

/**
 * Providers that require default models (don't include model in API responses).
 * TypeScript ensures all keys are valid known provider values.
 */
export type ProviderWithDefaultModel = "elevenlabs" | "bfl";

/**
 * Default model names for providers when not explicitly specified.
 * Uses `satisfies` to ensure keys are valid providers that need defaults.
 */
export const DEFAULT_MODELS = {
  [PROVIDERS.ELEVENLABS]: "eleven_multilingual_v2",
  [PROVIDERS.BFL]: "flux-pro",
} as const satisfies Record<ProviderWithDefaultModel, string>;

/**
 * Factory method names that create new proxiable objects.
 * These methods return objects that should be wrapped in the proxy
 * but don't create spans themselves.
 */
export const FACTORY_METHODS = [
  "getGenerativeModel",
  "getModel",
  "startChat",
] as const;

/**
 * Properties that should never be proxied (prototype pollution protection).
 */
export const BLOCKED_PROPERTIES = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);
