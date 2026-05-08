# scripts/

Standalone tooling that supports the project but isn't part of the
shipped Electron app. Each script documents its own run command in its
header comment.

## Manual AI eval — `eval-ai.ts`

Sends the 7 smoke-test queries from [SPRINT-8.md](../SPRINT-8.md) to
the Anthropic API using the same system prompt and tool schemas the
renderer ships, grades each response with permissive substring/tool-use
checks, and writes a Markdown report to stdout *and* `eval-results.md`
at the repo root. Exits 0 if all 7 pass, 1 otherwise.

The script imports `STATIC_SYSTEM` / `buildSystemBlocks` / `buildTools`
directly from `frontend/src/ai/prompt.ts`, so any prompt edit there is
picked up automatically — no copy to keep in sync.

Run it from the `frontend/` directory so Node module resolution finds
the `@anthropic-ai/sdk` dep that lives in `frontend/node_modules`. Set
`NODE_PATH=node_modules` so the bare specifier resolves.

**bash / WSL:**

```sh
cd frontend
NODE_PATH=node_modules \
ANTHROPIC_API_KEY=sk-ant-... \
npx tsx ../scripts/eval-ai.ts
```

**Windows PowerShell:**

```powershell
cd frontend
$env:NODE_PATH = "node_modules"
$env:ANTHROPIC_API_KEY = "sk-ant-..."
npx tsx ../scripts/eval-ai.ts
```

Without `ANTHROPIC_API_KEY` the script prints a friendly usage hint and
exits 1 without calling the API. Get a key at
[console.anthropic.com](https://console.anthropic.com/).

A typical run is ~7 sequential API calls and finishes in 30–60 seconds.
