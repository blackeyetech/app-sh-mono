// let { Shell } = require("cn-shell");
let { Shell, LogLevel } = require("app-sh");

(async () => {
  let $ = new Shell({
    name: "Test",
    log: { level: LogLevel.TRACE, timestampFormat: "" },
  });
  await $.init();

  $.info("Hello world");

  // let b = $.getConfigBool({ config: "XXX", defaultVal: true });
  // $.info("Bool (%j)", b);
  // let s = $.getConfigStr({ config: "XXX", defaultVal: "" });
  // $.info("String (%j)", s);
  let def = undefined;
  let n = $.getConfigNum("XXX", 123);
  $.info("Number (%j)", n);
})();
