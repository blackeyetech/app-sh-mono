// imports here
import { Logger, LogConfig, LogLevel } from "./logger.js";
import { LoggerConsole } from "./logger-console.js";
import { ConfigMan, ConfigTypes } from "./config-man.js";
// import { ShellPlugin, ShellPluginConfig } from "./shell-plugin.js";

import { Pool, Dispatcher } from "undici";

import * as readline from "node:readline";

export { Logger, LogLevel, ConfigTypes };

// Interfaces here
export interface ConfigOptions {
  cmdLineFlag?: string;
  silent?: boolean;
  redact?: boolean;
}

// Config consts here
const CFG_LOG_LEVEL = "LOG_LEVEL";
const CFG_LOG_TIMESTAMP = "LOG_TIMESTAMP";
const CFG_LOG_TIMESTAMP_FORMAT = "LOG_TIMESTAMP_FORMAT";

// Default configs here
const DEFAULT_SHELL_CONFIG = {
  appVersion: "N/A",
  log: {
    level: LogLevel.INFO,
    timestamp: false,
    timestampFormat: "ISO",
  },
};

const DEFAULT_QUESTION_OPTIONS = {
  muteAnswer: false,
  muteChar: "*",
};

const DEFAULT_HTTP_REQ_POOL_OPTIONS = {};

const DEFAULT_HTTP_REQ_OPTIONS: HttpReqOptions = {
  method: "GET",
};

// Misc consts here
const NODE_ENV =
  process.env.NODE_ENV === undefined ? "development" : process.env.NODE_ENV;

const LOGGER_APP_NAME = "App";

// Interfaces here
export interface ShellConfig {
  name: string;
  appVersion?: string;
  log?: {
    logger?: Logger;
    level?: LogLevel;
    timestamp?: boolean;
    timestampFormat?: string;
  };
}

export interface QuestionOptions {
  muteAnswer?: boolean;
  muteChar?: string;
}

export interface HttpReqPoolOptions extends Pool.Options {}

export interface HttpReqResponse {
  statusCode: number;
  headers: { [key: string]: string | string[] | undefined };
  trailers: { [key: string]: string };
  body: string | object;
}

export interface HttpReqOptions {
  method: "GET" | "PUT" | "POST" | "DELETE" | "PATCH";
  searchParams?: { [key: string]: string | string[] };
  headers?: { [key: string]: string };
  body?: object | string;
  auth?: {
    username: string;
    password: string;
  };
  bearerToken?: string;
}

// Shell class here
export class Shell {
  // Properties here
  private readonly _name: string;
  private readonly _appVersion: string;
  private readonly _appShVersion: string;

  private _configMan: ConfigMan;

  private _logger: Logger;

  private _plugins: ShellPlugin[];
  private _httpReqPools: { [key: string]: Pool };

  // Constructor here
  constructor(passedConfig: ShellConfig) {
    // Setup all of the defaults
    let config = {
      name: passedConfig.name,
      appVersion:
        passedConfig.appVersion === undefined
          ? DEFAULT_SHELL_CONFIG.appVersion
          : passedConfig.appVersion,
      log: {
        ...DEFAULT_SHELL_CONFIG.log,
        ...passedConfig.log,
      },
    };

    // NOTE: APP_SH_VERSION is replaced with package.json#version by a
    // rollup plugin at build time
    this._appShVersion = "APP_SH_VERSION";

    this._name = config.name;
    this._appVersion = config.appVersion;
    this._plugins = [];
    this._httpReqPools = {};

    // If a logger has been past in ...
    if (config.log?.logger !== undefined) {
      // ... then use it
      this._logger = config.log.logger;
    } else {
      // ... otherwise create and use a console logger
      // NOTE: Use the defaults when creating
      let logConfig: LogConfig = {
        level: config.log.level,
        timestamp: config.log.timestamp,
        timestampFormat: config.log.timestampFormat,
      };

      this._logger = new LoggerConsole(logConfig);
    }

    this._configMan = new ConfigMan(this._logger);

    this._logger.logTimestamps = this.getConfigBool(
      CFG_LOG_TIMESTAMP,
      config.log.timestamp,
    );

    this._logger.logTimestampFormat = this.getConfigStr(
      CFG_LOG_TIMESTAMP_FORMAT,
      config.log.timestampFormat,
    );

    let logLevel = this.getConfigStr(CFG_LOG_LEVEL, "");

    // Check if LogLevel was set, if so set it
    if (logLevel.length > 0) {
      switch (logLevel.toUpperCase()) {
        case "SILENT":
          this._logger.level = LogLevel.COMPLETE_SILENCE;
          break;
        case "QUIET":
          this._logger.level = LogLevel.QUIET;
          break;
        case "INFO":
          this._logger.level = LogLevel.INFO;
          break;
        case "STARTUP":
          this._logger.level = LogLevel.START_UP;
          break;
        case "DEBUG":
          this._logger.level = LogLevel.DEBUG;
          break;
        case "TRACE":
          this._logger.level = LogLevel.TRACE;
          break;
        default:
          this._logger.level = LogLevel.INFO;
          this._logger.warn(
            `LogLevel ${logLevel} is unknown. Setting level to INFO.`,
          );
          break;
      }
    }

    // Start the logger now
    this._logger.start();

    this.startup(`Shell version (${this._appShVersion}) created!`);
  }

  // Protected methods (that should be overridden) here
  protected async start(): Promise<boolean> {
    this.startup("Started!");

    return true;
  }
  protected async stop(): Promise<void> {
    this.shutdown("Stopped!");

    return;
  }
  protected async healthCheck(): Promise<boolean> {
    this.debug("Health check called");

    return true;
  }

  // Getters here
  get name(): string {
    return this._name;
  }

  get appShVersion(): string {
    return this._appShVersion;
  }

  get appVersion(): string {
    return this._appVersion;
  }

  get logger(): Logger {
    return this._logger;
  }

  get configMan(): ConfigMan {
    return this._configMan;
  }

  // Setters here
  set level(level: LogLevel) {
    this._logger.level = level;
  }

  // Private methods here
  private async startupError(code: number, testing: boolean) {
    this.error("Heuston, we have a problem. Shutting down now ...");

    if (testing) {
      // Do a soft stop so we don't force any testing code to exit
      await this.exit(code, false);
      return;
    }

    await this.exit(code);
  }

  // Public methods here
  async init(testing: boolean = false) {
    this.startup("Initialising ...");

    // this.startup(`CN-Shell Version (${CN_VERSION})`);
    this.startup(`App Version (${this._appVersion})`);
    this.startup(`NODE_ENV (${NODE_ENV})`);

    // NB: start the extensions first in case the app needs them to start up
    for (let ext of this._plugins) {
      this.startup(`Attempting to start extension ${ext.name} ...`);

      await ext.start().catch(async (e) => {
        this.error(e);

        // This will exit the app
        await this.startupError(-1, testing);
      });
    }

    this.startup("Attempting to start the application ...");

    await this.start().catch(async (e) => {
      this.error(e);

      // This will exit the app
      await this.startupError(-1, testing);
    });

    this.startup("Setting up event handler for SIGINT and SIGTERM");
    process.on("SIGINT", async () => await this.exit(0));
    process.on("SIGTERM", async () => await this.exit(0));

    this.startup("Ready to Rock and Roll baby!");
  }

  async exit(code: number, hard: boolean = true): Promise<void> {
    this.shutdown("Exiting ...");

    // Stop the application before the extensions
    this.shutdown("Attempting to stop the application ...");
    await this.stop().catch((e) => {
      this.error(e);
    });

    // Stop the extensions in the reverse order you started them
    for (let ext of this._plugins.reverse()) {
      this.shutdown(`Attempting to stop extension ${ext.name} ...`);
      await ext.stop().catch((e) => {
        this.error(e);
      });
    }

    // Clear down the pools
    for (let origin in this._httpReqPools) {
      this._httpReqPools[origin].destroy();
    }

    this.shutdown("So long and thanks for all the fish!");

    this._logger.stop();

    // Check if the exit should also exit the process (a hard stop)
    if (hard) {
      process.exit(code);
    }
  }

  // Config helper methods here
  getConfigStr(
    config: string,
    defaultVal?: string,
    options?: ConfigOptions,
  ): string {
    // This either returns a string or it throws
    return <string>this._configMan.get({
      config,
      type: ConfigTypes.String,
      logTag: LOGGER_APP_NAME,
      defaultVal,
      ...options,
    });
  }

  getConfigBool(
    config: string,
    defaultVal?: boolean,
    options?: ConfigOptions,
  ): boolean {
    // This either returns a bool or it throws
    return <boolean>this._configMan.get({
      config,
      type: ConfigTypes.Boolean,
      logTag: LOGGER_APP_NAME,
      defaultVal,
      ...options,
    });
  }

  getConfigNum(
    config: string,
    defaultVal?: number,
    options?: ConfigOptions,
  ): number {
    // This either returns a number or it throws
    return <number>this._configMan.get({
      config,
      type: ConfigTypes.Number,
      logTag: LOGGER_APP_NAME,
      defaultVal,
      ...options,
    });
  }

  // Log helper methods here
  fatal(...args: any): void {
    this._logger.fatal(LOGGER_APP_NAME, ...args);
  }

  error(...args: any): void {
    this._logger.error(LOGGER_APP_NAME, ...args);
  }

  warn(...args: any): void {
    this._logger.warn(LOGGER_APP_NAME, ...args);
  }

  info(...args: any): void {
    this._logger.info(LOGGER_APP_NAME, ...args);
  }

  startup(...args: any): void {
    this._logger.startup(LOGGER_APP_NAME, ...args);
  }

  shutdown(...args: any): void {
    this._logger.shutdown(LOGGER_APP_NAME, ...args);
  }

  debug(...args: any): void {
    this._logger.debug(LOGGER_APP_NAME, ...args);
  }

  trace(...args: any): void {
    this._logger.trace(LOGGER_APP_NAME, ...args);
  }

  force(...args: any): void {
    this._logger.force(LOGGER_APP_NAME, ...args);
  }

  addPlugin(ext: ShellPlugin): void {
    this.startup(`Adding extension ${ext.name}`);
    this._plugins.push(ext);
  }

  async sleep(durationInSeconds: number): Promise<void> {
    // Convert duration to ms
    let ms = Math.round(durationInSeconds * 1000);

    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  async question(
    ask: string,
    passedOptions?: QuestionOptions,
  ): Promise<string> {
    let input = process.stdin;
    let output = process.stdout;

    let options = {
      ...DEFAULT_QUESTION_OPTIONS,
      ...passedOptions,
    };
    return new Promise((resolve) => {
      let rl = readline.createInterface({
        input,
        output,
      });

      if (options.muteAnswer) {
        input.on("keypress", () => {
          // get the number of characters entered so far:
          var len = rl.line.length;

          if (options.muteChar.length === 0) {
            // move cursor back one since we will always be at the start
            readline.moveCursor(output, -1, 0);
            // clear everything to the right of the cursor
            readline.clearLine(output, 1);
          } else {
            // move cursor back to the beginning of the input
            readline.moveCursor(output, -len, 0);
            // clear everything to the right of the cursor
            readline.clearLine(output, 1);

            // If there is a muteChar then replace the original input with it
            for (var i = 0; i < len; i++) {
              // In case the user passes a string just use the 1st char
              output.write(options.muteChar[0]);
            }
          }
        });
      }

      rl.question(ask, (answer) => {
        resolve(answer);
        rl.close();
      });
    });
  }

  createHttpReqPool(origin: string, passedOptions?: HttpReqPoolOptions): void {
    let options = {
      ...DEFAULT_HTTP_REQ_POOL_OPTIONS,
      ...passedOptions,
    };

    this.trace(
      "Creating new HTTP pool for (%s) with options (%j)",
      origin,
      passedOptions,
    );

    if (this._httpReqPools[origin] !== undefined) {
      throw new Error(`A HTTP pool already exists for ${origin}`);
    }

    this._httpReqPools[origin] = new Pool(origin, options);
  }

  async httpReq(
    origin: string,
    path: string,
    passedOptions?: HttpReqOptions,
  ): Promise<HttpReqResponse> {
    let options = {
      ...DEFAULT_HTTP_REQ_OPTIONS,
      ...passedOptions,
    };

    this.trace("httpReq for origin (%s) path (%s)", origin, path);

    let pool = this._httpReqPools[origin];

    // If the pool doesn't exist then create one for the origin with defaults
    if (pool === undefined) {
      this.createHttpReqPool(origin);
      pool = this._httpReqPools[origin];
    }

    let headers = options.headers === undefined ? {} : options.headers;

    // If a bearer token is provided then add a Bearer auth header
    if (options.bearerToken !== undefined) {
      headers.Authorization = `Bearer ${options.bearerToken}`;
    }

    // If the basic auth creds are provided add a Basic auth header
    if (options.auth !== undefined) {
      let token = Buffer.from(
        `${options.auth.username}:${options.auth.password}`,
      ).toString("base64");
      headers.Authorization = `Basic ${token}`;
    }

    let body: string | undefined;

    if (options.body !== undefined && options.method !== "GET") {
      // If there is no content-type specifed then we assume
      // this is a json payload, however if the body is an object
      // then we know it is a json payload even if the
      // content-type was set
      if (
        options.headers?.["content-type"] === undefined ||
        typeof options.body === "object"
      ) {
        headers["content-type"] = "application/json; charset=utf-8";
        body = JSON.stringify(options.body);
      } else {
        body = options.body;
      }
    }

    let results = await pool.request({
      origin,
      path,
      method: <Dispatcher.HttpMethod>options.method,
      headers,
      query: options.searchParams,
      body,
    });

    let resData: object | string;

    // Safest way to check for a body is the content-length header exists
    // and is not "0" (no need to convert to a number)
    let contentExists = false;
    if (
      results.headers["content-length"] !== undefined &&
      results.headers["content-length"] !== "0"
    ) {
      contentExists = true;
    }

    // Only convert to json if there is content otherwise .json() will throw
    if (
      contentExists &&
      results.headers["content-type"]?.startsWith("application/json") === true
    ) {
      resData = await results.body.json();
    } else {
      resData = await results.body.text();
      // If the string has length then let's check the content-type again for
      // json data - sometimes the server isn't setting the content-length ...
      if (
        resData.length &&
        results.headers["content-type"]?.startsWith("application/json") === true
      ) {
        resData = JSON.parse(resData);
      }
    }

    let res: HttpReqResponse = {
      statusCode: results.statusCode,
      headers: results.headers,
      trailers: results.trailers,
      body: resData,
    };

    return res;
  }
}

// ShellPlugin code here

// Interfaces here
export interface ShellPluginConfig {
  name: string;
  shell: Shell;
}

// ShellPlugin class here
export class ShellPlugin {
  // Properties here
  private _name: string;
  private _shell: Shell;

  // Constructor here
  constructor(config: ShellPluginConfig) {
    this._name = config.name;
    this._shell = config.shell;

    this._shell.addPlugin(this);

    this.startup("Initialising ...");
  }

  // Protected methods (that should be overridden) here
  async start(): Promise<boolean> {
    this.startup("Started!");

    return true;
  }
  async stop(): Promise<void> {
    this.shutdown("Stopped!");

    return;
  }
  async healthCheck(): Promise<boolean> {
    this.debug("Health check called");

    return true;
  }

  // Getters here
  get name(): string {
    return this._name;
  }

  // Private methods here

  // Public methods here
  getConfigStr(
    config: string,
    defaultVal?: string,
    options?: ConfigOptions,
  ): string {
    // This either returns a string or it throws
    return <string>this._shell.configMan.get({
      config,
      type: ConfigTypes.String,
      logTag: this._name,
      defaultVal,
      ...options,
    });
  }

  getConfigBool(
    config: string,
    defaultVal?: boolean,
    options?: ConfigOptions,
  ): boolean {
    // This either returns a bool or it throws
    return <boolean>this._shell.configMan.get({
      config,
      type: ConfigTypes.Boolean,
      logTag: this._name,
      defaultVal,
      ...options,
    });
  }

  getConfigNum(
    config: string,
    defaultVal?: number,
    options?: ConfigOptions,
  ): number {
    // This either returns a number or it throws
    return <number>this._shell.configMan.get({
      config,
      type: ConfigTypes.Number,
      logTag: this._name,
      defaultVal,
      ...options,
    });
  }

  fatal(...args: any): void {
    this._shell.logger.fatal(this._name, ...args);
  }

  error(...args: any): void {
    this._shell.logger.error(this._name, ...args);
  }

  warn(...args: any): void {
    this._shell.logger.warn(this._name, ...args);
  }

  info(...args: any): void {
    this._shell.logger.info(this._name, ...args);
  }

  startup(...args: any): void {
    this._shell.logger.startup(this._name, ...args);
  }

  shutdown(...args: any): void {
    this._shell.logger.shutdown(this._name, ...args);
  }

  debug(...args: any): void {
    this._shell.logger.debug(this._name, ...args);
  }

  trace(...args: any): void {
    this._shell.logger.trace(this._name, ...args);
  }

  force(...args: any): void {
    this._shell.logger.force(this._name, ...args);
  }

  createHttpReqPool(origin: string, passedOptions?: HttpReqPoolOptions): void {
    this._shell.createHttpReqPool(origin, passedOptions);
  }

  async httpReq(
    origin: string,
    path: string,
    passedOptions?: HttpReqOptions,
  ): Promise<HttpReqResponse> {
    return this._shell.httpReq(origin, path, passedOptions);
  }
}
