// imports here
import { AppSh, Logger } from "./app-sh.js";
import { SseServer, SseServerOptions } from "./sse-server";

import { match, MatchFunction } from "path-to-regexp";
import { z } from "zod";

import * as http from "node:http";
import * as https from "node:https";
import * as os from "node:os";
import * as fs from "node:fs";

export { SseServer, SseServerOptions };

// Types here
export type Middleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  details: EndpointCallbackDetails,
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
  middlewareList?: Middleware[];
  sseServerOptions?: SseServerOptions;
  corsOptions?: CorsOptions;
};

export type EndpointCallbackDetails = {
  url: URL;
  params: { [key: string]: unknown };
  middlewareProps: { [key: string]: unknown };
  sseServer?: SseServer;
};

export type EndpointCallback = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  details: EndpointCallbackDetails,
) => Promise<void> | void;

type MethodListElement = {
  matchFunc: MatchFunction<object>;
  callback: EndpointCallback;

  middlewareList: Middleware[];
  sseServerOptions?: SseServerOptions;
  corsOptions?: CorsOptions;
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

export type HttpConfig = {
  appSh: AppSh;

  // NOTE: The default node keep alive is 5 secs. This needs to be set
  // higher then any load balancers in front of this App
  keepAliveTimeout?: number;
  // NOTE: There is a potential race condition and the recommended
  // solution is to make the header timeouts greater then the keep alive
  // timeout. See - https://github.com/nodejs/node/issues/27363
  headerTimeout?: number;

  networkInterface?: string;
  networkPort?: number;

  healthcheckPath?: string;
  healthcheckGoodRes?: number;
  healthcheckBadRes?: number;

  enableHttps?: boolean;
};

// Config consts here
const CFG_HTTP_KEEP_ALIVE_TIMEOUT = "HTTP_KEEP_ALIVE_TIMEOUT";
const CFG_HTTP_HEADER_TIMEOUT = "HTTP_HEADER_TIMEOUT";

const CFG_HTTP_NETWORK_INTERFACE = "HTTP_NETWORK_INTERFACE";
const CFG_HTTP_NETWORK_PORT = "HTTP_NETWORK_PORT";

const CFG_HTTP_HEALTHCHECK_PATH = "HTTP_HEALTHCHECK_PATH";
const CFG_HTTP_HEALTHCHECK_GOOD_RES = "HTTP_HEALTHCHECK_GOOD_RES";
const CFG_HTTP_HEALTHCHECK_BAD_RES = "HTTP_HEALTHCHECK_BAD_RES";

const CFG_HTTP_ENABLE_HTTPS = "HTTP_ENABLE_HTTPS";
const CFG_HTTP_KEY_FILE = "HTTP_KEY_FILE";
const CFG_HTTP_CERT_FILE = "HTTP_CERT_FILE";

const HTTP_MAN_TAG = "HttpMan";

// HttpMan class here
export class HttpMan {
  private _sh: AppSh;
  private _logger: Logger;

  // private _middlewareList: Middleware[];
  private _healthcheckCallbacks: HealthcheckCallback[];
  private _methodListMap: Record<string, MethodListElement[]>;

  private _httpKeepAliveTimeout: number;
  private _httpHeaderTimeout: number;

  private _networkInterface: string;
  private _networkPort: number;
  private _enableHttps: boolean;

  private _healthCheckPath: string;
  private _healthCheckGoodResCode: number;
  private _healthCheckBadResCode: number;

  private _server?: http.Server;
  private _ip?: string;

  constructor(httpConfig: HttpConfig) {
    let config = {
      ...{
        keepAliveTimeout: 65000,
        headerTimeout: 66000,

        networkInterface: "lo",
        networkPort: 8080,

        healthcheckPath: "/healthcheck",
        healthcheckGoodRes: 200,
        healthcheckBadRes: 503,

        enableHttps: false,
      },
      ...httpConfig,
    };

    this._sh = config.appSh;
    this._logger = config.appSh.logger;
    this._enableHttps = config.enableHttps;

    this._logger.startup(HTTP_MAN_TAG, "Initialising HTTP manager ...");

    // this._middlewareList = [];
    this._healthcheckCallbacks = [];
    this._methodListMap = {};

    this._httpKeepAliveTimeout = this._sh.getConfigNum(
      CFG_HTTP_KEEP_ALIVE_TIMEOUT,
      config.keepAliveTimeout,
    );

    this._httpHeaderTimeout = this._sh.getConfigNum(
      CFG_HTTP_HEADER_TIMEOUT,
      config.headerTimeout,
    );

    this._networkInterface = this._sh.getConfigStr(
      CFG_HTTP_NETWORK_INTERFACE,
      config.networkInterface,
    );

    this._networkPort = this._sh.getConfigNum(
      CFG_HTTP_NETWORK_PORT,
      config.networkPort,
    );

    this._healthCheckPath = this._sh.getConfigStr(
      CFG_HTTP_HEALTHCHECK_PATH,
      config.healthcheckPath,
    );

    this._healthCheckGoodResCode = this._sh.getConfigNum(
      CFG_HTTP_HEALTHCHECK_GOOD_RES,
      config.healthcheckGoodRes,
    );

    this._healthCheckBadResCode = this._sh.getConfigNum(
      CFG_HTTP_HEALTHCHECK_BAD_RES,
      config.healthcheckBadRes,
    );

    this._enableHttps = this._sh.getConfigBool(
      CFG_HTTP_ENABLE_HTTPS,
      config.enableHttps,
    );

    this.setupHttpServer();

    this._logger.startup(HTTP_MAN_TAG, "Now listening. HTTP manager started!");
  }

  // Private methods here
  private setupHttpServer(): void {
    this._logger.startup(
      HTTP_MAN_TAG,
      `Finding IP for interface (${this._networkInterface})`,
    );

    let ifaces = os.networkInterfaces();
    this._logger.startup(HTTP_MAN_TAG, "Interfaces on host: %j", ifaces);

    if (ifaces[this._networkInterface] === undefined) {
      throw new Error(
        `${this._networkInterface} is not an interface on this server`,
      );
    }

    this._ip = "";

    // Search for the first I/F with a family of type IPv4
    let found = ifaces[this._networkInterface]?.find(
      (i) => i.family === "IPv4",
    );
    if (found !== undefined) {
      this._ip = found.address;
      this._logger.startup(
        HTTP_MAN_TAG,
        `Found IP (${this._ip}) for interface ${this._networkInterface}`,
      );
      this._logger.startup(
        HTTP_MAN_TAG,
        `Will listen on interface ${this._networkInterface} (IP: ${this._ip})`,
      );
    }

    if (this._ip.length === 0) {
      throw new Error(
        `${this._networkInterface} is not an interface on this server`,
      );
    }

    // Create either a HTTP or HTTPS server
    if (this._enableHttps) {
      let keyfile = this._sh.getConfigStr(CFG_HTTP_KEY_FILE);
      let certFile = this._sh.getConfigStr(CFG_HTTP_CERT_FILE);

      const options = {
        key: fs.readFileSync(keyfile),
        cert: fs.readFileSync(certFile),
      };

      this._logger.startup(
        HTTP_MAN_TAG,
        `Attempting to listen on (https://${this._ip}:${this._networkPort})`,
      );

      this._server = https
        .createServer(options, (req, res) =>
          this.handleHttpReq(req, res, "https"),
        )
        .listen(this._networkPort, this._ip);
    } else {
      this._logger.startup(
        HTTP_MAN_TAG,
        `Attempting to listen on (http://${this._ip}:${this._networkPort})`,
      );

      this._server = http
        .createServer((req, res) => this.handleHttpReq(req, res, "http"))
        .listen(this._networkPort, this._ip);
    }

    this._server.keepAliveTimeout = this._httpKeepAliveTimeout;
    this._server.headersTimeout = this._httpHeaderTimeout;

    // Now we need to add an endpoint for healthchecks
    //NOTE: This being added BEFORE any middleware
    this.endpoint("GET", this._healthCheckPath, (req, res, details) =>
      this.healthcheckCallback(req, res, details),
    );
  }

  private handlePreflightReq(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
  ): void {
    // TODO - remove
    console.log(req.method, ":", req.url);
    for (let h in req.headers) {
      console.log(h, ":", req.headers[h]);
    }

    // Get the method and origin. both MUST be available or its not valid
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
      let result = el.matchFunc(url.pathname);

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
    req: http.IncomingMessage,
    res: http.ServerResponse,
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
    req: http.IncomingMessage,
    res: http.ServerResponse,
    protocol: "http" | "https",
  ): Promise<void> {
    let url = new URL(<string>req.url, `${protocol}://${req.headers.host}`);
    let method = <Method>req.method;

    // Check for a CORS preflight request
    if (method === "OPTIONS") {
      this.handlePreflightReq(req, res, url);
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
      let result = el.matchFunc(url.pathname);

      // If result is false that means we found nothing
      if (result === false) {
        continue;
      }

      // If we are here we found a callback - process it and stop looking
      let details: EndpointCallbackDetails = {
        url,
        params: <{ [key: string]: unknown }>result.params,
        middlewareProps: {},
      };

      await this.callMiddleware(req, res, details, el, el.middlewareList);

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
    req: http.IncomingMessage,
    res: http.ServerResponse,
    details: EndpointCallbackDetails,
    el: MethodListElement,
    middlewareStack: Middleware[],
  ): Promise<void> {
    // If there is a middleware to call ...
    if (middlewareStack.length) {
      // ... then call it and pass the middlewares AFTER this in the next()
      await middlewareStack[0](req, res, details, async () => {
        await this.callMiddleware(
          req,
          res,
          details,
          el,
          middlewareStack.slice(1),
        );
      });
    } else {
      await this.callEndpoint(req, res, details, el);
    }
  }

  private async callEndpoint(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    details: EndpointCallbackDetails,
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
      details.sseServer = new SseServer(req, res, el.sseServerOptions);
    }

    // The callback can be async or not so check it out
    try {
      if (el.callback.constructor.name === "AsyncFunction") {
        // This is async so use await
        await el.callback(req, res, details);
      } else {
        // This is a synchronous call
        el.callback(req, res, details);
      }
    } catch (e) {
      if (e instanceof HttpError) {
        res.statusCode = e.status;
        res.write(e.message);
        res.end();
      }
    }
  }

  private async healthcheckCallback(
    _1: http.IncomingMessage,
    res: http.ServerResponse,
    _2: EndpointCallbackDetails,
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
      this._logger.shutdown(HTTP_MAN_TAG, "Closing HTTP manager port now ...");
      this._server.close();
      this._logger.shutdown(HTTP_MAN_TAG, "Port closed");
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
    if (options.middlewareList === undefined) {
      options.middlewareList = [];
    }

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
    let matchFunc = match(path, {
      decode: decodeURIComponent,
      strict: true,
    });

    // Finally add it to the list of callbacks
    this._methodListMap[method].push({
      matchFunc,
      callback,
      middlewareList: [...options.middlewareList],
      sseServerOptions: options.sseServerOptions,
      corsOptions: options.corsOptions,
    });

    this._logger.info(
      HTTP_MAN_TAG,
      "Added %s endpoint for path (%s)",
      method.toUpperCase(),
      path,
    );
  }

  // Middleware methods here
  static body(options: { maxBodySize?: number } = {}): Middleware {
    let opts = {
      ...{ maxBodySize: 1024 * 1024 },
      ...options,
    };

    return async (
      req: http.IncomingMessage,
      res: http.ServerResponse,
      details: EndpointCallbackDetails,
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
        // Set the body in details for the callback
        details.middlewareProps.body = Buffer.concat(chunks);

        await next();
      });
    };
  }

  static json(
    options: {
      zodInputValidator?: z.ZodTypeAny;
    } = {},
  ): Middleware {
    let opts = {
      ...options,
    };

    return async (
      req: http.IncomingMessage,
      res: http.ServerResponse,
      details: EndpointCallbackDetails,
      next: () => Promise<void>,
    ): Promise<void> => {
      // Before we do anything make sure there is a body!
      let body: Buffer | undefined;

      if (Buffer.isBuffer(details.middlewareProps.body)) {
        body = details.middlewareProps.body;
      }

      if (body === undefined || body.length === 0) {
        // Check for an input validator
        if (opts.zodInputValidator !== undefined) {
          // Since it exists we ASSUME the callback is expecting a JSON payload
          // So, run the validator and let it complain to the user
          let payload = opts.zodInputValidator.safeParse(undefined);

          if (!payload.success) {
            // Set the error message you want to return
            let errMessage = payload.error.toString();
            res.statusCode = 400;
            res.write(errMessage);
            res.end();

            return;
          }
        }

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

      if (jsonBody !== undefined && opts.zodInputValidator !== undefined) {
        let data = opts.zodInputValidator.safeParse(jsonBody);

        if (data.success) {
          // This will ensure addtional properties are only passed in if
          // the zod schema allows it
          jsonBody = data.data;
        } else {
          // Set the error message you want to return
          errMessage = data.error.toString();
          parseOk = false;
        }
      }

      // If the parsing fails then
      if (!parseOk) {
        res.statusCode = 400;
        res.write(errMessage);
        res.end();

        return;
      }

      details.middlewareProps.json = jsonBody;
      await next();
    };
  }
}
