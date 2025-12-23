#!/usr/bin/env npx tsx
/**
 * Build script to generate bundled pricing manifest from JSON files.
 *
 * This creates a synchronously-importable TypeScript file with all pricing data
 * embedded, ensuring cost calculation is always available without network requests.
 *
 * Usage: npx tsx scripts/build-manifest.ts
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Types matching the runtime format
interface ModelPricing {
  input?: number;
  output?: number;
  cost?: number;
  unit: string;
  cachedInput?: number;
  cachedOutput?: number;
  cacheWrite?: number;
  cacheRead?: number;
}

interface ProviderPricing {
  [modelId: string]: ModelPricing;
}

interface PricingManifest {
  version: string;
  updatedAt: string;
  providers: {
    [providerId: string]: ProviderPricing;
  };
}

// Source JSON structure
interface ProviderJSON {
  provider: string;
  models: Record<
    string,
    {
      unit?: string;
      unitSize?: number;
      aliases?: string[];
      pricing?: Array<{
        input?: number;
        output?: number;
        cachedInput?: number;
        cachedOutput?: number;
        cacheWrite?: number;
        cacheRead?: number;
        cost?: number;
      }>;
    }
  >;
}

// Default pricing units per provider
const DEFAULT_UNITS: Record<string, string> = {
  openai: "1m_tokens",
  anthropic: "1m_tokens",
  "google-ai-studio": "1m_tokens",
  "google-vertex": "1m_tokens",
  bedrock: "1m_tokens",
  elevenlabs: "1k_characters",
  fal: "request",
  bfl: "image",
};

/**
 * Convert unit from JSON format to runtime format
 */
function convertUnit(jsonUnit?: string, unitSize?: number): string {
  if (!jsonUnit) return "1m_tokens";

  switch (jsonUnit) {
    case "tokens":
      return unitSize === 1000 ? "1k_tokens" : "1m_tokens";
    case "characters":
      return "1k_characters";
    case "images":
    case "image":
      return "image";
    case "seconds":
    case "second":
      return "second";
    case "minutes":
    case "minute":
      return "minute";
    case "megapixels":
    case "megapixel":
      return "megapixel";
    case "requests":
    case "request":
      return "request";
    default:
      return "1m_tokens";
  }
}

/**
 * Convert a provider JSON file to runtime format
 */
function convertProvider(
  providerData: ProviderJSON,
  defaultUnit: string
): ProviderPricing {
  const pricing: ProviderPricing = {};

  for (const [modelId, model] of Object.entries(providerData.models)) {
    if (!model.pricing || model.pricing.length === 0) continue;

    // Get the most recent pricing entry
    const currentPricing = model.pricing[model.pricing.length - 1];
    if (!currentPricing) continue;

    const unit = convertUnit(model.unit, model.unitSize) || defaultUnit;

    const modelPricing: ModelPricing = {
      unit,
    };

    // Only include defined values
    if (currentPricing.input !== undefined)
      modelPricing.input = currentPricing.input;
    if (currentPricing.output !== undefined)
      modelPricing.output = currentPricing.output;
    if (currentPricing.cachedInput !== undefined)
      modelPricing.cachedInput = currentPricing.cachedInput;
    if (currentPricing.cachedOutput !== undefined)
      modelPricing.cachedOutput = currentPricing.cachedOutput;
    if (currentPricing.cacheWrite !== undefined)
      modelPricing.cacheWrite = currentPricing.cacheWrite;
    if (currentPricing.cacheRead !== undefined)
      modelPricing.cacheRead = currentPricing.cacheRead;
    if (currentPricing.cost !== undefined)
      modelPricing.cost = currentPricing.cost;

    pricing[modelId] = modelPricing;

    // Also add aliases
    if (model.aliases) {
      for (const alias of model.aliases) {
        pricing[alias] = modelPricing;
      }
    }
  }

  return pricing;
}

/**
 * Build the complete manifest from all provider JSON files
 */
function buildManifest(): PricingManifest {
  const providersDir = path.join(__dirname, "../src/pricing/providers");
  const manifest: PricingManifest = {
    version: "1.0.0",
    updatedAt: new Date().toISOString(),
    providers: {},
  };

  // Read all JSON files from the providers directory
  const files = fs.readdirSync(providersDir).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    const filePath = path.join(providersDir, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const providerData: ProviderJSON = JSON.parse(content);

    const providerId = providerData.provider;
    const defaultUnit = DEFAULT_UNITS[providerId] || "1m_tokens";

    manifest.providers[providerId] = convertProvider(providerData, defaultUnit);
  }

  return manifest;
}

/**
 * Generate the TypeScript output file
 */
function generateTypeScript(manifest: PricingManifest): string {
  const json = JSON.stringify(manifest, null, 2);

  return `/**
 * Bundled Pricing Manifest
 *
 * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 * Generated at: ${manifest.updatedAt}
 *
 * This file contains all pricing data embedded for synchronous access.
 * Regenerate with: npx tsx scripts/build-manifest.ts
 */

import type { PricingManifest } from "../types.js";

/**
 * Bundled pricing manifest with all provider data.
 * Always available synchronously - no network requests needed.
 */
export const BUNDLED_MANIFEST: PricingManifest = ${json} as const;

/**
 * Version of the bundled manifest
 */
export const BUNDLED_VERSION = "${manifest.version}";

/**
 * Timestamp when the manifest was bundled
 */
export const BUNDLED_AT = "${manifest.updatedAt}";
`;
}

// Main execution
function main() {
  console.log("Building bundled pricing manifest...");

  const manifest = buildManifest();

  const providerCount = Object.keys(manifest.providers).length;
  const modelCount = Object.values(manifest.providers).reduce(
    (sum, p) => sum + Object.keys(p).length,
    0
  );

  console.log(`  Providers: ${providerCount}`);
  console.log(`  Models (including aliases): ${modelCount}`);

  const output = generateTypeScript(manifest);
  const outputPath = path.join(__dirname, "../src/pricing/manifest.bundled.ts");

  fs.writeFileSync(outputPath, output, "utf-8");

  console.log(`  Output: ${outputPath}`);
  console.log("Done!");
}

main();

