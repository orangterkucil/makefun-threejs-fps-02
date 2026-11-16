# Saltline — a three.js tactical FPS

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/orangterkucil/makefun-threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/orangterkucil/makefun-threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02)

An entry for make.fun's *Make the best three.js tactical FPS* bounty ($1,000 in USDC),
built end to end by an AI agent inside a recorded session.

## What it is

Saltline is a browser tactical shooter built on three.js, with no build step: `main.ts` runs on
Node 22 (type stripping) and writes the entry's `out/` — the game bundle, the dossier the judges
read, and the capture manifest. The game itself is plain ES modules served to a desktop browser
with WebGL 2.

- **Tactical, not arena.** Rounds are objective-driven: a small breach map, a defend window, and a
  score that only moves on objective play, so aim alone does not win.
- **Readable gunplay.** Fixed-tick movement, per-weapon recoil curves, and a hit model that
  resolves per body zone — head, torso, limb — with damage falloff over range.
- **Legible AI.** Bots patrol, hear shots, take cover, and push objectives in waves; each state
  transition is visible in the HUD so a reviewer can see the decision, not just the result.
- **Deterministic rounds.** A seeded RNG drives spawns, recoil jitter and bot decisions, so a
  round replays identically from the same seed — the run check can compare two executions.

## Run it

```bash
node --experimental-strip-types main.ts        # writes out/ (game bundle, dossier, manifest)
node --experimental-strip-types serve.ts       # serves the game on http://127.0.0.1:8080
```

Open the page in a desktop browser with WebGL 2 (Chrome). WASD moves, mouse aims, left click
fires, right click aims down sights, R reloads, shift sprints, space jumps, 1-2 swap weapons.

## Layout

| Path | What it holds |
|---|---|
| `main.ts` | the entry driver: builds `out/`, writes `dossier.json`, records the capture manifest |
| `serve.ts` | a static server for local play |
| `game/` | the game: renderer, world, weapon model, bot AI, round logic, HUD |
| `out/` | the built bundle and the dossier the judges read |
| `screenshots/` | captures taken in a real browser with WebGL 2 |

## License

MIT. See [LICENSE](LICENSE).
