// imports here
import { ShellPlugin, ShellPluginConfig } from "app-sh";

// Interfaces here

// Config consts here

// Default configs here

// Template class here
export class Template extends ShellPlugin {
  constructor(extConfig: ShellPluginConfig) {
    super(extConfig);
  }

  // Private methods here

  // Public methods here
  async start(): Promise<boolean> {
    return true;
  }

  async stop(): Promise<void> {
    return;
  }
}
