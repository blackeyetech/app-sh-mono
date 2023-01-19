// imports here
import { Logger, LogConfig, LogLevel } from "./logger.js";
import { LoggerConsole } from "./logger-console.js";
import { ConfigMan, ConfigTypes } from "./config-man.js";

import {
  HttpMan,
  Middleware,
  EndpointCallback,
  EndpointCallbackDetails,
  z,
} from "./http-man";

import { Pool, Dispatcher } from "undici";

import * as readline from "node:readline";

export {
  Logger,
  LogLevel,
  ConfigTypes,
  HttpMan,
  Middleware,
  EndpointCallback,
  EndpointCallbackDetails,
  z,
};

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
const DEFAULT_APP_SH_CONFIG = {
  appVersion: "N/A",
  catchExceptions: false,
  exitOnUnhandledExceptions: false,

  logLevel: LogLevel.INFO,
  logTimestamp: false,
  logTimestampFormat: "ISO",

  enableHttpMan: true,
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
export interface AppShConfig {
  appVersion?: string;
  catchExceptions?: boolean;
  exitOnUnhandledExceptions?: boolean;

  logger?: Logger;
  logLevel?: LogLevel;
  logTimestamp?: boolean;
  logTimestampFormat?: string;

  enableHttpMan?: boolean;
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

// AppSh class here
export class AppSh {
  // Properties here
  private readonly _appVersion: string;
  private readonly _appShVersion: string;

  private _configMan: ConfigMan;

  private _logger: Logger;

  private _plugins: AppShPlugin[];
  private _httpReqPools: { [key: string]: Pool };

  private _httpMan?: HttpMan;

  private _finally?: () => Promise<void>;

  // Constructor here
  constructor(appShConfig: AppShConfig) {
    // Setup all of the defaults
    let config = {
      ...DEFAULT_APP_SH_CONFIG,
      ...appShConfig,
    };

    // NOTE: APP_SH_VERSION is replaced with package.json#version by a
    // rollup plugin at build time
    this._appShVersion = "APP_SH_VERSION";

    this._appVersion = config.appVersion;
    this._plugins = [];
    this._httpReqPools = {};

    // If a logger has been past in ...
    if (config?.logger !== undefined) {
      // ... then use it
      this._logger = config.logger;
    } else {
      // ... otherwise create and use a console logger
      // NOTE: Use the defaults when creating
      let logConfig: LogConfig = {
        level: config.logLevel,
        timestamp: config.logTimestamp,
        timestampFormat: config.logTimestampFormat,
      };

      this._logger = new LoggerConsole(logConfig);
    }

    this._configMan = new ConfigMan(this._logger);

    this._logger.logTimestamps = this.getConfigBool(
      CFG_LOG_TIMESTAMP,
      config.logTimestamp,
    );

    this._logger.logTimestampFormat = this.getConfigStr(
      CFG_LOG_TIMESTAMP_FORMAT,
      config.logTimestampFormat,
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

    this.startup(`App Shell version (${this._appShVersion})`);
    this.startup(`App Version (${this._appVersion})`);
    this.startup(`NODE_ENV (${NODE_ENV})`);

    this.startup("Setting up shutdown event handlers ...");
    process.on("SIGINT", async () => await this.exit(0));
    process.on("SIGTERM", async () => await this.exit(0));
    process.on("beforeExit", async () => await this.exit(0));

    if (config.catchExceptions) {
      process.on("uncaughtException", async (e) => {
        this.error("Caught unhandled error - (%s)", e);

        if (config.exitOnUnhandledExceptions) {
          this.error("Shutting down because of unhandled error");
          await this.exit(1);
        }
      });
    }

    if (config.enableHttpMan) {
      this._httpMan = new HttpMan({ appSh: this });
    }

    this.startup("Ready to Rock and Roll baby!");
  }

  // Protected methods (that can be overridden) here
  protected async stop(): Promise<void> {
    this.shutdown("Stopped!");

    return;
  }

  // Getters here
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

  get httpMan(): HttpMan | undefined {
    return this._httpMan;
  }

  // Setters here
  set level(level: LogLevel) {
    this._logger.level = level;
  }

  // Private methods here

  // Public methods here
  finally(handler: () => Promise<void>) {
    this._finally = handler;
  }

  async shutdownError(code: number = 1, testing: boolean = false) {
    this.error("Heuston, we have a problem. Shutting down now ...");

    if (testing) {
      // Do a soft stop so we don't force any testing code to exit
      await this.exit(code, false);
      return;
    }

    await this.exit(code);
  }

  async exit(code: number, hard: boolean = true): Promise<void> {
    this.shutdown("Exiting ...");

    // Make sure we stop the HttpMan - probably best to do it first
    if (this._httpMan !== undefined) {
      await this._httpMan.stop();
    }

    // Stop the application second
    this.shutdown("Attempting to stop the application ...");
    await this.stop().catch((e) => {
      this.error(e);
    });

    // If there was a finally handler provided then call it third
    if (this._finally !== undefined) {
      this.shutdown("Calling the finally handler ...");

      await this._finally().catch((e) => {
        this.error(e);
      });
    }

    // Stop the extensions in the reverse order you started them
    for (let plugin of this._plugins.reverse()) {
      this.shutdown(`Attempting to stop plugin ${plugin.name} ...`);
      await plugin.stop().catch((e) => {
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

  addPlugin(plugin: AppShPlugin): void {
    this.startup(`Adding extension ${plugin.name}`);
    this._plugins.push(plugin);
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
    questionOptions?: QuestionOptions,
  ): Promise<string> {
    let input = process.stdin;
    let output = process.stdout;

    let options = {
      ...DEFAULT_QUESTION_OPTIONS,
      ...questionOptions,
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

  createHttpReqPool(origin: string, poolOptions?: HttpReqPoolOptions): void {
    let options = {
      ...DEFAULT_HTTP_REQ_POOL_OPTIONS,
      ...poolOptions,
    };

    this.trace(
      "Creating new HTTP pool for (%s) with options (%j)",
      origin,
      poolOptions,
    );

    if (this._httpReqPools[origin] !== undefined) {
      throw new Error(`A HTTP pool already exists for ${origin}`);
    }

    this._httpReqPools[origin] = new Pool(origin, options);
  }

  async httpReq(
    origin: string,
    path: string,
    reqOptions?: HttpReqOptions,
  ): Promise<HttpReqResponse> {
    let options = {
      ...DEFAULT_HTTP_REQ_OPTIONS,
      ...reqOptions,
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

// AppShPlugin code here

// Interfaces here
export interface AppShPluginConfig {
  name: string;
  appSh: AppSh;
}

// AppShPlugin class here
export class AppShPlugin {
  // Properties here
  private _name: string;
  private _appSh: AppSh;

  // Constructor here
  constructor(config: AppShPluginConfig) {
    this._name = config.name;
    this._appSh = config.appSh;

    this._appSh.addPlugin(this);

    this.startup("Initialising ...");
  }

  // Public methods (that can be overridden) here
  async stop(): Promise<void> {
    this.shutdown("Stopped!");

    return;
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
    return <string>this._appSh.configMan.get({
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
    return <boolean>this._appSh.configMan.get({
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
    return <number>this._appSh.configMan.get({
      config,
      type: ConfigTypes.Number,
      logTag: this._name,
      defaultVal,
      ...options,
    });
  }

  fatal(...args: any): void {
    this._appSh.logger.fatal(this._name, ...args);
  }

  error(...args: any): void {
    this._appSh.logger.error(this._name, ...args);
  }

  warn(...args: any): void {
    this._appSh.logger.warn(this._name, ...args);
  }

  info(...args: any): void {
    this._appSh.logger.info(this._name, ...args);
  }

  startup(...args: any): void {
    this._appSh.logger.startup(this._name, ...args);
  }

  shutdown(...args: any): void {
    this._appSh.logger.shutdown(this._name, ...args);
  }

  debug(...args: any): void {
    this._appSh.logger.debug(this._name, ...args);
  }

  trace(...args: any): void {
    this._appSh.logger.trace(this._name, ...args);
  }

  force(...args: any): void {
    this._appSh.logger.force(this._name, ...args);
  }

  createHttpReqPool(origin: string, poolOptions?: HttpReqPoolOptions): void {
    this._appSh.createHttpReqPool(origin, poolOptions);
  }

  async httpReq(
    origin: string,
    path: string,
    reqOptions?: HttpReqOptions,
  ): Promise<HttpReqResponse> {
    return this._appSh.httpReq(origin, path, reqOptions);
  }
}
