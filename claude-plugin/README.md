# cc-assistant Claude Code plugin

This package contributes the cc-assistant MCP server, lifecycle hooks, and a controller skill. It uses a bundled MCP bridge and does not install a browser extension.

The durable daemon must already be running. The plugin first looks for `.data/access-token` in the current Claude project, then uses the platform application-data directory. Set `CC_ASSISTANT_DATA_DIR` to an absolute directory when the daemon stores state elsewhere.

Build and validate from the source repository:

```bash
pnpm plugin:build
pnpm plugin:validate
claude --plugin-dir ./claude-plugin
```

After Claude Code starts, inspect `/plugin` and `/mcp`. Plugin MCP tools are namespaced by Claude Code as `mcp__plugin_cc-assistant_cc-assistant__…`.

Invoke `/cc-assistant:controller` to load the detailed controller operating guide and initialize
from durable assistant state. The generated skill is sourced from `prompts/controller.md` in the
repository; rebuild the plugin after changing that prompt.
