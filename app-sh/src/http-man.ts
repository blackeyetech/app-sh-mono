// imports here
import { AppSh, Logger } from "./app-sh.js";
import { SseServer, SseServerOptions } from "./sse-server";

import * as PathToRegEx from "path-to-regexp";

import * as http from "node:http";
import * as https from "node:https";
import * as os from "node:os";
import * as fs from "node:fs";

export { SseServer, SseServerOptions };

// Types here
export interface HttpServerResponse extends http.ServerResponse {
  json?: object | [] | string | number | boolean;
  html?: string | Buffer;
  text?: string | Buffer;
}

export interface HttpServerRequest extends http.IncomingMessage {
  params: Record<string, any>;
  urlObject: URL;
  middlewareProps: Record<string, any>;

  sseServer?: SseServer;
  json?: any;
  body?: Buffer;
}

export type Middleware = (
  req: HttpServerRequest,
  res: HttpServerResponse,
  next: () => Promise<void>,
) => Promise<void>;

export type HealthcheckCallback = () => Promise<boolean>;

export type CorsOptions = {
  enable: boolean;

  originsAllowed?: "*" | string[];
  headersAllowed?: "*" | string[];
  headersExposed?: string[];
  methodsAllowed?: string[];
  credentialsAllowed?: boolean;
  maxAge?: number;
};

export type EndpointOptions = {
  noDefaultMiddlewares?: boolean;
  middlewareList?: Middleware[];
  sseServerOptions?: SseServerOptions;
  corsOptions?: CorsOptions;
};

export type EndpointCallback = (
  req: HttpServerRequest,
  res: HttpServerResponse,
) => Promise<void> | void;

type MethodListElement = {
  matchFunc: PathToRegEx.MatchFunction<object>;
  callback: EndpointCallback;

  middlewareList: Middleware[];
  sseServerOptions?: SseServerOptions;
  corsOptions?: CorsOptions;
};

export type HttpCookie = {
  name: string;
  value: string;
  maxAge?: number;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

export class HttpError {
  status: number;
  message: string;

  constructor(status: number, message: string) {
    this.status = status;
    this.message = message;
  }
}

export class HttpConfigError {
  message: string;

  constructor(message: string) {
    this.message = message;
  }
}

export type HttpConfig = {
  loggerTag?: string;

  // NOTE: The default node keep alive is 5 secs. This needs to be set
  // higher then any load balancers in front of this App
  keepAliveTimeout?: number;
  // NOTE: There is a potential race condition and the recommended
  // solution is to make the header timeouts greater then the keep alive
  // timeout. See - https://github.com/nodejs/node/issues/27363
  headerTimeout?: number;

  healthcheckPath?: string;
  healthcheckGoodRes?: number;
  healthcheckBadRes?: number;

  enableHttps?: boolean;
  httpsKeyFile?: string;
  httpsCertFile?: string;

  defaultMiddlewareList?: Middleware[];
};

// HttpMan class here
export class HttpMan {
  private _networkInterface: string;
  private _networkPort: number;
  private _networkIp: string;
  private _baseUrl: string;

  private _loggerTag: string;
  private _logger: Logger;
  private _healthcheckCallbacks: HealthcheckCallback[];
  private _methodListMap: Record<string, MethodListElement[]>;

  private _httpKeepAliveTimeout: number;
  private _httpHeaderTimeout: number;

  private _healthCheckPath: string;
  private _healthCheckGoodResCode: number;
  private _healthCheckBadResCode: number;

  private _enableHttps: boolean;
  private _keyFile?: string;
  private _certFile?: string;

  private _defaultMiddlewareList: Middleware[];

  private _server?: http.Server;

  constructor(
    appSh: AppSh,
    networkInterface: string,
    networkPort: number,
    httpConfig: HttpConfig = {},
  ) {
    let config = {
      loggerTag: `HttpMan-${networkInterface}-${networkPort}`,

      keepAliveTimeout: 65000,
      headerTimeout: 66000,

      healthcheckPath: "/healthcheck",
      healthcheckGoodRes: 200,
      healthcheckBadRes: 503,

      enableHttps: false,

      defaultMiddlewareList: [],

      ...httpConfig,
    };

    this._networkIp = "";
    this._baseUrl = ";";

    this._logger = appSh.logger;
    this._loggerTag = config.loggerTag;

    this._logger.startupMsg(this._loggerTag, "Initialising HTTP manager ...");

    this._networkInterface = networkInterface;
    this._networkPort = networkPort;

    this._healthcheckCallbacks = [];
    this._methodListMap = {};

    this._httpKeepAliveTimeout = config.keepAliveTimeout;
    this._httpHeaderTimeout = config.headerTimeout;

    this._healthCheckPath = config.healthcheckPath;
    this._healthCheckGoodResCode = config.healthcheckGoodRes;
    this._healthCheckBadResCode = config.healthcheckBadRes;

    this._enableHttps = config.enableHttps;

    if (this._enableHttps) {
      this._keyFile = config.httpsKeyFile;
      this._certFile = config.httpsCertFile;
    }

    this._defaultMiddlewareList = config.defaultMiddlewareList;

    this.setupHttpServer();

    this._logger.startupMsg(
      this._loggerTag,
      "Now listening. HTTP manager started!",
    );
  }

  // Getter methods here
  get networkIp(): string {
    return this._networkIp;
  }

  get networkPort(): number {
    return this._networkPort;
  }

  get baseUrl(): string {
    return this._baseUrl;
  }

  get httpsEnabled(): boolean {
    return this._enableHttps;
  }

  // Private methods here
  private setupHttpServer(): void {
    this._logger.startupMsg(
      this._loggerTag,
      `Finding IP for interface (${this._networkInterface})`,
    );

    let ifaces = os.networkInterfaces();
    this._logger.startupMsg(this._loggerTag, "Interfaces on host: %j", ifaces);

    if (ifaces[this._networkInterface] === undefined) {
      throw new Error(
        `${this._networkInterface} is not an interface on this server`,
      );
    }

    this._networkIp = "";

    // Search for the first I/F with a family of type IPv4
    let found = ifaces[this._networkInterface]?.find(
      (i) => i.family === "IPv4",
    );
    if (found !== undefined) {
      this._networkIp = found.address;
      this._logger.startupMsg(
        this._loggerTag,
        `Found IP (${this._networkIp}) for interface ${this._networkInterface}`,
      );
      this._logger.startupMsg(
        this._loggerTag,
        `Will listen on interface ${this._networkInterface} (IP: ${this._networkIp})`,
      );
    }

    if (this._networkIp.length === 0) {
      throw new Error(
        `${this._networkInterface} is not an interface on this server`,
      );
    }

    // Create either a HTTP or HTTPS server
    if (this._enableHttps) {
      this._baseUrl = `https://${this._networkIp}:${this._networkPort}`;

      if (this._keyFile === undefined) {
        throw new HttpConfigError("HTTPS is enabled but no key file provided!");
      }
      if (this._certFile === undefined) {
        throw new HttpConfigError(
          "HTTPS is enabled but no cert file provided!",
        );
      }

      const options = {
        key: fs.readFileSync(this._keyFile),
        cert: fs.readFileSync(this._certFile),
      };

      this._logger.startupMsg(
        this._loggerTag,
        `Attempting to listen on (${this._baseUrl})`,
      );

      this._server = https
        .createServer(options, (req, res) =>
          this.handleHttpReq(req, res, "https"),
        )
        .listen(this._networkPort, this._networkIp);
    } else {
      this._baseUrl = `http://${this._networkIp}:${this._networkPort}`;

      this._logger.startupMsg(
        this._loggerTag,
        `Attempting to listen on (${this._baseUrl})`,
      );

      this._server = http
        .createServer((req, res) => this.handleHttpReq(req, res, "http"))
        .listen(this._networkPort, this._networkIp);
    }

    this._server.keepAliveTimeout = this._httpKeepAliveTimeout;
    this._server.headersTimeout = this._httpHeaderTimeout;

    // Now we need to add an endpoint for healthchecks
    this.endpoint("GET", this._healthCheckPath, (req, res) =>
      this.healthcheckCallback(req, res),
    );
  }

  private handlePreflightReq(
    req: HttpServerRequest,
    res: HttpServerResponse,
  ): void {
    // Get the method and origin. Both MUST be available or its not valid
    let method = req.headers["access-control-request-method"];
    let origin = req.headers["origin"];

    if (method === undefined || origin === undefined) {
      res.statusCode = 400;
      res.end();
      return;
    }

    // First, make sure we have registered callbacks for req method
    let list = this._methodListMap[method];

    // No list mean no callbacks for that method, i.e. it's unknown
    if (list === undefined) {
      res.statusCode = 404;
      res.end();
      return;
    }

    // Next see if we have a registered callback for the HTTP req path
    let foundEl: MethodListElement | undefined;

    for (let el of list) {
      let result = el.matchFunc(req.urlObject.pathname);

      // If result is false that means we found nothing
      if (result === false) {
        continue;
      }

      foundEl = el;
      break;
    }

    // If found is still false then we know there is no registered callback
    if (foundEl === undefined) {
      res.statusCode = 404;
      res.end();
      return;
    }

    this.setCorsHeaders(req, res, foundEl, origin);

    res.statusCode = 204;
    res.end();
  }

  private setCorsHeaders(
    req: HttpServerRequest,
    res: HttpServerResponse,
    foundEl: MethodListElement,
    origin: string,
  ) {
    let corsOpts = foundEl.corsOptions;

    // If we are here we found a callback - check that CORS is enabled
    if (corsOpts?.enable !== true) {
      // It isn't so set no headers - the browser will handle the rest
      res.statusCode = 204;
      res.end();
      return;
    }

    // Access-Control-Allow-Origin
    if (
      corsOpts.originsAllowed === "*" ||
      corsOpts.originsAllowed?.includes(origin)
    ) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }

    // Access-Control-Allow-Headers
    let reqHeaders = req.headers["access-control-request-headers"];

    if (reqHeaders !== undefined) {
      // If we allow any header then return the headers sent by client
      if (corsOpts.headersAllowed === "*") {
        res.setHeader("Access-Control-Allow-Headers", reqHeaders);
      } else if (corsOpts.headersAllowed !== undefined) {
        res.setHeader(
          "Access-Control-Allow-Headers",
          corsOpts.headersAllowed.join(","),
        );
      }
    }

    // Access-Control-Expose-Headers
    if (
      corsOpts.headersExposed !== undefined &&
      corsOpts.headersExposed.length
    ) {
      res.setHeader(
        "Access-Control-Expose-Headers",
        corsOpts.headersExposed.join(","),
      );
    }

    // Access-Control-Allow-Methods
    if (corsOpts.methodsAllowed !== undefined) {
      res.setHeader(
        "Access-Control-Allow-Methods",
        corsOpts.methodsAllowed.join(","),
      );
    }

    // Access-Control-Max-Age
    if (corsOpts.maxAge !== undefined) {
      res.setHeader("Access-Control-Max-Age", corsOpts.maxAge);
    }

    // Access-Control-Allow-Credentials
    if (corsOpts.credentialsAllowed) {
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
  }

  private async handleHttpReq(
    origReq: http.IncomingMessage,
    res: HttpServerResponse,
    protocol: "http" | "https",
  ): Promise<void> {
    // Convert the incoming message to our type so we can add our extra props
    let req = origReq as HttpServerRequest;

    req.urlObject = new URL(
      <string>req.url,
      `${protocol}://${req.headers.host}`,
    );
    req.params = {};
    req.middlewareProps = {};

    let method = <Method>req.method;

    // Check for a CORS preflight request
    if (method === "OPTIONS") {
      this.handlePreflightReq(req, res);
      return;
    }

    // First, make sure we have registered callbacks for req method
    let list = this._methodListMap[method];

    // No list mean no callbacks for that method, i.e. it's unknown
    if (list === undefined) {
      res.statusCode = 404;
      res.end();
      return;
    }

    // Next see if we have a registered callback for the HTTP req path
    let found = false;

    for (let el of list) {
      let result = el.matchFunc(req.urlObject.pathname);

      // If result is false that means we found nothing
      if (result === false) {
        continue;
      }

      // Don't forget to set the url parameters
      req.params = result.params;

      // If we are here we found a callback - process it and stop looking
      await this.callMiddleware(req, res, el, el.middlewareList);

      found = true;
      break;
    }

    // If found is still false then we know there is no registered callback
    if (!found) {
      res.statusCode = 404;
      res.end();
    }
  }

  private async callMiddleware(
    req: HttpServerRequest,
    res: HttpServerResponse,
    el: MethodListElement,
    middlewareStack: Middleware[],
  ): Promise<void> {
    // If there is a middleware to call ...
    if (middlewareStack.length) {
      // ... then call it and pass the middlewares AFTER this in the next()
      await middlewareStack[0](req, res, async () => {
        await this.callMiddleware(req, res, el, middlewareStack.slice(1));
      });
    } else {
      await this.callEndpoint(req, res, el);
    }
  }

  private async callEndpoint(
    req: HttpServerRequest,
    res: HttpServerResponse,
    el: MethodListElement,
  ): Promise<void> {
    // Handle CORS request if it is enabled
    let corsOpts = el.corsOptions;
    let origin = req.headers["origin"];

    if (origin !== undefined && corsOpts?.enable === true) {
      if (corsOpts?.credentialsAllowed === true) {
        res.setHeader("Access-Control-Allow-Credentials", "true");
      }

      if (
        corsOpts?.originsAllowed === "*" ||
        corsOpts?.originsAllowed?.includes(origin)
      ) {
        res.setHeader("Access-Control-Allow-Origin", origin);
      }
    }

    // Check if this should be a server sent event endpoint
    if (el.sseServerOptions !== undefined) {
      req.sseServer = new SseServer(req, res, el.sseServerOptions);
    }

    // The callback can be async or not so check for it
    try {
      if (el.callback.constructor.name === "AsyncFunction") {
        // This is async so use await
        await el.callback(req, res);
      } else {
        // This is a synchronous call
        el.callback(req, res);
      }

      // Now see if the user wants us to handle their response
      this.handleUserResponse(res);
    } catch (e) {
      // If it is a HttpError assume the error message has already been logged
      if (e instanceof HttpError) {
        res.statusCode = e.status;
        res.write(e.message);
      } else {
        // We don't know what this is so log it and make sure to retrun a 500
        this._logger.error(
          this._loggerTag,
          "Unknown error happened while handling URL (%s) - (%s)",
          req.urlObject?.pathname,
          e,
        );

        res.statusCode = 500;
        res.write("Unknown error happened");
      }

      // Make sure to close the connection
      res.end();
    }
  }

  private handleUserResponse(res: HttpServerResponse) {
    // Check if the user wants to return a JSON payload
    if (res.json !== undefined) {
      let body = JSON.stringify(res.json);

      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("content-length", Buffer.byteLength(body));
      res.write(body);
      res.end();

      return;
    }

    // Check if the user wants to return HTML
    if (res.html !== undefined) {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("content-length", Buffer.byteLength(res.html));
      res.write(res.html);
      res.end();

      return;
    }

    // Check if the user wants to return just plain olde text
    if (res.text !== undefined) {
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.setHeader("content-length", Buffer.byteLength(res.text));
      res.write(res.text);
      res.end();

      return;
    }
  }

  private async healthcheckCallback(
    _1: HttpServerRequest,
    res: HttpServerResponse,
  ): Promise<void> {
    let healthy = true;

    for (let cb of this._healthcheckCallbacks) {
      healthy = await cb();

      if (!healthy) {
        break;
      }
    }

    if (healthy) {
      res.statusCode = this._healthCheckGoodResCode;
    } else {
      res.statusCode = this._healthCheckBadResCode;
    }

    res.end();
  }

  // Public methods here
  async stop(): Promise<void> {
    if (this._server !== undefined) {
      this._logger.shutdownMsg(
        this._loggerTag,
        "Closing HTTP manager port now ...",
      );
      this._server.close();
      this._logger.shutdownMsg(this._loggerTag, "Port closed");
    }

    return;
  }

  healthcheck(callback: HealthcheckCallback) {
    this._healthcheckCallbacks.push(callback);
  }

  endpoint(
    method: Method,
    path: string,
    callback: EndpointCallback,
    options: EndpointOptions = {},
  ) {
    if (options.corsOptions?.enable) {
      options.corsOptions = {
        // Defaults first
        originsAllowed: "*",
        headersAllowed: "*",
        headersExposed: [],
        methodsAllowed: ["GET", "PUT", "POST", "DELETE", "PATCH"],
        credentialsAllowed: false,
        maxAge: 86400,

        ...options.corsOptions,
      };
    }

    // Make sure we have a list for the method first
    if (this._methodListMap[method] === undefined) {
      this._methodListMap[method] = [];
    }

    // Then create the matching function
    let matchFunc = PathToRegEx.match(path, {
      decode: decodeURIComponent,
      strict: true,
    });

    // Make sure we have the middlewares requested
    let middlewareList: Middleware[] = [];

    // Check if the user DID NOT ask for no default middlewares
    if (options.noDefaultMiddlewares !== true) {
      // ... stick the default middlewares in first
      middlewareList = [...this._defaultMiddlewareList];
    }

    if (options.middlewareList !== undefined) {
      middlewareList = [...middlewareList, ...options.middlewareList];
    }

    // Finally add it to the list of callbacks
    this._methodListMap[method].push({
      matchFunc,
      callback,
      middlewareList,
      sseServerOptions: options.sseServerOptions,
      corsOptions: options.corsOptions,
    });

    this._logger.info(
      this._loggerTag,
      "Added %s endpoint for path (%s)",
      method.toUpperCase(),
      path,
    );
  }

  setCookies(res: HttpServerResponse, cookies: HttpCookie[]) {
    let setCookiesValue: string[] = [];

    // Loop through each cookie and build the cookie values
    for (let cookie of cookies) {
      // Set the cookie value first
      let value = `${cookie.name}=${cookie.value}`;

      // if there is a maxAge then set it - NOTE: put ";" first
      if (cookie.maxAge !== undefined) {
        value += `; Max-Age=${cookie.maxAge}`;
      }
      // If there is a path then set it or use default path of "/" - NOTE: put ";" first
      if (cookie.path !== undefined) {
        value += `; Path=${cookie.path}`;
      } else {
        value += `; Path=/`;
      }
      // If httpOnly is indicated then add it - NOTE: put ";" first
      if (cookie.httpOnly === true) {
        value += "; HttpOnly";
      }
      // If secure is indicated set then add it - NOTE: put ";" first
      if (cookie.secure === true) {
        value += "; Secure";
      }
      // If sameSite has been provided then add it - NOTE: put ";" first
      if (cookie.sameSite !== undefined) {
        value += `; SameSite=${cookie.sameSite}`;
      }

      // Save the cookie
      setCookiesValue.push(value);
    }

    // Finally set the cookie/s in the response header
    res.setHeader("Set-Cookie", setCookiesValue);
  }

  clearCookies(res: HttpServerResponse, cookies: string[]) {
    let httpCookies: HttpCookie[] = [];

    for (let cookie of cookies) {
      // To clear a cookie - set value to empty string and max age to -1
      httpCookies.push({ name: cookie, value: "", maxAge: -1 });
    }

    this.setCookies(res, httpCookies);
  }

  // Middleware methods here
  static body(options: { maxBodySize?: number } = {}): Middleware {
    let opts = {
      maxBodySize: 1024 * 1024,
      ...options,
    };

    return async (
      req: HttpServerRequest,
      res: HttpServerResponse,
      next: () => Promise<void>,
    ): Promise<void> => {
      // Store each data "chunk" we receive this array
      let chunks: Buffer[] = [];
      let bodySize = 0;

      // This event fires when there is a chunk of the body received
      req.on("data", (chunk: Buffer) => {
        bodySize += chunk.byteLength;

        if (bodySize >= opts.maxBodySize) {
          // The body is too big so flag to user and remvoe all of the listeners
          res.statusCode = 400;
          res.write(`Body length greater than ${opts.maxBodySize} bytes`);
          res.end();

          // May be overkill but do it anyway
          req.removeAllListeners("data");
          req.removeAllListeners("end");
        } else {
          chunks.push(chunk);
        }
      });

      // This event fires when we have received all of the body
      req.on("end", async () => {
        // Set the body in the req for the callback
        req.body = Buffer.concat(chunks);

        await next();
      });
    };
  }

  static json(): Middleware {
    return async (
      req: HttpServerRequest,
      res: HttpServerResponse,
      next: () => Promise<void>,
    ): Promise<void> => {
      // Before we do anything make sure there is a body!
      let body: Buffer | undefined;

      if (Buffer.isBuffer(req.body)) {
        body = req.body;
      }

      if (body === undefined || body.length === 0) {
        // No body to parse so call next middleware and then return
        await next();
        return;
      }

      let jsonBody: any;
      let parseOk = true;
      let errMessage = "";

      // Now check the content-type header to find out what sort of data we have
      const contentTypeHeader = req.headers["content-type"];

      if (contentTypeHeader !== undefined) {
        let contentType = contentTypeHeader.split(";")[0];

        switch (contentType) {
          case "application/json":
            try {
              jsonBody = JSON.parse(body.toString());
            } catch (_) {
              // Set the error message you want to return
              errMessage = "Can not parse JSON body!";

              parseOk = false;
            }
            break;
          case "application/x-www-form-urlencoded":
            let qry = new URLSearchParams(body.toString());
            jsonBody = {};

            for (let [key, value] of qry.entries()) {
              jsonBody[key] = value;
            }
            break;
          default:
            break;
        }
      }

      // If the parsing failed then return an error
      if (!parseOk) {
        res.statusCode = 400;
        res.write(errMessage);
        res.end();

        return;
      }

      req.json = jsonBody;
      await next();
    };
  }
}
