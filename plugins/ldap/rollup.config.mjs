import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import replace from "@rollup/plugin-replace";
import terser from "@rollup/plugin-terser";
import sourcemaps from "rollup-plugin-sourcemaps";
import dts from "rollup-plugin-dts";

import { readFileSync } from "node:fs";

// Consts here

// Load the package.json so we can get the version
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

// We need to know if we are building for prod or dev
const NODE_ENV =
  process.env.NODE_ENV === undefined ? "development" : process.env.NODE_ENV;

// Setup the plugins here
let plugins = [
  replace({
    preventAssignment: true,
    values: { PLUGIN_VERSION: pkg.version },
  }),
  commonjs(),
  resolve({ preferBuiltins: true }),
  json(),
];

if (NODE_ENV === "development") {
  plugins.push(sourcemaps);
} else {
  plugins.push(terser());
}

export default [
  {
    input: "dist/plugin.js",
    output: {
      sourcemap: NODE_ENV === "development",
      file: "dist/plugin.mjs",
      format: "es",
    },
    external: ["app-sh", "ldapjs"],

    plugins,
  },
  {
    input: "dist/plugin.js",
    output: {
      sourcemap: NODE_ENV === "development",
      file: "dist/plugin.cjs",
      format: "cjs",
    },
    external: ["app-sh", "ldapjs"],

    plugins,
  },
  {
    input: "dist/types/plugin.d.ts",
    output: {
      file: "dist/plugin.d.ts",
      format: "es",
    },
    external: [],
    plugins: [dts()],
  },
];
