/**
 * Provider Registry
 *
 * Extensible system for registering custom AI providers.
 * Allows users to add support for new providers without modifying core code.
 */

import type { ExtractionStrategy, UsageData } from "./types.js";

/**
 * Symbol used to mark objects with their provider.
 * Allows explicit provider identification without duck-typing.
 *
 * @example
 * ```typescript
 * import { TOKENMETER_PROVIDER } from 'tokenmeter';
 *
 * const client = new CustomAIClient();
 * client[TOKENMETER_PROVIDER] = 'custom-ai';
 *
 * const monitored = monitor(client); // Will use 'custom-ai' as provider
 * ```
 */
export const TOKENMETER_PROVIDER = Symbol.for("tokenmeter.provider");

/**
 * Configuration for registering a custom provider
 */
export interface ProviderConfig {
  /** Unique provider identifier (e.g., 'google-ai', 'custom-llm') */
  name: string;

  /**
   * Function to detect if a client belongs to this provider.
   * Called during monitor() if no explicit provider is set.
   *
   * @param client - The client instance being monitored
   * @returns true if this provider should handle the client
   */
  detect?: (client: unknown) => boolean;

  /**
   * Function to extract usage data from API responses.
   *
   * @param response - The API response
   * @param args - The original arguments passed to the API call
   * @returns Usage data or null if extraction failed
   */
  extractUsage?: (
    response: unknown,
    args: unknown[],
  ) => Partial<UsageData> | null;

  /**
   * Function to extract the model name from request args or response.
   *
   * @param args - The original arguments passed to the API call
   * @param response - The API response (if available)
   * @returns Model identifier string
   */
  extractModel?: (args: unknown[], response?: unknown) => string;

  /**
   * List of method names that are factory methods returning objects to be proxied.
   * These methods won't create spans but their return values will be wrapped.
   *
   * @example ['getGenerativeModel', 'createClient', 'getModel']
   */
  factoryMethods?: string[];

  /**
   * Full extraction strategy (alternative to extractUsage/extractModel).
   * If provided, this takes precedence over extractUsage and extractModel.
   */
  strategy?: ExtractionStrategy;
}

/**
 * Internal registry storage
 */
const providerRegistry = new Map<string, ProviderConfig>();

/**
 * Register a custom provider with tokenmeter.
 *
 * This is the recommended way to add support for new AI providers
 * without modifying the core library code.
 *
 * @example
 * ```typescript
 * import { registerProvider } from 'tokenmeter';
 *
 * registerProvider({
 *   name: 'my-ai-provider',
 *   detect: (client) => 'generateText' in client && 'myProvider' in client,
 *   extractUsage: (response) => ({
 *     inputUnits: response.usage?.inputTokens,
 *     outputUnits: response.usage?.outputTokens,
 *   }),
 *   extractModel: (args) => args[0]?.model || 'unknown',
 *   factoryMethods: ['createModel'],
 * });
 *
 * // Now you can monitor your custom client
 * const client = monitor(new MyAIProvider());
 * ```
 */
export function registerProvider(config: ProviderConfig): void {
  if (!config.name) {
    throw new Error("Provider name is required");
  }

  // If strategy is not provided, create one from extractUsage/extractModel
  if (!config.strategy && config.extractUsage) {
    config.strategy = {
      provider: config.name,
      canHandle: (_methodPath: string[], result: unknown): boolean => {
        // Try to extract usage - if it succeeds, we can handle this result
        const usage = config.extractUsage!(result, []);
        return usage !== null;
      },
      extract: (
        _methodPath: string[],
        result: unknown,
        args: unknown[],
      ): UsageData | null => {
        const partialUsage = config.extractUsage!(result, args);
        if (!partialUsage) return null;

        const model = config.extractModel
          ? config.extractModel(args, result)
          : "unknown";

        return {
          provider: config.name,
          model,
          ...partialUsage,
        };
      },
    };
  }

  providerRegistry.set(config.name, config);
}

/**
 * Unregister a provider
 */
export function unregisterProvider(name: string): boolean {
  return providerRegistry.delete(name);
}

/**
 * Get a registered provider by name
 */
export function getProvider(name: string): ProviderConfig | undefined {
  return providerRegistry.get(name);
}

/**
 * Get all registered providers
 */
export function getRegisteredProviders(): ProviderConfig[] {
  return Array.from(providerRegistry.values());
}

/**
 * Clear all registered providers (useful for testing)
 */
export function clearProviderRegistry(): void {
  providerRegistry.clear();
}

/**
 * Detect provider from a client using the registry.
 * Returns the first matching provider or undefined.
 *
 * @internal
 */
export function detectProviderFromRegistry(client: unknown): string | undefined {
  // First, check for explicit Symbol-based provider
  if (
    client &&
    typeof client === "object" &&
    TOKENMETER_PROVIDER in client
  ) {
    return (client as Record<symbol, string>)[TOKENMETER_PROVIDER];
  }

  // Then check registered providers
  for (const [name, config] of providerRegistry) {
    if (config.detect && config.detect(client)) {
      return name;
    }
  }

  return undefined;
}

/**
 * Get factory methods for a provider
 *
 * @internal
 */
export function getFactoryMethods(provider: string): string[] {
  const config = providerRegistry.get(provider);
  return config?.factoryMethods || [];
}

/**
 * Get extraction strategy for a provider from the registry
 *
 * @internal
 */
export function getRegisteredStrategy(
  provider: string,
): ExtractionStrategy | undefined {
  const config = providerRegistry.get(provider);
  return config?.strategy;
}
