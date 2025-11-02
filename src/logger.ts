enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LoggerOptions {
  level?: LogLevel;
  module?: string;
}

class Logger {
  private level: LogLevel;
  private module?: string;

  private static globalLevel: LogLevel = LogLevel.INFO;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? Logger.globalLevel;
    this.module = options.module;
  }

  static setGlobalLevel(level: LogLevel) {
    Logger.globalLevel = level;
  }

  static create(module: string, level?: LogLevel): Logger {
    return new Logger({ module, level });
  }

  private formatMessage(
    level: string,
    message: string,
    ...args: unknown[]
  ): string {
    const timestamp = new Date().toISOString();
    const modulePrefix = this.module ? `[${this.module}]` : "";
    const formattedArgs =
      args.length > 0
        ? " " +
          args
            .map((arg) =>
              typeof arg === "object" ? JSON.stringify(arg) : String(arg)
            )
            .join(" ")
        : "";

    return `${timestamp} ${level} ${modulePrefix} ${message}${formattedArgs}`;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.level;
  }

  debug(message: string, ...args: unknown[]) {
    if (this.shouldLog(LogLevel.DEBUG))
      console.debug(
        this.formatMessage("\x1b[36m[DEBUG]\x1b[0m", message, ...args)
      );
  }

  info(message: string, ...args: unknown[]) {
    if (this.shouldLog(LogLevel.INFO))
      console.info(
        this.formatMessage("\x1b[32m[INFO]\x1b[0m", message, ...args)
      );
  }

  warn(message: string, ...args: unknown[]) {
    if (this.shouldLog(LogLevel.WARN))
      console.warn(
        this.formatMessage("\x1b[33m[WARN]\x1b[0m", message, ...args)
      );
  }

  error(message: string, ...args: unknown[]) {
    if (this.shouldLog(LogLevel.ERROR))
      console.error(
        this.formatMessage("\x1b[31m[ERROR]\x1b[0m", message, ...args)
      );
  }
}

// Initialize logger with environment-based log level
const logLevel = Deno.env.get("LOG_LEVEL");
if (logLevel) {
  const levelMap: Record<string, LogLevel> = {
    DEBUG: LogLevel.DEBUG,
    INFO: LogLevel.INFO,
    WARN: LogLevel.WARN,
    ERROR: LogLevel.ERROR,
  };

  if (levelMap[logLevel.toUpperCase()] !== undefined) {
    Logger.setGlobalLevel(levelMap[logLevel.toUpperCase()]);
    console.log("Global log level set to:", logLevel);
  }
}

// Create default logger instance
const logger = Logger.create("App");

export { Logger, LogLevel, logger };
