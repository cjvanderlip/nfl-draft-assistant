# Claude tools

Two things that talk to Claude, kept in their own package on purpose.

The draft-day server has no runtime dependencies and no external service in its request
path — that is what makes a live draft survivable, and it is not negotiable two days before
one. So everything here is a **separate package with separate dependencies**, excluded from
the root `tsconfig.json`. Nothing in `src/` imports it. If this directory is broken, missing,
or never installed, `npm install`, `npm run build`, `npm test` and `npm start` in the repo
root all behave exactly as they did before.

```bash
cd claude && npm install
```

| Tool | When it runs | If it breaks |
| --- | --- | --- |
| `war-room-mcp.mjs` | During a draft, as a Claude Code / Claude Desktop MCP server | The board is untouched; you lose the chat, not the draft |
| `draft-brief.mjs` | Once, the night before | Nothing — it writes a markdown file and exits |

---

## 1. The MCP sidecar — interactive chat over the live board

A read-only MCP server that calls the same `localhost:3005` API the browser UI calls. Start
the board as usual (`npm start`), then ask Claude questions about it in a chat window.

### Tools it exposes

| Tool | Answers |
| --- | --- |
| `get_board_state` | Who is on the clock, your roster, your next two turns, recent picks, mandatory-slot countdown, setup audit, ADP freshness |
| `get_survival` | The survival table, filterable by position, probability ceiling, and count |
| `get_manager_profile` | One manager's measured habits, or the whole league's |
| `get_league_tendencies` | The league baseline each manager is measured against |
| `search_players` | Autocomplete against the available pool |
| `get_data_status` | Cache freshness and whether a board is live |

### It is read-only, deliberately

There is no tool to record a pick, undo one, or resync the board. The UI already refuses to
draft anybody on a single click, because the grid sits under the cursor all draft and a stray
click that silently recorded a pick would put every later pick on the wrong team. A model
recording picks is that same failure mode with worse odds and no cursor to blame. Picks stay
in the UI, where a human confirms them.

### Claude Code

`.mcp.json` in the repo root already points at it, so opening Claude Code in this directory
picks it up — approve it when prompted. Check with `/mcp`.

### Claude Desktop

Better ergonomics on draft day: a chat window rather than a coding tool. Edit
`%APPDATA%\Claude\claude_desktop_config.json` and restart Claude Desktop:

```json
{
  "mcpServers": {
    "war-room-wingman": {
      "command": "node",
      "args": ["C:\\Users\\cjevi\\nfl-draft-assistant\\claude\\war-room-mcp.mjs"]
    }
  }
}
```

The path must be absolute here, unlike in `.mcp.json`.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `WINGMAN_URL` | `http://localhost:3005` | Where the board server is |
| `PORT` | `3005` | Used to build the default URL |

### Asking it things

The point is questions the simulation does not answer on its own:

- *"I'm on the clock at 10. Who's genuinely at risk of not coming back at 15?"*
- *"Why is Nabers only 48%? Which manager is the threat and how sure are we?"*
- *"Compare taking a TE now versus waiting — what does this league's TE timing say?"*
- *"I have two RBs and no QB in round 7. What does my remaining-turn math look like?"*

It reads the calibrated numbers rather than inventing them — the tool descriptions say so
explicitly, because a model guessing survival probabilities on top of a model that measures
them is strictly worse than the measurement alone.

---

## 2. The pre-draft brief

Turns `data/manager-profiles.json` and this season's ADP into something readable. Nobody
reads a 119KB JSON dump on the clock; this is the reading done beforehand, on paper.

```bash
# From the repo root, with the data already built by "npm run draft:prep":
cd claude
node draft-brief.mjs A-LEAGUE 2026 10
node draft-brief.mjs B-LEAGUE 2026 10
```

Arguments are `<LEAGUE_ID> [season] [draftSlot]`. It streams to the terminal and writes
`data/draft-brief-<LEAGUE>-<season>.md`.

`--dry-run` prints the prompt size and your snake picks without calling the API — worth
running first to confirm the data loaded.

### It needs an API key

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
```

Get one at <https://console.anthropic.com/settings/keys>. About 17K input tokens and a few
thousand out, so roughly **$0.30 per brief** on `claude-opus-5`.

### What it will not do

The brief describes measured *tendencies* — reach, positional timing, tells — always with
the sample size behind them, and it is told to say when a sample is too thin to trust. It
does not produce survival probabilities. Those come from the simulation, on the day, with the
real board in front of it.
