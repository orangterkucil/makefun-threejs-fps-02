// state.js — the one place mutable gameplay lives.
//
// The simulation writes here, the renderer and the HUD only read. Every pool is
// preallocated at module load (tracers, noises, feed lines) because a 60 Hz tick that
// allocates is a tick that stutters; the arrays are fixed rings, never grown per frame.
import { COMBAT, ECONOMY, PHASE, UI } from './config.js';

// Seeded LCG: one seed reproduces a round, its recoil jitter and every bot decision.
// The capture poses rely on this, and so does the determinism check on the build.
let rngState = 1;
export function seedRandom(seed) {
  rngState = (seed >>> 0) || 1;
}
export function random() {
  rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
  return rngState / 4294967296;
}
export function randomBetween(low, high) {
  return low + random() * (high - low);
}
export function randomPick(list) {
  return list[Math.floor(random() * list.length) % list.length];
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const distance2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
export const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// --- Fixed pools ------------------------------------------------------------------
const TRACER_POOL = 48;
const NOISE_POOL = 40;

function makeTracerPool() {
  const pool = [];
  for (let i = 0; i < TRACER_POOL; i++) {
    pool.push({ ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, until: 0, live: false });
  }
  return pool;
}

function makeNoisePool() {
  const pool = [];
  for (let i = 0; i < NOISE_POOL; i++) {
    pool.push({ x: 0, z: 0, team: 0, radius: 0, time: -99, kind: '', live: false });
  }
  return pool;
}

// --- The world state --------------------------------------------------------------
export const state = {
  // simulation
  time: 0,
  tick: 0,
  // round machine
  round: 1,
  phase: PHASE.PREP,
  timer: 0,
  score: [0, 0],
  roundWinner: -1,
  roundReason: '',
  roundPayout: 0,
  lossStreak: [0, 0],
  matchOver: false,
  // player economy and score
  money: ECONOMY.START,
  kills: 0,
  deaths: 0,
  damageDealt: 0,
  // presentation
  started: false,
  paused: false,
  buyOpen: false,
  shot: '', // capture pose name; freezes the simulation
  overview: false, // top-down capture camera
  aiming: false,
  hitFlash: 0,
  damageFlash: 0,
  // objective
  charge: { planted: false, x: 0, z: 0, fuse: 0, site: '', carrier: 0, defuse: 0, plant: 0 },
  objective: { kicker: 'MISSION / BREACH', text: 'Escort the charge to a pump site', sub: 'Two sites · A west tanks · B east gallery' },
  // actors
  player: null,
  bots: [],
  actors: [],
  // event pools
  feed: [],
  noises: makeNoisePool(),
  tracers: makeTracerPool(),
  grenades: [],
  smokes: [],
  blasts: [],
  noiseCursor: 0,
  tracerCursor: 0,
};

// --- Actors -----------------------------------------------------------------------
// One shape for the player and every bot: the simulation never branches on "is this the
// human", it reads the same fields for all six operators.
export function createActor(id, name, team, x, z, role) {
  return {
    id,
    name,
    team, // 0 = Slackwater (player side, attacking), 1 = Tidewatch (defending)
    role: role || 'entry',
    x, y: 0, z,
    px: x, py: 0, pz: z, // previous tick, for interpolated rendering
    vx: 0, vy: 0, vz: 0,
    yaw: team === 0 ? 0 : Math.PI,
    pitch: 0,
    hp: COMBAT.HEALTH_MAX,
    armor: 0,
    alive: true,
    crouch: false,
    grounded: true,
    aiming: false,
    weapon: 'pistol',
    mag: 13,
    reserve: 52,
    cooldown: 0,
    reload: 0,
    recoil: 0,
    climb: 0,
    burst: 0,
    spread: 0,
    flash: 0,
    frags: 0,
    veils: 0,
    step: 0,
    kills: 0,
    deaths: 0,
    damage: 0,
    // bot mind
    intent: 'HOLD',
    targetId: -1,
    lastSeen: -99,
    heardX: x,
    heardZ: z,
    think: 0,
    reaction: 0,
    coverUntil: 0,
    path: [],
    pathIndex: 0,
    goal: -1,
    aimYaw: team === 0 ? 0 : Math.PI,
    aimPitch: 0,
    plantHold: 0,
  };
}

export function resetActor(a, x, z) {
  a.x = x; a.y = 0; a.z = z;
  a.px = x; a.py = 0; a.pz = z;
  a.vx = a.vy = a.vz = 0;
  a.yaw = a.team === 0 ? 0 : Math.PI;
  a.pitch = 0;
  a.hp = COMBAT.HEALTH_MAX;
  a.armor = 0;
  a.alive = true;
  a.crouch = false;
  a.grounded = true;
  a.cooldown = 0;
  a.reload = 0;
  a.recoil = 0;
  a.climb = 0;
  a.burst = 0;
  a.spread = 0;
  a.flash = 0;
  a.frags = 0;
  a.veils = 0;
  a.step = 0;
  a.intent = a.team === 0 ? 'BREACH' : 'HOLD';
  a.targetId = -1;
  a.lastSeen = -99;
  a.heardX = x;
  a.heardZ = z;
  a.think = 0;
  a.reaction = 0;
  a.coverUntil = 0;
  a.path = [];
  a.pathIndex = 0;
  a.goal = -1;
  a.aimYaw = a.yaw;
  a.aimPitch = 0;
  a.plantHold = 0;
}

export function aliveCount(team) {
  let n = 0;
  for (const a of state.actors) if (a.alive && a.team === team) n++;
  return n;
}

export function nearestEnemy(a, predicate) {
  let best = null;
  let bestD = Infinity;
  for (const b of state.actors) {
    if (!b.alive || b.team === a.team) continue;
    if (predicate && !predicate(b)) continue;
    const d = distance2(a, b);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

// --- Events -----------------------------------------------------------------------
// A noise is a place and a loudness, not a message: bots decide what to do about it.
// The ring is fixed, so the oldest sound is overwritten rather than the array growing.
export function noiseAt(source, radius, kind) {
  const slot = state.noises[state.noiseCursor % NOISE_POOL];
  state.noiseCursor++;
  slot.x = source.x;
  slot.z = source.z;
  slot.team = source.team;
  slot.radius = radius;
  slot.time = state.time;
  slot.kind = kind;
  slot.live = true;
}

export function pushFeed(text, team) {
  state.feed.unshift({ text, team, until: state.time + UI.FEED_SECONDS });
  if (state.feed.length > UI.FEED_LINES) state.feed.pop();
}

export function addTracer(ax, ay, az, bx, by, bz, lifetime) {
  const slot = state.tracers[state.tracerCursor % TRACER_POOL];
  state.tracerCursor++;
  slot.ax = ax; slot.ay = ay; slot.az = az;
  slot.bx = bx; slot.by = by; slot.bz = bz;
  slot.until = state.time + lifetime;
  slot.live = true;
}

// --- Damage -----------------------------------------------------------------------
const KILL_REWARD = {
  rifle: ECONOMY.KILL_RIFLE,
  smg: ECONOMY.KILL_SMG,
  shotgun: ECONOMY.KILL_SHOTGUN,
  pistol: ECONOMY.KILL_PISTOL,
};

// Applies one resolved hit. Armour eats a share until it is gone; the zone multiplier and
// range falloff were already applied by the shooter, so this function only owns survival.
export function damageActor(target, amount, attacker, zone) {
  if (!target.alive || state.phase === PHASE.OVER || state.phase === PHASE.MATCH) return 0;
  const absorbed = Math.min(target.armor, amount * COMBAT.ARMOR_ABSORB);
  target.armor -= absorbed;
  const dealt = amount - absorbed;
  target.hp = Math.max(0, target.hp - dealt);
  if (attacker) attacker.damage += dealt;
  if (target === state.player) state.damageFlash = 1;
  target.coverUntil = state.time + 1.4; // being hit breaks a bot's aim for a moment
  if (attacker === state.player) state.hitFlash = 1;
  if (target.hp > 0) return dealt;

  // Death bookkeeping: scoreboard, killfeed, economy, charge custody.
  target.alive = false;
  target.hp = 0;
  target.deaths++;
  if (attacker && attacker !== target) {
    attacker.kills++;
    if (attacker.team === 0) {
      state.money = Math.min(ECONOMY.CAP, state.money + (KILL_REWARD[attacker.weapon] || 300));
    }
    if (attacker === state.player) state.kills++;
  }
  if (target === state.player) state.deaths++;
  const verb = zone === 'head' ? 'HEAD' : zone === 'legs' ? 'LEG' : 'BODY';
  pushFeed(`${attacker ? attacker.name : 'BLAST'} · ${verb} · ${target.name}`, attacker ? attacker.team : 1);
  if (state.charge.carrier === target.id) {
    state.charge.carrier = -1; // the charge drops where the carrier fell
    pushFeed('CHARGE DROPPED', 0);
  }
  return dealt;
}
