import { ConfigMan, ConfigTypes } from "./config-man";

// Config consts here
const CFG_LOG_LEVEL = "LOG_LEVEL";
const CFG_LOG_TIMESTAMP = "LOG_TIMESTAMP";
const CFG_LOG_TIMESTAMP_LOCALE = "LOG_TIMESTAMP_LOCALE";
const CFG_LOG_TIMESTAMP_TZ = "LOG_TIMESTAMP_TZ";

// Log levels
export enum LogLevel {
  COMPLETE_SILENCE = 0, // Nothing - not even fatals
  QUIET = 100, // Log nothing except fatals, errors and warnings
  INFO = 200, // Log info messages
  START_UP = 250, // Log start up (and shutdown) as well as info messages
  DEBUG = 300, // Log debug messages
  TRACE = 400, // Log trace messages
}

// Types here
export type LogConfig = {
  level: LogLevel;
  timestamp: boolean;
  timestampLocale: string;
  timestampTz: string;
};

// Logger class here
export abstract class Logger {
  protected _level: LogLevel;
  protected _timestamps: boolean;
  protected _timestampLocale: string;
  protected _timestampTz: string;

  protected _started: boolean;

  constructor(config: LogConfig) {
    this._started = false;

    // Use the configs passed in as the defaults for now
    this._level = config.level;
    this._timestamps = config.timestamp;
    this._timestampLocale = config.timestampLocale;
    this._timestampTz = config.timestampTz;
  }

  protected updateConfigs(configMan: ConfigMan): void {
    this._timestamps = <boolean>configMan.get({
      config: CFG_LOG_TIMESTAMP,
      type: ConfigTypes.Boolean,
      logTag: "",
      defaultVal: this._timestamps,
    });

    this._timestampLocale = <string>configMan.get({
      config: CFG_LOG_TIMESTAMP_LOCALE,
      type: ConfigTypes.String,
      logTag: "",
      defaultVal: this._timestampLocale,
    });

    this._timestampTz = <string>configMan.get({
      config: CFG_LOG_TIMESTAMP_TZ,
      type: ConfigTypes.String,
      logTag: "",
      defaultVal: this._timestampTz,
    });

    let logLevel = <string>configMan.get({
      config: CFG_LOG_LEVEL,
      type: ConfigTypes.String,
      logTag: "",
      defaultVal: "",
    });

    // Check if LogLevel was set and if it wasn't use default
    if (logLevel.length) {
      switch (logLevel.toUpperCase()) {
        case "SILENT":
          this._level = LogLevel.COMPLETE_SILENCE;
          break;
        case "QUIET":
          this._level = LogLevel.QUIET;
          break;
        case "INFO":
          this._level = LogLevel.INFO;
          break;
        case "STARTUP":
          this._level = LogLevel.START_UP;
          break;
        case "DEBUG":
          this._level = LogLevel.DEBUG;
          break;
        case "TRACE":
          this._level = LogLevel.TRACE;
          break;
        default:
          this._level = this._level;
          this.warn(
            `LogLevel ${logLevel} is unknown. Setting level to ${
              LogLevel[this._level]
            }.`,
          );
          break;
      }
    }
  }

  start(configMan: ConfigMan): void {
    // Override if you need to set something up before logging starts, e.g. open a file

    // Make sure you set started if you override this method
    this._started = true;
    // Also, make sure you call updateConfigs() if you override this method
    this.updateConfigs(configMan);
  }

  stop(): void {
    // Overide if you need to tidy up before exiting, e.g. close a file

    // Make sure you unset started if you override this method
    this._started = false;
  }

  abstract fatal(tag: string, ...args: any): void;
  abstract error(tag: string, ...args: any): void;
  abstract warn(tag: string, ...args: any): void;
  abstract startupMsg(tag: string, ...args: any): void;
  abstract shutdownMsg(tag: string, ...args: any): void;
  abstract info(tag: string, ...args: any): void;
  abstract debug(tag: string, ...args: any): void;
  abstract trace(tag: string, ...args: any): void;
  abstract force(tag: string, ...args: any): void;

  set level(level: LogLevel) {
    this._level = level;
  }

  set logTimestamps(log: boolean) {
    this._timestamps = log;
  }

  set logTimestampLocale(locale: string) {
    this._timestampLocale = locale;
  }

  set logTimestampTz(tz: string) {
    this._timestampTz = tz;
  }

  get started(): boolean {
    return this._started;
  }

  protected timestamp(): string {
    // If we are not supposed to generate timestamps then return nothing
    if (!this._timestamps) {
      return "";
    }

    let now = new Date();

    if (this._timestampLocale === "ISO") {
      // Make sure to add a trailing space!
      return `${now.toISOString()} `;
    }

    // Make sure to add a trailing space!
    return `${now.toLocaleString(this._timestampLocale, {
      timeZone: this._timestampTz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      fractionalSecondDigits: 3,
    })} `;
  }
}
