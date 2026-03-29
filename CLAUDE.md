# selenoid-bridge

E2E cross-browser testing bridge between agent-browser and Selenoid.

## Project Structure

- `src/recorder/` — agent-browser wrapper + selector extraction (CDP)
- `src/scenario/` — test scenario types and validation
- `src/runner/` — WebDriver client + scenario execution engine
- `src/index.ts` — CLI entry point (commander)
- `tests/` — vitest unit tests
- `.claude/skills/e2e-test/` — Claude Code skill for E2E test orchestration

## Related Projects

- **selenoid** (`../selenoid`) — Browser container management server (Go)
- **images** (`../images`) — Browser Docker image builder (Go)

## Commands

```bash
npm run build     # TypeScript compile
npm test          # Run unit tests (vitest)
node dist/index.js run <scenario.json> --selenoid http://localhost:4444
node dist/index.js validate <scenario.json>
node dist/index.js create <name> --url <baseUrl>
```

## Environment Variables

- `SELENOID_DIR` — Path to selenoid source (default: `../selenoid`)
- `SELENOID_IMAGES_DIR` — Path to images source (default: `../images`)
- `SELENOID_PORT` — Selenoid listen port (default: `4444`)
- `SELENOID_CONFIG` — browsers.json path (default: `/tmp/browsers-test.json`)
