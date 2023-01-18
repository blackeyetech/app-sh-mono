import { AppSh, LogLevel } from "app-sh";

let sh = new AppSh({
  logLevel: LogLevel.TRACE,
  logTimestampFormat: "",
});

sh.info("Hello world");

// let b = $.getConfigBool({ config: "XXX", defaultVal: true });
// $.info("Bool (%j)", b);
// let s = $.getConfigStr({ config: "XXX", defaultVal: "" });
// $.info("String (%j)", s);
let n = sh.getConfigNum("XXX", 123, { cmdLineFlag: "x" });
sh.info("Number (%j)", n);
