import { AppSh, LogLevel, z } from "app-sh";

import * as http from "node:http";

// process.on("uncaughtException", (e) => {
//   sh.error("caught %s)", e);
//   // sh.exit(1);
// });

//create a server object:
// http
//   .createServer(function (req, res) {
//     res.write("Hello World!"); //write a response to the client
//     res.end(); //end the response
//   })
//   .listen(8080); //the server object listens on port 8080

class App extends AppSh {
  constructor() {
    super({
      enableHttpMan: true,
      logLevel: LogLevel.TRACE,
      logTimestampFormat: "",
      logTimestamp: false,
      catchExceptions: true,
      exitOnUnhandledExceptions: false,
    });
  }

  async stop() {
    this.shutdown("Bye!");
  }
}

let sh = new App();

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

httpMan.addHealthcheck(() => {
  sh.info("Helllo!!!");
  return true;
});
// sh.sleep(2);

httpMan.addMiddleware(async (req, res, details, next) => {
  let now = new Date().valueOf();
  sh.info("in the middle of one");
  await next();
  let time = new Date().valueOf() - now;
  sh.info("finished the middle one - %s", time);
});

sh.httpMan.addMiddleware(async (req, res, details, next) => {
  sh.info("in the middle of two");
  await next();
  sh.info("finished the middle two");
});

sh.httpMan.addMiddleware(async (req, res, details, next) => {
  sh.info("in the middle of three");
  // await sh.sleep(5);
  await next();
  sh.info("finished the middle three");
});

const User = z.object({
  a: z.number(),
  b: z.string(),
});

sh.httpMan.addEndpoint(
  "POST",
  "/test/:id",
  (req, res, details) => {
    sh.info("q=%s", details.url.searchParams.get("q"));
    sh.info("r=%s", details.url.searchParams.get("r"));
    sh.info("id=%s", details.params.id);
    sh.info("body=%s", details.body);
    sh.info("jsonBody=%s", details.jsonBody);
    sh.info("headers=%s", req.headers);

    res.statusCode = 200;
    res.end();
  },
  { zodInputValidator: User, maxBodySize: 512 },
);

sh.httpMan.addEndpoint(
  "GET",
  "/ping",
  (req, res, details) => {
    sh.info("pinged");
    res.write("pong\n");

    res.statusCode = 200;
    res.end();
  },
  { zodInputValidator: User },
);
