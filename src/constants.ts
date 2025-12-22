/**
 * TokenMeter Constants
 *
 * Centralized constants used across the library to avoid magic strings.
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
 */
export const PROVIDERS = {
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  GOOGLE: "google",
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
 * Default model names for providers when not explicitly specified.
 */
export const DEFAULT_MODELS = {
  [PROVIDERS.ELEVENLABS]: "eleven_multilingual_v2",
  [PROVIDERS.BFL]: "flux-pro",
} as const;

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

