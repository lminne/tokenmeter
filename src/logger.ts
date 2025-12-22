/**
 * Configurable Logger
 *
 * Provides a centralized logging mechanism that can be configured or disabled.
 * By default, logging is disabled in production to avoid polluting stdout.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "none";

export interface LoggerConfig {
  /**
   * Minimum log level to output. Set to "none" to disable all logging.
   * @default "none"
   */
  level: LogLevel;

  /**
   * Custom logger implementation. If provided, all logs will be sent to this function.
   * This allows integration with existing logging frameworks (winston, pino, etc.)
   */
  custom?: (level: LogLevel, message: string, ...args: unknown[]) => void;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4,
};

// Global configuration - defaults to disabled
let config: LoggerConfig = {
  level: "none",
};

/**
 * Configure the tokenmeter logger.
 *
 * @example
 * ```typescript
 * import { configureLogger } from 'tokenmeter';
 *
 * // Enable warning and error logs
 * configureLogger({ level: 'warn' });
 *
 * // Use custom logger
 * configureLogger({
 *   level: 'debug',
 *   custom: (level, message, ...args) => {
 *     myLogger[level](message, ...args);
 *   }
 * });
 * ```
 */
export function configureLogger(newConfig: Partial<LoggerConfig>): void {
  config = { ...config, ...newConfig };
}

/**
 * Get the current logger configuration.
 */
export function getLoggerConfig(): LoggerConfig {
  return { ...config };
}

/**
 * Reset logger to default configuration (disabled).
 */
export function resetLogger(): void {
  config = { level: "none" };
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[config.level];
}

function log(level: LogLevel, message: string, ...args: unknown[]): void {
  if (!shouldLog(level)) {
    return;
  }

  const formattedMessage = `[tokenmeter] ${message}`;

  if (config.custom) {
    config.custom(level, formattedMessage, ...args);
    return;
  }

  switch (level) {
    case "debug":
      console.debug(formattedMessage, ...args);
      break;
    case "info":
      console.info(formattedMessage, ...args);
      break;
    case "warn":
      console.warn(formattedMessage, ...args);
      break;
    case "error":
      console.error(formattedMessage, ...args);
      break;
  }
}

/**
 * Internal logger for tokenmeter.
 * By default, all logging is disabled. Use configureLogger() to enable.
 */
export const logger = {
  debug: (message: string, ...args: unknown[]) => log("debug", message, ...args),
  info: (message: string, ...args: unknown[]) => log("info", message, ...args),
  warn: (message: string, ...args: unknown[]) => log("warn", message, ...args),
  error: (message: string, ...args: unknown[]) => log("error", message, ...args),
};
