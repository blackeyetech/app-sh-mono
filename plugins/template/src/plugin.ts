// imports here
import { AppSh, AppShPlugin } from "app-sh";

// Types here

// Config consts here

// Default configs here

// Template class here
export class Template extends AppShPlugin {
  constructor(appSh: AppSh) {
    super({
      name: "TEMPLATE",
      appSh,
      // NOTE: PLUGIN_VERSION is replaced with package.json#version by a
      // rollup plugin at build time
      pluginVersion: "PLUGIN_VERSION",
    });
  }

  // Protected methods here

  // Private methods here

  // Public methods here
}
