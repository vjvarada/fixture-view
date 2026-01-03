/**
 * Logger Service
 * 
 * Centralized logging utility that can be configured for different environments.
 * - In development: Logs to console with formatting
 * - In production: Can be configured to send to external service or suppress
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerConfig {
  /** Minimum level to log (debug < info < warn < error) */
  minLevel: LogLevel;
  /** Enable/disable all logging */
  enabled: boolean;
  /** Prefix for all log messages */
  prefix: string;
  /** Include timestamp in logs */
  includeTimestamp: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const DEFAULT_CONFIG: LoggerConfig = {
  minLevel: import.meta.env.PROD ? 'warn' : 'debug',
  enabled: true,
  prefix: '',
  includeTimestamp: false,
};

class Logger {
  private config: LoggerConfig;
  private context: string;

  constructor(context: string = '', config: Partial<LoggerConfig> = {}) {
    this.context = context;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.config.enabled) return false;
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.minLevel];
  }

  private formatMessage(level: LogLevel, message: string): string {
    const parts: string[] = [];
    
    if (this.config.includeTimestamp) {
      parts.push(`[${new Date().toISOString()}]`);
    }
    
    if (this.config.prefix) {
      parts.push(`[${this.config.prefix}]`);
    }
    
    if (this.context) {
      parts.push(`[${this.context}]`);
    }
    
    parts.push(message);
    
    return parts.join(' ');
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message), ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message), ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message), ...args);
    }
  }

  /**
   * Create a child logger with a specific context
   */
  child(context: string): Logger {
    const childContext = this.context ? `${this.context}:${context}` : context;
    return new Logger(childContext, this.config);
  }

  /**
   * Update logger configuration
   */
  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Temporarily suppress all logging (useful for tests)
   */
  suppress(): void {
    this.config.enabled = false;
  }

  /**
   * Re-enable logging after suppression
   */
  restore(): void {
    this.config.enabled = true;
  }
}

// Create context-specific loggers for different parts of the application
export const logger = new Logger();

// Pre-configured loggers for common contexts
export const performanceLogger = new Logger('Performance');
export const memoryLogger = new Logger('Memory');
export const meshLogger = new Logger('Mesh');
export const csgLogger = new Logger('CSG');
export const cavityLogger = new Logger('Cavity');
export const sceneLogger = new Logger('Scene');
export const workerLogger = new Logger('Worker');

/**
 * Create a logger for a specific component or module
 */
export function createLogger(context: string): Logger {
  return new Logger(context);
}

export { Logger };
export type { LogLevel, LoggerConfig };
