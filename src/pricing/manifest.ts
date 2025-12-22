/**
 * Pricing Manifest Fetcher
 *
 * Remote-first pricing with local fallback for reliability.
 * Fetches latest pricing from CDN, falls back to bundled data if unavailable.
 */

import type {
  PricingManifest,
  ModelPricing,
  ProviderPricing,
  PricingUnit,
} from "../types.js";
import { logger } from "../logger.js";

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

// Cache for the loaded manifest
let cachedManifest: PricingManifest | null = null;
let manifestLoadPromise: Promise<PricingManifest> | null = null;
let cacheTimestamp: number | null = null;

/**
 * Configure global pricing settings.
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
 * Build a manifest from the bundled provider JSON files (local fallback)
 */
async function buildLocalManifest(): Promise<PricingManifest> {
  // Import existing provider pricing files
  const [
    openaiPricing,
    anthropicPricing,
    googlePricing,
    elevenlabsPricing,
    falPricing,
    bedrockPricing,
    bflPricing,
  ] = await Promise.all([
    import("./providers/openai.json", { with: { type: "json" } }),
    import("./providers/anthropic.json", { with: { type: "json" } }),
    import("./providers/google.json", { with: { type: "json" } }),
    import("./providers/elevenlabs.json", { with: { type: "json" } }),
    import("./providers/fal.json", { with: { type: "json" } }),
    import("./providers/bedrock.json", { with: { type: "json" } }),
    import("./providers/bfl.json", { with: { type: "json" } }),
  ]);

  // Convert to manifest format
  const manifest: PricingManifest = {
    version: "1.0.0",
    updatedAt: new Date().toISOString(),
    providers: {},
  };

  // Helper to convert old format to new format
  const convertProvider = (
    providerData: { models: Record<string, unknown> },
    defaultUnit: PricingUnit,
  ): ProviderPricing => {
    const pricing: ProviderPricing = {};

    for (const [modelId, model] of Object.entries(providerData.models)) {
      const m = model as {
        unit?: string;
        aliases?: string[];
        pricing?: Array<{
          input?: number;
          output?: number;
          cachedInput?: number;
          cost?: number;
        }>;
      };

      if (!m.pricing || m.pricing.length === 0) continue;

      const currentPricing = m.pricing[m.pricing.length - 1];
      if (!currentPricing) continue;

      // Map old units to new units
      let unit: PricingUnit = defaultUnit;
      if (m.unit === "tokens") unit = "1m_tokens";
      else if (m.unit === "characters") unit = "1k_characters";
      else if (m.unit === "images") unit = "image";
      else if (m.unit === "seconds") unit = "second";
      else if (m.unit === "minutes") unit = "minute";
      else if (m.unit === "megapixels") unit = "megapixel";
      else if (m.unit === "requests") unit = "request";

      const modelPricing: ModelPricing = {
        input: currentPricing.input,
        output: currentPricing.output,
        cachedInput: currentPricing.cachedInput,
        cost: currentPricing.cost,
        unit,
      };

      pricing[modelId] = modelPricing;

      // Also add aliases
      if (m.aliases) {
        for (const alias of m.aliases) {
          pricing[alias] = modelPricing;
        }
      }
    }

    return pricing;
  };

  manifest.providers.openai = convertProvider(
    openaiPricing.default,
    "1m_tokens",
  );
  manifest.providers.anthropic = convertProvider(
    anthropicPricing.default,
    "1m_tokens",
  );
  manifest.providers.google = convertProvider(
    googlePricing.default,
    "1m_tokens",
  );
  manifest.providers.elevenlabs = convertProvider(
    elevenlabsPricing.default,
    "1k_characters",
  );
  manifest.providers.fal = convertProvider(falPricing.default, "request");
  manifest.providers.bedrock = convertProvider(
    bedrockPricing.default,
    "1m_tokens",
  );
  manifest.providers.bfl = convertProvider(bflPricing.default, "image");

  return manifest;
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
 * Fetches from Pricing API first, then CDN, with automatic fallback
 * to bundled local data if all remote sources are unavailable.
 *
 * @param options.apiUrl - Override the API URL
 * @param options.cdnUrl - Override the CDN URL
 * @param options.manifestUrl - Legacy: Override the manifest URL (deprecated)
 * @param options.forceRefresh - Force reload even if cached
 * @param options.offlineMode - Skip remote fetch, use local only
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
  const isCacheValid =
    cachedManifest &&
    cacheTimestamp &&
    Date.now() - cacheTimestamp < cacheTimeout;

  // Return cached if available, valid, and not forcing refresh
  if (isCacheValid && !config.forceRefresh) {
    return cachedManifest!;
  }

  // If already loading, wait for that
  if (manifestLoadPromise && !config.forceRefresh) {
    return manifestLoadPromise;
  }

  manifestLoadPromise = (async () => {
    // If offline mode, skip remote fetch
    if (config.offlineMode) {
      logger.debug("Offline mode enabled, using bundled pricing");
      cachedManifest = await buildLocalManifest();
      cacheTimestamp = Date.now();
      return cachedManifest;
    }

    const timeout = config.fetchTimeout ?? 5000;

    // Try Pricing API first
    const apiUrl = config.apiUrl || DEFAULT_API_URL;
    try {
      cachedManifest = await fetchFromAPI(apiUrl, timeout);
      cacheTimestamp = Date.now();
      logger.info("Loaded pricing manifest from API");
      return cachedManifest;
    } catch (apiError) {
      logger.debug("API unavailable, trying CDN:", apiError);
    }

    // Try CDN as fallback
    const cdnUrl = config.cdnUrl || config.manifestUrl || DEFAULT_CDN_URL;
    try {
      cachedManifest = await fetchRemoteManifest(cdnUrl, timeout);
      cacheTimestamp = Date.now();
      logger.info("Loaded pricing manifest from CDN");
      return cachedManifest;
    } catch (cdnError) {
      logger.debug("CDN unavailable, using bundled pricing:", cdnError);
    }

    // Fallback to local bundled pricing
    logger.warn("All remote sources unavailable, using bundled pricing");
    cachedManifest = await buildLocalManifest();
    cacheTimestamp = Date.now();
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
  const alias = modelAliases[model];
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
 * Calculate cost based on usage and pricing
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

  // Get the divisor based on unit
  const getDivisor = (unit: string): number => {
    switch (unit) {
      case "1m_tokens":
        return 1_000_000;
      case "1k_tokens":
      case "1k_characters":
        return 1_000;
      default:
        return 1;
    }
  };

  const divisor = getDivisor(pricing.unit);

  // Flat cost (request-based pricing)
  if (pricing.cost !== undefined) {
    cost += pricing.cost;
  }

  // Input cost
  if (usage.inputUnits !== undefined && pricing.input !== undefined) {
    cost += (usage.inputUnits / divisor) * pricing.input;
  }

  // Output cost
  if (usage.outputUnits !== undefined && pricing.output !== undefined) {
    cost += (usage.outputUnits / divisor) * pricing.output;
  }

  // Cached input cost
  if (
    usage.cachedInputUnits !== undefined &&
    pricing.cachedInput !== undefined
  ) {
    cost += (usage.cachedInputUnits / divisor) * pricing.cachedInput;
  }

  return cost;
}

/**
 * Get the cached manifest (or null if not loaded)
 */
export function getCachedManifest(): PricingManifest | null {
  return cachedManifest;
}

/**
 * Clear the manifest cache
 */
export function clearManifestCache(): void {
  cachedManifest = null;
  manifestLoadPromise = null;
  cacheTimestamp = null;
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
export function setModelAliases(
  aliases: Record<string, ModelAlias>,
): void {
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
