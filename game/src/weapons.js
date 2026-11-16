// weapons.js — the armoury, the ballistics and the buy menu.
//
// One table defines every gun; one function resolves a shot. A shot is a ray against the
// world and against three hit volumes per opponent (head, torso, legs), so damage depends
// on where you hit, how far away it was, and how still you were when you fired. Spread
// grows with speed, with airtime and with the recoil climb of a long burst, which is the
// whole reason a good player stops moving before the trigger.
import { COMBAT, ECONOMY, MOVE, PHASE } from './config.js';
import { addTracer, clamp, damageActor, noiseAt, random, state } from './state.js';
import { segmentBox } from './world.js';

export const WEAPONS = Object.freeze({
  rifle: {
    id: 'rifle', name: 'TIDEGLASS', code: 'TR-7', price: 2700,
    mag: 30, reserve: 90, rpm: 620, damage: 33, spread: 0.0022, kick: 0.075,
    pellets: 1, falloff: 0.009, reloadTime: 2.2, reward: ECONOMY.KILL_RIFLE,
  },
  smg: {
    id: 'smg', name: 'MORAY', code: 'M9', price: 1500,
    mag: 35, reserve: 105, rpm: 800, damage: 22, spread: 0.0055, kick: 0.05,
    pellets: 1, falloff: 0.013, reloadTime: 1.8, reward: ECONOMY.KILL_SMG,
  },
  shotgun: {
    id: 'shotgun', name: 'SALTMAKER', code: 'S8', price: 1900,
    mag: 7, reserve: 28, rpm: 75, damage: 15, spread: 0.042, kick: 0.22,
    pellets: 9, falloff: 0.03, reloadTime: 2.9, reward: ECONOMY.KILL_SHOTGUN,
  },
  pistol: {
    id: 'pistol', name: 'PIPIT', code: 'P13', price: 0,
    mag: 13, reserve: 52, rpm: 320, damage: 28, spread: 0.004, kick: 0.1,
    pellets: 1, falloff: 0.012, reloadTime: 1.5, reward: ECONOMY.KILL_PISTOL,
  },
});

export const LOADOUT_SLOTS = Object.freeze([
  { slot: 1, kind: 'weapon', id: 'rifle' },
  { slot: 2, kind: 'weapon', id: 'smg' },
  { slot: 3, kind: 'weapon', id: 'shotgun' },
  { slot: 4, kind: 'weapon', id: 'pistol' },
  { slot: 5, kind: 'armor', price: 650, armor: COMBAT.ARMOR_MAX },
  { slot: 6, kind: 'utility', price: 600, frags: 2, veils: 1 },
]);

const EYE_FIRE = 1.58;
const HIT_BOX = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
const RAY_LENGTH = 120;

export function weaponOf(a) {
  return WEAPONS[a.weapon] || WEAPONS.pistol;
}

export function equip(a, id) {
  const weapon = WEAPONS[id];
  if (!weapon) return;
  a.weapon = id;
  a.mag = weapon.mag;
  a.reserve = weapon.reserve;
  a.reload = 0;
  a.cooldown = 0;
  a.recoil = 0;
  a.climb = 0;
  a.burst = 0;
}

export function canFire(a) {
  return a.alive && a.cooldown <= 0 && a.reload <= 0 && a.mag > 0;
}

// The cone this actor's next shot is thrown in. Everything that punishes bad habits is
// summed here rather than hidden in the fire path.
export function spreadOf(a) {
  const weapon = weaponOf(a);
  const speed = Math.hypot(a.vx, a.vz);
  let spread = weapon.spread;
  spread += Math.min(1, speed / MOVE.WALK_SPEED) * COMBAT.MOVE_SPREAD;
  if (!a.grounded) spread += COMBAT.AIR_SPREAD;
  spread += a.climb * weapon.kick * 0.05;
  if (a.crouch) spread *= COMBAT.CROUCH_SPREAD;
  if (a.aiming) spread *= COMBAT.ADS_SPREAD;
  return spread;
}

// Range falloff: full damage inside sixteen metres, tapering to half at forty-eight.
function falloffAt(distance) {
  if (distance <= COMBAT.FALLOFF_START) return 1;
  if (distance >= COMBAT.FALLOFF_END) return COMBAT.FALLOFF_FLOOR;
  const t = (distance - COMBAT.FALLOFF_START) / (COMBAT.FALLOFF_END - COMBAT.FALLOFF_START);
  return 1 - t * (1 - COMBAT.FALLOFF_FLOOR);
}

// Distance to the nearest surface of one actor's body, split into the three zones. The
// caller keeps the closest result across the whole scene, so geometry can shield a body.
function hitActor(a, ax, ay, az, bx, by, bz, out) {
  const height = a.crouch ? MOVE.CROUCH_HEIGHT : MOVE.STAND_HEIGHT;
  const zones = [
    { zone: 'head', y0: height - 0.3, y1: height, half: 0.17 },
    { zone: 'torso', y0: 0.62, y1: height - 0.3, half: 0.27 },
    { zone: 'legs', y0: 0.02, y1: 0.62, half: 0.23 },
  ];
  let best = Infinity;
  let bestZone = '';
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    HIT_BOX.minX = a.x - z.half;
    HIT_BOX.maxX = a.x + z.half;
    HIT_BOX.minZ = a.z - z.half;
    HIT_BOX.maxZ = a.z + z.half;
    HIT_BOX.minY = a.y + z.y0;
    HIT_BOX.maxY = a.y + z.y1;
    const t = segmentBox(ax, ay, az, bx, by, bz, HIT_BOX);
    if (t < best) { best = t; bestZone = z.zone; }
  }
  out.distance = best;
  out.zone = bestZone;
  return out;
}

const HIT = { distance: Infinity, zone: '' };

// Resolve one trigger pull. `accuracy` above 1 is the bot handicap: their cone is wider,
// which is why a bot loses a long duel to a player who has stopped and aimed.
export function fire(a, world, audio, aimYaw, aimPitch, accuracy = 1) {
  if (!canFire(a)) return false;
  if (state.phase !== PHASE.BREACH && state.phase !== PHASE.ARMED) return false;
  const weapon = weaponOf(a);
  a.mag--;
  a.cooldown = 60 / weapon.rpm;
  a.flash = COMBAT.MUZZLE_FLASH;
  a.burst++;
  const ax = a.x;
  const ay = a.y + (a.crouch ? MOVE.EYE_CROUCH : EYE_FIRE);
  const az = a.z;
  const spread = spreadOf(a) * accuracy;

  for (let pellet = 0; pellet < weapon.pellets; pellet++) {
    const yaw = aimYaw + (random() - 0.5) * spread * 2 + Math.sin(a.burst * 1.7) * a.recoil * 0.02;
    const pitch = aimPitch + (random() - 0.5) * spread * 2 + a.recoil * 0.05;
    const dirX = -Math.sin(yaw) * Math.cos(pitch);
    const dirY = Math.sin(pitch);
    const dirZ = -Math.cos(yaw) * Math.cos(pitch);
    const bx = ax + dirX * RAY_LENGTH;
    const by = ay + dirY * RAY_LENGTH;
    const bz = az + dirZ * RAY_LENGTH;

    let nearest = 1;
    for (let i = 0; i < world.colliders.length; i++) {
      const t = segmentBox(ax, ay, az, bx, by, bz, world.colliders[i]);
      if (t < nearest) nearest = t;
    }
    let victim = null;
    let zone = '';
    for (let i = 0; i < state.actors.length; i++) {
      const other = state.actors[i];
      if (!other.alive || other.team === a.team) continue;
      hitActor(other, ax, ay, az, bx, by, bz, HIT);
      if (HIT.distance < nearest) {
        nearest = HIT.distance;
        victim = other;
        zone = HIT.zone;
      }
    }

    if (victim) {
      const distance = nearest * RAY_LENGTH;
      const zoneMult = zone === 'head' ? COMBAT.HEAD_MULT : zone === 'legs' ? COMBAT.LEGS_MULT : COMBAT.TORSO_MULT;
      const amount = weapon.damage * zoneMult * falloffAt(distance);
      damageActor(victim, amount, a, zone);
      if (a === state.player) audio.hit(zone === 'head');
    }
    addTracer(ax, ay, az, ax + (bx - ax) * nearest, ay + (by - ay) * nearest, az + (bz - az) * nearest, COMBAT.TRACER_LIFETIME);
  }

  a.recoil = clamp(a.recoil + weapon.kick, 0, 1.8);
  a.climb = clamp(a.climb + weapon.kick, 0, 2.2);
  noiseAt(a, weapon.pellets > 1 ? 52 : 46, 'shot');
  audio.shot(a.weapon, a === state.player ? 1 : 0.3);
  return true;
}

export function startReload(a, audio) {
  const weapon = weaponOf(a);
  if (a.reload > 0 || a.mag >= weapon.mag || a.reserve <= 0) return false;
  a.reload = weapon.reloadTime;
  if (a === state.player) audio.reload();
  return true;
}

// Per-tick weapon housekeeping for every actor: timers, recoil recovery, the reload
// magazine swap, and the spread value the crosshair reads.
export function tickWeapon(a, dt) {
  a.cooldown = Math.max(0, a.cooldown - dt);
  a.flash = Math.max(0, a.flash - dt);
  a.recoil = Math.max(0, a.recoil - COMBAT.RECOIL_RECOVERY * dt);
  if (a.cooldown === 0) a.burst = Math.max(0, a.burst - dt * 6);
  a.climb = Math.max(0, a.climb - COMBAT.BURST_DECAY * dt);
  if (a.reload > 0) {
    a.reload = Math.max(0, a.reload - dt);
    if (a.reload === 0) {
      const weapon = weaponOf(a);
      const take = Math.min(weapon.mag - a.mag, a.reserve);
      a.mag += take;
      a.reserve -= take;
    }
  }
  a.spread = spreadOf(a);
}

// --- Buy menu ---------------------------------------------------------------------
// Buying is only legal in preparation: the economy has teeth because you cannot fix a
// bad loadout mid-round.
export function buy(slot) {
  const entry = LOADOUT_SLOTS.find((item) => item.slot === slot);
  if (!entry) return { ok: false, reason: 'no such slot' };
  if (state.phase !== PHASE.PREP) return { ok: false, reason: 'supply closed' };
  const player = state.player;
  if (!player.alive) return { ok: false, reason: 'you are down' };

  if (entry.kind === 'weapon') {
    const weapon = WEAPONS[entry.id];
    if (state.money < weapon.price) return { ok: false, reason: 'not enough funds' };
    state.money -= weapon.price;
    equip(player, entry.id);
    return { ok: true, label: weapon.name };
  }
  if (entry.kind === 'armor') {
    if (state.money < entry.price) return { ok: false, reason: 'not enough funds' };
    state.money -= entry.price;
    player.armor = entry.armor;
    return { ok: true, label: 'PLATE VEST' };
  }
  if (state.money < entry.price) return { ok: false, reason: 'not enough funds' };
  state.money -= entry.price;
  player.frags += entry.frags;
  player.veils += entry.veils;
  return { ok: true, label: 'FIELD KIT' };
}

export function canAfford(slot) {
  const entry = LOADOUT_SLOTS.find((item) => item.slot === slot);
  if (!entry) return false;
  const price = entry.kind === 'weapon' ? WEAPONS[entry.id].price : entry.price;
  return state.money >= price;
}
