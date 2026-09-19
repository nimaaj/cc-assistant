# Package managers

cc-assistant supports both **pnpm 11** and **npm 11**. pnpm remains the recommended and pinned
package manager, while npm is a first-class alternative for machines that already have Node.js
and do not want an additional package-manager installation.

## Choose one per checkout

Use one package manager consistently in a working tree. Both lockfiles are committed:

- `pnpm-lock.yaml` is authoritative for `pnpm install --frozen-lockfile`;
- `package-lock.json` is authoritative for `npm ci`.

Do not alternate `pnpm install` and `npm install` against the same `node_modules` directory. Their
dependency layouts differ. To switch managers, use a fresh clone or remove `node_modules` and
install again with the chosen manager. Never hand-edit either lockfile.

## Command equivalents

| Operation | pnpm (recommended) | npm |
| --- | --- | --- |
| Reproducible install | `pnpm install --frozen-lockfile` | `npm ci` |
| Build all workspaces | `pnpm build` | `npm run build` |
| Development daemon and UI | `pnpm dev` | `npm run dev` |
| Production daemon | `pnpm start` | `npm start` |
| Test | `pnpm test` | `npm test` |
| Type-check | `pnpm typecheck` | `npm run typecheck` |
| Offline doctor | `pnpm assistant:doctor --offline` | `npm run assistant:doctor -- --offline` |
| Developer CLI | `pnpm cca status` | `npm run cca -- status` |
| Controller | `pnpm controller` | `npm run controller` |
| Background controller (manual) | `pnpm controller:bg` | `npm run controller:bg` |
| Background controller (automatic) | `pnpm controller:bg:auto` | `npm run controller:bg:auto` |
| Background controller (bypass) | `pnpm controller:bg:bypass` | `npm run controller:bg:bypass` |
| Sandboxed controller | `pnpm controller:sandbox` | `npm run controller:sandbox` |
| Build plugin | `pnpm plugin:build` | `npm run plugin:build` |
| Validate plugin | `pnpm plugin:validate` | `npm run plugin:validate` |

The extra `--` in npm commands passes following options to the repository script. For example:

```bash
npm run controller:sandbox -- --model opus --effort high
npm run cca -- task list --status active --json
npm run assistant:doctor -- --offline --json
```

## Maintainer rule

When package manifests or dependency versions change, update and commit both lockfiles:

```bash
pnpm install --lockfile-only
npm install --package-lock-only --ignore-scripts
```

Then verify at least the build, type-check, and tests with both managers. A clean `npm ci` check
must run in a checkout whose `node_modules` was not created by pnpm.
