# cc-assistant Claude Code plugin

This package contributes the cc-assistant MCP server and lifecycle hooks. It uses a bundled MCP bridge and does not install a browser extension.

The durable daemon must already be running. The plugin first looks for `.data/access-token` in the current Claude project, then uses the platform application-data directory. Set `CC_ASSISTANT_DATA_DIR` to an absolute directory when the daemon stores state elsewhere.

Build and validate from the source repository:

```bash
pnpm plugin:build
pnpm plugin:validate
claude --plugin-dir ./claude-plugin
```

After Claude Code starts, inspect `/plugin` and `/mcp`. Plugin MCP tools are namespaced by Claude Code as `mcp__plugin_cc-assistant_cc-assistant__…`.
