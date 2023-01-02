import dayjs from "dayjs";

// Log levels
export enum LogLevel {
  COMPLETE_SILENCE = 0, // Nothing - not even fatals
  QUIET = 100, // Log nothing except fatals, errors and warnings
  INFO = 200, // Log info messages
  START_UP = 250, // Log start up (and shutdown) as well as info messages
  DEBUG = 300, // Log debug messages
  TRACE = 400, // Log trace messages
}

// Interfaces here
export interface LogConfig {
  level: LogLevel;
  timestamp: boolean;
  timestampFormat: string;
}

// Logger class here
export abstract class Logger {
  protected _level: LogLevel;
  protected _logTimestamps: boolean;
  protected _logTimestampFormat: string; // Empty string means use ISO format

  protected _started: boolean;

  constructor(config: LogConfig) {
    this._started = false;

    this._level = config.level;
    this._logTimestamps = config.timestamp;
    this._logTimestampFormat = config.timestampFormat;
  }

  start(): void {
    // Override if you need to set something up before logging starts, e.g. open a file
    this._started = true;
    return;
  }

  stop(): void {
    // Overide if you need to tidy up before exiting, e.g. close a file
    this._started = false;
    return;
  }

  abstract fatal(tag: string, ...args: any): void;
  abstract error(tag: string, ...args: any): void;
  abstract warn(tag: string, ...args: any): void;
  abstract startup(tag: string, ...args: any): void;
  abstract shutdown(tag: string, ...args: any): void;
  abstract info(tag: string, ...args: any): void;
  abstract debug(tag: string, ...args: any): void;
  abstract trace(tag: string, ...args: any): void;
  abstract force(tag: string, ...args: any): void;

  set level(level: LogLevel) {
    this._level = level;
  }

  set logTimestamps(logTimestamps: boolean) {
    this._logTimestamps = logTimestamps;
  }

  set logTimestampFormat(timestampFormat: string) {
    this._logTimestampFormat = timestampFormat;
  }

  get started(): boolean {
    return this._started;
  }

  protected timestamp(): string {
    // If we are not supposed to generate timestamps then return nothing
    if (this._logTimestamps === false) {
      return "";
    }

    let now = new Date();

    if (this._logTimestampFormat === "ISO") {
      return now.toISOString();
    }

    // Make sure to add a trailing space!
    return `${dayjs(now).format(this._logTimestampFormat)} `;
  }
}
