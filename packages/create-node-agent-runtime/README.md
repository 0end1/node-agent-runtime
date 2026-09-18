# create-node-agent-runtime

Scaffold the first **governed** agent project — session, permission gate and sandboxed write already wired up.

> Status: **M8-1**. Zero runtime dependencies; templates are compiled into `dist/`, so the published tarball needs nothing but `dist`.

## Usage

```bash
npx create-node-agent-runtime my-agent
cd my-agent && npm install && npm start
```

Non-interactive (CI or a pipe): `--yes`, or pass the directory directly.

```
npx create-node-agent-runtime my-agent --name my-agent --yes
```

## What you get

| File | Why |
|---|---|
| `src/main.ts` | create session → run a turn → a write tool triggers approval → land it in `./workspace` |
| `policy.createProductionDefaults()` | least-privilege matrix + a locked sandbox scope (network denied, workspace-only writes) |
| `FileStorage` (`.runtime-data/`) | sessions, checkpoints and approval audits on disk — restart and resume |
| `.env.example` | where the real-model keys go once you leave `MockProvider` |

`MockProvider` is the default, so the first run needs **no API key**.

## Design notes

- **Zero runtime dependencies.** This is the first package a new user pulls through `npx`; every dependency is a download they wait for.
- **Never overwrites.** Running it inside a non-empty directory fails loudly instead of clobbering files.
- **The scaffold teaches the governance path, not just the API.** The generated entry point subscribes to `permission:request` and `sandbox:write`, because those two are the reason to pick this runtime over a bare agent loop.

## Options

| Flag | Meaning |
|---|---|
| `--name <name>` | package.json name (defaults to the directory name) |
| `--yes` / `-y` | take every default, ask nothing |
| `-h` / `--help` | usage |
