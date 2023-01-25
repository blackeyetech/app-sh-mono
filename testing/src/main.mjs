import { AppSh, LogLevel, z, HttpMan, HttpError } from "app-sh";

import * as http from "node:http";

// process.on("uncaughtException", (e) => {
//   sh.error("caught %s)", e);
//   // sh.exit(1);
// });

class App extends AppSh {
  constructor() {
    super({
      enableHttpMan: true,
      logLevel: LogLevel.TRACE,
      logTimestampLocale: "en-us",
      logTimestampTz: "EET",
      logTimestamp: true,
      catchExceptions: true,
      exitOnUnhandledExceptions: false,
    });
  }

  async stop() {
    this.shutdown("Bye 1!");
  }
}

let sh = new App();

sh.finally(async () => {
  sh.shutdown("Bye 2!");
});

sh.info("Hello world");

// let b = $.getConfigBool({ config: "XXX", defaultVal: true });
// $.info("Bool (%j)", b);
// let s = $.getConfigStr({ config: "XXX", defaultVal: "" });
// $.info("String (%j)", s);
let def = undefined;
let n = sh.getConfigNum("XXX", 1, { cmdLineFlag: "x" });
sh.info("XXX (%j)", n);

// let res = await sh.httpReq("https://google.com", "/search");
// let i = c / 0;

// sh.info("%j", res.body);
// let answer = await sh.question("Hit return to continue?");
// sh.info("You are doing %s", answer);

// sh.shutdownError();

sh.trace("Traced!");

let httpMan = sh.httpMan;

httpMan.healthcheck(() => {
  sh.info("Helllo!!!");
  return true;
});
// sh.sleep(2);

let middleware1 = async (req, res, details, next) => {
  let now = new Date().valueOf();
  sh.info("in the middle of one");
  // details.body = Buffer.from("howdy");
  await next();
  let time = new Date().valueOf() - now;
  sh.info("finished the middle one - %s", time);
};

let middleware2 = async (req, res, details, next) => {
  sh.info("in the middle of two");
  await next();
  sh.info("finished the middle two");
};

// sh.httpMan.addMiddleware(async (req, res, details, next) => {
//   sh.info("in the middle of three");
//   // await sh.sleep(5);
//   await next();
//   sh.info("finished the middle three");
// });

const User = z.object({
  a: z.string(),
  b: z.string(),
});

sh.httpMan.endpoint(
  "POST",
  "/test/:id",
  (req, res, details) => {
    // sh.info("q=%s", details.url.searchParams.get("q"));
    // sh.info("r=%s", details.url.searchParams.get("r"));
    // sh.info("id=%s", details.params.id);
    sh.info("body=%s", details.middlewareProps.body);
    sh.info("jsonBody=%s", details.middlewareProps.json);
    // sh.info("headers=%s", req.headers);

    if (details.params.id === "1") {
      throw new HttpError(400, "fool!");
    }

    res.statusCode = 200;
    res.end();
  },

  [
    HttpMan.body(),
    HttpMan.json({ zodInputValidator: User }),
    middleware1,
    middleware2,
  ],
);

let pong = (req, res, details) => {
  sh.info("pinged");
  res.write("pong\n");
  sh.info("body=%s", details.middlewareProps.body);

  res.statusCode = 200;
  res.end();
};

httpMan.endpoint("GET", "/ping", pong, [HttpMan.body()]);
