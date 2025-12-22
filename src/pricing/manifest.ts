/**
 * Pricing Manifest Manager
 *
 * Bundled-first pricing with remote updates for reliability.
 * Pricing is always available synchronously via bundled data.
 * Remote fetching updates the cache in the background.
 */

import type { PricingManifest, ModelPricing, PricingUnit } from "../types.js";
import { logger } from "../logger.js";
import { BUNDLED_MANIFEST } from "./manifest.bundled.js";

/**
 * Divisor mapping for pricing units.
 * Defines how many units constitute the pricing base for each unit type.
 *
 * Used in cost calculation to convert raw unit counts to the appropriate
 * scale for multiplying with pricing rates.
 *
 * @example
 * // "1m_tokens" has divisor 1_000_000, so price is per million tokens
 * const costPerToken = price / UNIT_DIVISORS["1m_tokens"];
 *
 * // "1k_characters" has divisor 1_000, so price is per thousand characters
 * const costPerChar = price / UNIT_DIVISORS["1k_characters"];
 *
 * @internal
 */
const UNIT_DIVISORS: Record<PricingUnit, number> = {
  "1m_tokens": 1_000_000,
  "1k_tokens": 1_000,
  "1k_characters": 1_000,
  request: 1,
  megapixel: 1,
  second: 1,
  minute: 1,
  image: 1,
};

/**
 * Default Pricing API URL.
 * Primary source for pricing data with automatic updates.
 */
const DEFAULT_API_URL = "https://pricing.tokenmeter.dev/api/v1";

/**
 * Fallback CDN URL for the pricing manifest.
 * Used when the API is unavailable.
 */
const DEFAULT_CDN_URL =
  "https://cdn.jsdelivr.net/npm/tokenmeter@latest/dist/pricing/manifest.json";

/**
 * Model alias mapping for custom model names
 */
export interface ModelAlias {
  /** Target provider for pricing lookup */
  provider: string;
  /** Target model ID for pricing lookup */
  model: string;
}

/**
 * Configuration for pricing manifest loading
 */
export interface PricingConfig {
  /**
   * URL to fetch the pricing manifest from the API.
   * @default https://pricing.tokenmeter.dev/api/v1
   */
  apiUrl?: string;

  /**
   * Fallback CDN URL if API is unavailable.
   * @default jsdelivr CDN URL
   */
  cdnUrl?: string;

  /**
   * Legacy: URL to fetch the pricing manifest from.
   * @deprecated Use apiUrl instead
   */
  manifestUrl?: string;

  /**
   * If true, skip remote fetching and only use bundled local pricing.
   * Useful for offline environments or when you want predictable pricing.
   * @default false
   */
  offlineMode?: boolean;

  /**
   * Timeout for remote manifest fetch in milliseconds.
   * @default 5000
   */
  fetchTimeout?: number;

  /**
   * Cache timeout in milliseconds. Manifest will be refetched after this duration.
   * @default 300000 (5 minutes)
   */
  cacheTimeout?: number;

  /**
   * Custom model aliases for pricing lookup.
   * Maps custom model names to their canonical provider/model for pricing.
   *
   * @example
   * ```typescript
   * configurePricing({
   *   modelAliases: {
   *     "bedrock-claude-4-5-sonnet": { provider: "bedrock", model: "anthropic.claude-sonnet-4-5" },
   *     "my-gpt": { provider: "openai", model: "gpt-4o" },
   *   }
   * });
   * ```
   */
  modelAliases?: Record<string, ModelAlias>;
}

// Global configuration
let globalConfig: PricingConfig = {};

// Model alias storage for fast lookup
let modelAliases: Record<string, ModelAlias> = {};

// Cache for the loaded manifest - initialized with bundled data (always available)
let cachedManifest: PricingManifest = BUNDLED_MANIFEST;
let manifestLoadPromise: Promise<PricingManifest> | null = null;
let cacheTimestamp: number = Date.now();

/**
 * Allowed URL hosts for pricing manifest fetching (SSRF protection)
 */
const ALLOWED_MANIFEST_HOSTS = new Set([
  "pricing.tokenmeter.dev",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "raw.githubusercontent.com",
]);

/**
 * Validate a URL for manifest fetching
 */
function isValidManifestUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Must be HTTPS (except localhost for development)
    if (
      parsed.protocol !== "https:" &&
      parsed.hostname !== "localhost" &&
      parsed.hostname !== "127.0.0.1"
    ) {
      return false;
    }

    // Check against allowlist (skip for localhost)
    if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      const isAllowed =
        ALLOWED_MANIFEST_HOSTS.has(parsed.hostname) ||
        Array.from(ALLOWED_MANIFEST_HOSTS).some((host) =>
          parsed.hostname.endsWith(`.${host}`),
        );
      if (!isAllowed) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a URL configuration field.
 * Throws an error if the URL is invalid.
 *
 * @param url - The URL value to validate
 * @param fieldName - The name of the field for error messages
 * @throws {Error} If URL is defined but invalid
 *
 * @internal
 */
function validateConfigUrl(url: string | undefined, fieldName: string): void {
  if (url !== undefined) {
    if (typeof url !== "string" || !isValidManifestUrl(url)) {
      throw new Error(
        `Invalid ${fieldName}: ${url}. Must be HTTPS from allowed domains.`,
      );
    }
  }
}

/**
 * Configure global pricing settings.
 *
 * @throws {Error} If configuration is invalid
 *
 * @example
 * ```typescript
 * import { configurePricing } from 'tokenmeter';
 *
 * // Use custom CDN
 * configurePricing({ manifestUrl: 'https://your-cdn.com/manifest.json' });
 *
 * // Offline mode (bundled pricing only)
 * configurePricing({ offlineMode: true });
 *
 * // Custom model aliases
 * configurePricing({
 *   modelAliases: {
 *     "bedrock-claude-4-5-sonnet": { provider: "bedrock", model: "anthropic.claude-sonnet-4-5" },
 *   }
 * });
 * ```
 */
export function configurePricing(config: PricingConfig): void {
  // Validate URLs
  validateConfigUrl(config.apiUrl, "apiUrl");
  validateConfigUrl(config.cdnUrl, "cdnUrl");
  validateConfigUrl(config.manifestUrl, "manifestUrl");

  // Validate timeouts
  if (config.fetchTimeout !== undefined) {
    if (
      typeof config.fetchTimeout !== "number" ||
      config.fetchTimeout < 0 ||
      config.fetchTimeout > 120000
    ) {
      throw new Error(
        `Invalid fetchTimeout: ${config.fetchTimeout}. Must be 0-120000ms.`,
      );
    }
  }

  if (config.cacheTimeout !== undefined) {
    if (
      typeof config.cacheTimeout !== "number" ||
      config.cacheTimeout < 0 ||
      config.cacheTimeout > 86400000
    ) {
      throw new Error(
        `Invalid cacheTimeout: ${config.cacheTimeout}. Must be 0-86400000ms (24h).`,
      );
    }
  }

  // Validate model aliases
  if (config.modelAliases !== undefined) {
    if (
      typeof config.modelAliases !== "object" ||
      config.modelAliases === null
    ) {
      throw new Error("modelAliases must be an object");
    }

    for (const [key, alias] of Object.entries(config.modelAliases)) {
      if (!alias || typeof alias !== "object") {
        throw new Error(`Invalid model alias "${key}": must be an object`);
      }
      if (!alias.provider || typeof alias.provider !== "string") {
        throw new Error(
          `Invalid model alias "${key}": missing or invalid provider`,
        );
      }
      if (!alias.model || typeof alias.model !== "string") {
        throw new Error(
          `Invalid model alias "${key}": missing or invalid model`,
        );
      }
    }
  }

  globalConfig = { ...globalConfig, ...config };

  // Update model aliases if provided
  if (config.modelAliases) {
    modelAliases = { ...modelAliases, ...config.modelAliases };
  }

  // Clear cache when config changes
  clearManifestCache();
}

/**
 * Get the current pricing configuration.
 */
export function getPricingConfig(): PricingConfig {
  return { ...globalConfig };
}

/**
 * Fetch manifest from remote URL with timeout
 */
async function fetchRemoteManifest(
  url: string,
  timeoutMs: number,
): Promise<PricingManifest> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "tokenmeter/5.0",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch manifest: ${response.status} ${response.statusText}`,
      );
    }

    return response.json() as Promise<PricingManifest>;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * API manifest response format
 */
interface APIManifestResponse {
  version?: string;
  updated_at?: string;
  models?: Record<
    string,
    {
      provider: string;
      input?: number;
      output?: number;
      cached_input?: number;
      cached_output?: number;
      cache_write?: number;
      cache_read?: number;
      unit?: string;
    }
  >;
}

/**
 * Fetch manifest from Pricing API and convert to internal format
 */
async function fetchFromAPI(
  apiUrl: string,
  timeoutMs: number,
): Promise<PricingManifest> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${apiUrl}/manifest`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "tokenmeter/5.0",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch from API: ${response.status} ${response.statusText}`,
      );
    }

    const apiManifest = (await response.json()) as APIManifestResponse;

    // Convert API format to internal format
    const manifest: PricingManifest = {
      version: apiManifest.version || "1.0.0",
      updatedAt: apiManifest.updated_at || new Date().toISOString(),
      providers: {},
    };

    // Group models by provider
    for (const [modelId, model] of Object.entries(apiManifest.models || {})) {
      if (!manifest.providers[model.provider]) {
        manifest.providers[model.provider] = {};
      }

      manifest.providers[model.provider][modelId] = {
        input: model.input,
        output: model.output,
        cachedInput: model.cached_input,
        cachedOutput: model.cached_output,
        cacheWrite: model.cache_write,
        cacheRead: model.cache_read,
        unit: (model.unit as PricingUnit) || "1m_tokens",
      };
    }

    return manifest;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Load the pricing manifest.
 *
 * Returns immediately with bundled data. If the cache is stale,
 * fetches updated pricing from remote sources in the background.
 *
 * @param options.apiUrl - Override the API URL
 * @param options.cdnUrl - Override the CDN URL
 * @param options.manifestUrl - Legacy: Override the manifest URL (deprecated)
 * @param options.forceRefresh - Force reload from remote sources
 * @param options.offlineMode - Skip remote fetch, use bundled only
 */
export async function loadManifest(
  options: {
    apiUrl?: string;
    cdnUrl?: string;
    manifestUrl?: string;
    forceRefresh?: boolean;
    offlineMode?: boolean;
  } = {},
): Promise<PricingManifest> {
  // Merge with global config
  const config = { ...globalConfig, ...options };
  const cacheTimeout = config.cacheTimeout ?? 5 * 60 * 1000; // 5 minutes default

  // Check if cache is still valid
  const isCacheValid = Date.now() - cacheTimestamp < cacheTimeout;

  // Return cached if valid and not forcing refresh
  if (isCacheValid && !config.forceRefresh) {
    return cachedManifest;
  }

  // If already loading, wait for that
  if (manifestLoadPromise && !config.forceRefresh) {
    return manifestLoadPromise;
  }

  // If offline mode, just return bundled data
  if (config.offlineMode) {
    logger.debug("Offline mode enabled, using bundled pricing");
    return cachedManifest;
  }

  manifestLoadPromise = (async () => {
    const timeout = config.fetchTimeout ?? 5000;

    // Try Pricing API first
    const apiUrl = config.apiUrl || DEFAULT_API_URL;
    try {
      const manifest = await fetchFromAPI(apiUrl, timeout);
      cachedManifest = manifest;
      cacheTimestamp = Date.now();
      logger.info("Updated pricing manifest from API");
      return cachedManifest;
    } catch (apiError) {
      logger.debug("API unavailable, trying CDN:", apiError);
    }

    // Try CDN as fallback
    const cdnUrl = config.cdnUrl || config.manifestUrl || DEFAULT_CDN_URL;
    try {
      const manifest = await fetchRemoteManifest(cdnUrl, timeout);
      cachedManifest = manifest;
      cacheTimestamp = Date.now();
      logger.info("Updated pricing manifest from CDN");
      return cachedManifest;
    } catch (cdnError) {
      logger.debug("CDN unavailable, using bundled pricing:", cdnError);
    }

    // All remote sources failed - keep using bundled data
    logger.warn("All remote sources unavailable, using bundled pricing");
    return cachedManifest;
  })();

  return manifestLoadPromise;
}

/**
 * Get pricing for a specific model
 */
export function getModelPricing(
  provider: string,
  model: string,
  manifest: PricingManifest,
): ModelPricing | null {
  // 1. Check custom model aliases first
  // Try provider-specific alias first (e.g., "openai:gpt-4o"), then generic
  const providerSpecificAlias = modelAliases[`${provider}:${model}`];
  const genericAlias = modelAliases[model];
  const alias = providerSpecificAlias || genericAlias;

  if (alias) {
    const aliasProviderPricing = manifest.providers[alias.provider];
    if (aliasProviderPricing?.[alias.model]) {
      return aliasProviderPricing[alias.model];
    }
  }

  const providerPricing = manifest.providers[provider];
  if (!providerPricing) {
    return null;
  }

  // 2. Try exact match
  if (providerPricing[model]) {
    return providerPricing[model];
  }

  // 3. Try without version suffix (e.g., "gpt-4o-2024-05-13" -> "gpt-4o")
  const baseModel = model.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (baseModel !== model && providerPricing[baseModel]) {
    return providerPricing[baseModel];
  }

  // 4. Try with provider prefix stripped (some APIs return just the model name)
  const withoutPrefix = model.replace(/^[^/]+\//, "");
  if (withoutPrefix !== model && providerPricing[withoutPrefix]) {
    return providerPricing[withoutPrefix];
  }

  return null;
}

/**
 * Validate and normalize a numeric value
 * Returns 0 for invalid/negative values
 */
function normalizeUnits(value: number | undefined): number {
  if (value === undefined || value === null) {
    return 0;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  // Negative units don't make sense for usage
  return Math.max(0, value);
}

/**
 * Validate pricing value
 * Returns undefined for invalid values
 */
function normalizePricing(value: number | undefined): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  // Negative pricing doesn't make sense
  return value >= 0 ? value : undefined;
}

/**
 * Calculate cost based on usage and pricing
 *
 * Handles two pricing models:
 * 1. Request-based: Flat cost per request/image (uses `pricing.cost`)
 *    - For image generation, multiplied by outputUnits (number of images)
 * 2. Unit-based: Cost per input/output unit (uses `pricing.input`/`pricing.output`)
 *    - Divided by unit size (1M for tokens, 1K for characters)
 *
 * @param usage - Usage data with input/output units
 * @param pricing - Pricing configuration for the model
 * @returns Calculated cost in USD (always non-negative)
 */
export function calculateCost(
  usage: {
    inputUnits?: number;
    outputUnits?: number;
    cachedInputUnits?: number;
  },
  pricing: ModelPricing,
): number {
  let cost = 0;

  // Validate and normalize inputs
  const inputUnits = normalizeUnits(usage.inputUnits);
  const outputUnits = normalizeUnits(usage.outputUnits);
  const cachedInputUnits = normalizeUnits(usage.cachedInputUnits);

  // Validate pricing values
  const inputPrice = normalizePricing(pricing.input);
  const outputPrice = normalizePricing(pricing.output);
  const cachedInputPrice = normalizePricing(pricing.cachedInput);
  const flatCost = normalizePricing(pricing.cost);

  // Get the divisor based on unit
  const divisor = UNIT_DIVISORS[pricing.unit] ?? 1;

  // Flat cost (request-based pricing for images, etc.)
  // For image generation: cost per image * number of images
  // For flat request pricing: just the flat cost
  if (flatCost !== undefined) {
    const multiplier =
      pricing.unit === "image" || pricing.unit === "request"
        ? Math.max(1, outputUnits)
        : 1;
    cost += flatCost * multiplier;
  }

  // Input cost (token/character-based pricing)
  if (inputUnits > 0 && inputPrice !== undefined) {
    cost += (inputUnits / divisor) * inputPrice;
  }

  // Output cost (token/character-based pricing)
  if (outputUnits > 0 && outputPrice !== undefined) {
    cost += (outputUnits / divisor) * outputPrice;
  }

  // Cached input cost
  if (cachedInputUnits > 0 && cachedInputPrice !== undefined) {
    cost += (cachedInputUnits / divisor) * cachedInputPrice;
  }

  // Ensure we never return a negative cost
  return Math.max(0, cost);
}

/**
 * Get the cached manifest.
 * Always returns a valid manifest (bundled data is always available).
 */
export function getCachedManifest(): PricingManifest {
  return cachedManifest;
}

/**
 * Clear the manifest cache (resets to bundled data)
 */
export function clearManifestCache(): void {
  cachedManifest = BUNDLED_MANIFEST;
  manifestLoadPromise = null;
  cacheTimestamp = Date.now();
}

/**
 * Set model aliases for pricing lookup.
 * Merges with existing aliases.
 *
 * @example
 * ```typescript
 * import { setModelAliases } from 'tokenmeter';
 *
 * setModelAliases({
 *   "bedrock-claude-4-5-sonnet": { provider: "bedrock", model: "anthropic.claude-sonnet-4-5" },
 *   "my-custom-gpt": { provider: "openai", model: "gpt-4o" },
 * });
 * ```
 */
export function setModelAliases(aliases: Record<string, ModelAlias>): void {
  modelAliases = { ...modelAliases, ...aliases };
}

/**
 * Clear all model aliases
 */
export function clearModelAliases(): void {
  modelAliases = {};
}

/**
 * Get current model aliases
 */
export function getModelAliases(): Record<string, ModelAlias> {
  return { ...modelAliases };
}
