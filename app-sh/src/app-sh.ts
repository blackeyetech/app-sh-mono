// imports here
import { Logger, LogConfig, LogLevel } from "./logger.js";
import { LoggerConsole } from "./logger-console.js";
import { ConfigMan, ConfigTypes } from "./config-man.js";

import {
  HttpMan,
  Middleware,
  EndpointCallback,
  EndpointCallbackDetails,
  HttpConfig,
  HttpError,
  HttpConfigError,
} from "./http-man";

import * as readline from "node:readline";

export {
  Logger,
  LogLevel,
  ConfigTypes,
  HttpMan,
  Middleware,
  EndpointCallback,
  EndpointCallbackDetails,
  HttpConfig,
  HttpError,
  HttpConfigError,
};

// Misc consts here
const NODE_ENV =
  process.env.NODE_ENV === undefined ? "development" : process.env.NODE_ENV;

const LOGGER_APP_NAME = "App";

// Types here
export type ConfigOptions = {
  cmdLineFlag?: string;
  silent?: boolean;
  redact?: boolean;
};

export type AppShConfig = {
  appVersion?: string;
  catchExceptions?: boolean;
  exitOnUnhandledExceptions?: boolean;

  logger?: Logger;
  logLevel?: LogLevel;
  logTimestamp?: boolean;
  logTimestampLocale?: string;
  logTimestampTz?: string;
};

export type QuestionOptions = {
  muteAnswer?: boolean;
  muteChar?: string;
};

export type HttpReqResponse = {
  statusCode: number;
  headers: Headers;
  body: any;
};

export type HttpReqOptions = {
  method: "GET" | "PUT" | "POST" | "DELETE" | "PATCH";
  searchParams?: Record<string, string>;
  headers?: Record<string, string>;
  body?: object | [] | string;
  auth?: {
    username: string;
    password: string;
  };
  bearerToken?: string;
  timeout?: number;

  // These are additional options for fetch
  keepalive?: boolean;
  cache?: RequestCache;
  credentials?: RequestCredentials;
  mode?: RequestMode;
  redirect?: RequestRedirect;
  referrer?: string;
  referrerPolicy?: ReferrerPolicy;
  signal?: AbortSignal;
};

// Error classes here
export class HttpReqAborted {
  public timedOut: boolean;
  public message: string;

  constructor(timedOut: boolean, message: string) {
    this.timedOut = timedOut;
    this.message = message;
  }
}

export class HttpReqError {
  public status: number;
  public message: string;

  constructor(status: number, message: string) {
    this.status = status;
    this.message = message;
  }
}

// AppSh class here
export class AppSh {
  // Properties here
  private readonly _appVersion: string;
  private readonly _appShVersion: string;

  private _configMan: ConfigMan;

  private _logger: Logger;

  private _plugins: {
    plugin: AppShPlugin;
    stopMethod: () => Promise<void>;
  }[];

  private _httpManList: HttpMan[];

  private _finally?: () => Promise<void>;

  // Constructor here
  constructor(appShConfig: AppShConfig) {
    // Setup all of the defaults
    let config = {
      appVersion: "N/A",
      catchExceptions: false,
      exitOnUnhandledExceptions: false,

      logLevel: LogLevel.INFO,
      logTimestamp: false,
      logTimestampLocale: "ISO",
      logTimestampTz: "UTC",

      ...appShConfig,
    };

    // NOTE: APP_SH_VERSION is replaced with package.json#version by a
    // rollup plugin at build time
    this._appShVersion = "APP_SH_VERSION";

    this._appVersion = config.appVersion;
    this._plugins = [];
    this._httpManList = [];

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
        timestampLocale: config.logTimestampLocale,
        timestampTz: config.logTimestampTz,
      };

      this._logger = new LoggerConsole(logConfig);
    }

    this._configMan = new ConfigMan(this._logger);

    // Start the logger now
    this._logger.start(this._configMan);

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

  // Setters here
  set logLevel(level: LogLevel) {
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

    // Make sure we stop all of the HttpMan - probably best to do it first
    for (let httpMan of this._httpManList) {
      await httpMan.stop();
    }

    // Stop the application second
    this.shutdown("Attempting to stop the application ...");
    await this.stop().catch((e) => {
      this.error(e);
    });

    // If there was a finally handler provided then call it third
    if (this._finally !== undefined) {
      this.shutdown("Calling the 'finally handler' ...");

      await this._finally().catch((e) => {
        this.error(e);
      });
    }

    // Stop the extensions in the reverse order you started them
    for (let plugin of this._plugins.reverse()) {
      this.shutdown(`Attempting to stop plugin ${plugin.plugin.name} ...`);
      await plugin.stopMethod().catch((e) => {
        this.error(e);
      });
    }

    this.shutdown("So long and thanks for all the fish!");

    this._logger.stop();

    // Check if the exit should also exit the process (a hard stop)
    if (hard) {
      process.exit(code);
    }
  }

  addHttpMan(
    networkInterface: string,
    networkPort: number,
    httpConfig: HttpConfig = {},
  ): HttpMan {
    let httpMan = new HttpMan(this, networkInterface, networkPort, httpConfig);

    this._httpManList.push(httpMan);

    return httpMan;
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
    this._logger.startupMsg(LOGGER_APP_NAME, ...args);
  }

  shutdown(...args: any): void {
    this._logger.shutdownMsg(LOGGER_APP_NAME, ...args);
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

  addPlugin(plugin: AppShPlugin, stopMethod: () => Promise<void>): void {
    this.startup(`Adding plugin ${plugin.name}`);
    this._plugins.push({ plugin, stopMethod });
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
      muteAnswer: false,
      muteChar: "*",

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

  async httpReq(
    origin: string,
    path: string,
    reqOptions?: HttpReqOptions,
  ): Promise<HttpReqResponse> {
    let options = {
      method: "GET",
      headers: {},
      timmeout: 0,
      keepalive: true,
      cache: <RequestCache>"no-store",
      mode: <RequestMode>"cors",
      credentials: <RequestCredentials>"include",
      redirect: <RequestRedirect>"follow",
      referrerPolicy: <ReferrerPolicy>"no-referrer",

      ...reqOptions,
    };

    this.trace("httpReq for origin (%s) path (%s)", origin, path);

    // If a bearer token is provided then add a Bearer auth header
    if (options.bearerToken !== undefined) {
      options.headers.Authorization = `Bearer ${options.bearerToken}`;
    }

    // If the basic auth creds are provided add a Basic auth header
    if (options.auth !== undefined) {
      let token = Buffer.from(
        `${options.auth.username}:${options.auth.password}`,
      ).toString("base64");
      options.headers.Authorization = `Basic ${token}`;
    }

    let body: string | undefined;

    // Automatically stringify and set the header if this is a JSON payload
    // BUT dont do it for GETs and DELETE since they can have no body
    if (
      options.body !== undefined &&
      options.method !== "GET" &&
      options.method !== "DELETE"
    ) {
      // Rem an array is an object to!
      if (typeof options.body === "object") {
        // Add the content-type if it hasn't been provided
        if (options.headers?.["content-type"] === undefined) {
          options.headers["content-type"] = "application/json; charset=utf-8";
        }

        body = JSON.stringify(options.body);
      } else {
        body = options.body;
      }
    }

    // NODE_TLS_REJECT_UNAUTHORIZED=0

    // Build the url
    let url = `${origin}${path}`;
    // And add the query string if one has been provided
    if (options.searchParams !== undefined) {
      url += `?${new URLSearchParams(options.searchParams)}`;
    }

    let timeoutTimer: NodeJS.Timer | undefined;

    // Create an AbortController if a timeout has been provided
    if (options.timeout) {
      const controller = new AbortController();

      // NOTE: this will overwrite a signal if one has been provided
      options.signal = controller.signal;

      timeoutTimer = setTimeout(() => {
        controller.abort();
      }, options.timeout * 1000);
    }

    let results = await fetch(url, {
      method: options.method,
      headers: options.headers,
      body,
      keepalive: options.keepalive,
      cache: options.cache,
      credentials: options.credentials,
      mode: options.mode,
      redirect: options.redirect,
      referrer: options.referrer,
      referrerPolicy: options.referrerPolicy,
      signal: options.signal,
    }).catch((e) => {
      // Check if the request was aborted
      if (e.name === "AbortError") {
        // If timeout was set then the req must have timed out
        if (options.timeout) {
          throw new HttpReqAborted(
            true,
            `Request timeout out after ${options.timeout} seconds`,
          );
        }

        throw new HttpReqAborted(false, "Request aborted");
      }

      // Need to check if we started a timeout
      if (timeoutTimer !== undefined) {
        clearTimeout(timeoutTimer);
      }

      // We don't know what the error is so pass it back
      throw e;
    });

    // Need to check if we started a timeout
    if (timeoutTimer !== undefined) {
      clearTimeout(timeoutTimer);
    }

    if (!results.ok) {
      let message = await results.text();

      throw new HttpReqError(
        results.status,
        message.length === 0 ? results.statusText : message,
      );
    }

    let resData: object | string;

    // Safest way to check for a body is the content-length header exists
    // and is not "0" (no need to convert to a number)
    let contentExists = false;
    if (
      results.headers.get("content-length") !== undefined &&
      results.headers.get("content-length") !== "0"
    ) {
      contentExists = true;
    }

    // Only convert to json if there is content otherwise .json() will throw
    if (
      contentExists &&
      results.headers.get("content-type")?.startsWith("application/json") ===
        true
    ) {
      resData = await results.json();
    } else {
      resData = await results.text();
      // If the string has length then let's check the content-type again for
      // json data - sometimes the server isn't setting the content-length ...
      if (
        resData.length &&
        results.headers.get("content-type")?.startsWith("application/json") ===
          true
      ) {
        resData = JSON.parse(resData);
      }
    }

    return {
      statusCode: results.status,
      headers: results.headers,
      body: resData,
    };
  }
}

// AppShPlugin code here

// Types here
export type AppShPluginConfig = {
  name: string;
  appSh: AppSh;
  pluginVersion: string;
};

// AppShPlugin class here
export class AppShPlugin {
  // Properties here
  private _name: string;
  protected _appSh: AppSh;
  private _pluginVersion: string;

  // Constructor here
  constructor(config: AppShPluginConfig) {
    this._name = config.name;
    this._appSh = config.appSh;
    this._pluginVersion = config.pluginVersion;

    this._appSh.addPlugin(this, async () => {
      this.stop();
    });

    this.startupMsg("Initialising ...");
  }

  // Protected methods (that can be overridden) here
  protected async stop(): Promise<void> {
    // This is a default stop method. Override it if you need to clean up
    this.shutdownMsg("Stopped!");
  }

  // Getters here
  get name(): string {
    return this._name;
  }

  get pluginVersion(): string {
    return this._pluginVersion;
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

  startupMsg(...args: any): void {
    this._appSh.logger.startupMsg(this._name, ...args);
  }

  shutdownMsg(...args: any): void {
    this._appSh.logger.shutdownMsg(this._name, ...args);
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

  async httpReq(
    origin: string,
    path: string,
    reqOptions?: HttpReqOptions,
  ): Promise<HttpReqResponse> {
    return this._appSh.httpReq(origin, path, reqOptions);
  }
}
