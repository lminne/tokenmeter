/**
 * Pricing Schema Types
 *
 * Standardized types for provider pricing catalogs.
 * These types define the structure of pricing JSON files.
 */

/**
 * Billing unit types supported across providers
 */
export type BillingUnit =
  | "tokens" // LLMs (OpenAI, Anthropic) - per 1K or 1M tokens
  | "characters" // TTS (ElevenLabs) - per 1K characters
  | "images" // Image generation (fal.ai Flux, DALL-E) - per image
  | "megapixels" // Some image models - per megapixel
  | "seconds" // Video/audio generation - per second
  | "minutes" // Audio transcription - per minute
  | "requests"; // Flat per-request pricing

/**
 * A single pricing entry with an effective date
 * Prices are per unit (e.g., per 1K tokens, per image)
 */
export interface PricingEntry {
  /** ISO 8601 date when this pricing became effective */
  effectiveDate: string;

  /** Cost per input unit (e.g., input tokens, characters) */
  input?: number;

  /** Cost per output unit (e.g., output tokens, generated images) */
  output?: number;

  /** Cost per cached input unit (prompt caching) */
  cachedInput?: number;

  /** Cost for cache creation/write (Anthropic) */
  cacheWrite?: number;

  /** Notes about this pricing change */
  notes?: string;
}

/**
 * Model definition with pricing history
 */
export interface ModelPricing {
  /** Display name for the model */
  name?: string;

  /** Billing unit for this model */
  unit: BillingUnit;

  /**
   * Unit size - what the prices are per
   * e.g., 1000 for "per 1K tokens", 1000000 for "per 1M tokens"
   * Defaults to 1000 for tokens/characters, 1 for images/seconds
   */
  unitSize?: number;

  /**
   * Pricing history, sorted by effectiveDate ascending
   * The last entry is the current pricing
   */
  pricing: PricingEntry[];

  /** Model aliases that should resolve to this model */
  aliases?: string[];

  /** Whether this model is deprecated */
  deprecated?: boolean;

  /** Deprecation date if applicable */
  deprecatedDate?: string;

  /** Replacement model if deprecated */
  replacedBy?: string;
}

/**
 * Provider pricing catalog
 */
export interface ProviderPricing {
  /** JSON schema reference */
  $schema?: string;

  /** Provider identifier */
  provider: string;

  /** Display name for the provider */
  displayName: string;

  /** URL to official pricing page */
  source: string;

  /** ISO 8601 date when this file was last updated */
  lastUpdated: string;

  /** Currency for all prices (default: USD) */
  currency?: string;

  /** Model pricing definitions, keyed by model ID */
  models: Record<string, ModelPricing>;
}

/**
 * Resolved pricing for a specific model at a point in time
 */
export interface ResolvedPricing {
  provider: string;
  model: string;
  unit: BillingUnit;
  unitSize: number;
  input: number;
  output: number;
  cachedInput?: number;
  cacheWrite?: number;
  effectiveDate: string;
}

/**
 * Get the current pricing for a model (most recent effective date)
 */
export function getCurrentPricing(model: ModelPricing): PricingEntry | null {
  if (!model.pricing || model.pricing.length === 0) {
    return null;
  }
  // Return the last entry (most recent)
  return model.pricing[model.pricing.length - 1] ?? null;
}

/**
 * Get pricing for a model at a specific date
 */
export function getPricingAtDate(
  model: ModelPricing,
  date: Date
): PricingEntry | null {
  if (!model.pricing || model.pricing.length === 0) {
    return null;
  }

  const targetTime = date.getTime();

  // Find the most recent pricing that was effective before or on the target date
  let result: PricingEntry | null = null;

  for (const entry of model.pricing) {
    const entryTime = new Date(entry.effectiveDate).getTime();
    if (entryTime <= targetTime) {
      result = entry;
    } else {
      break; // Entries are sorted, no need to continue
    }
  }

  return result;
}

/**
 * Get the default unit size for a billing unit
 */
export function getDefaultUnitSize(unit: BillingUnit): number {
  switch (unit) {
    case "tokens":
    case "characters":
      return 1000; // Per 1K
    case "images":
    case "megapixels":
    case "seconds":
    case "minutes":
    case "requests":
      return 1;
    default:
      return 1;
  }
}
