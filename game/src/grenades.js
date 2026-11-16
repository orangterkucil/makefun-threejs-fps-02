// grenades.js — thrown utility: a fragment flask and a veil canister.
//
// Both share one ballistic body (thrown, gravity, bounce off geometry) and differ only on
// detonation. The veil matters tactically because a smoke cloud removes a sightline: the
// bot perception test asks this module whether a smoke sits on the line between two
// actors, so throwing one actually changes what the defenders can see.
import { GRENADE, PHASE } from './config.js';
import { damageActor, noiseAt, state } from './state.js';
import { blocked } from './world.js';

export const FRAG = 'frag';
export const VEIL = 'veil';

function livePhase() {
  return state.phase === PHASE.BREACH || state.phase === PHASE.ARMED;
}

export function throwGrenade(actor, kind, audio) {
  if (!actor.alive || !livePhase()) return false;
  if (kind === FRAG && actor.frags <= 0) return false;
  if (kind === VEIL && actor.veils <= 0) return false;
  if (kind === FRAG) actor.frags--;
  else actor.veils--;

  const yaw = actor.yaw;
  const pitch = actor.pitch;
  state.grenades.push({
    kind,
    x: actor.x,
    y: actor.y + GRENADE.THROW_LIFT,
    z: actor.z,
    vx: -Math.sin(yaw) * Math.cos(pitch) * GRENADE.FRAG_SPEED,
    vy: Math.sin(pitch) * GRENADE.FRAG_SPEED + 3.2,
    vz: -Math.cos(yaw) * Math.cos(pitch) * GRENADE.FRAG_SPEED,
    fuse: kind === FRAG ? GRENADE.FRAG_FUSE : GRENADE.SMOKE_FUSE,
    owner: actor.id,
    team: actor.team,
  });
  if (audio) audio.throw();
  return true;
}

// A smoke blocks sight when the line between two actors passes through it. Sampling every
// 1.5 m along the line is cheap and reads as one honest rule rather than a raycast hack.
export function smokeBlocks(ax, az, bx, bz) {
  if (state.smokes.length === 0) return false;
  const dx = bx - ax;
  const dz = bz - az;
  const length = Math.hypot(dx, dz);
  const samples = Math.max(1, Math.ceil(length / 1.5));
  for (let i = 0; i < state.smokes.length; i++) {
    const smoke = state.smokes[i];
    if (smoke.until < state.time) continue;
    for (let s = 0; s <= samples; s++) {
      const t = s / samples;
      const px = ax + dx * t;
      const pz = az + dz * t;
      if ((px - smoke.x) ** 2 + (pz - smoke.z) ** 2 < GRENADE.SMOKE_RADIUS * GRENADE.SMOKE_RADIUS) return true;
    }
  }
  return false;
}

function detonateFrag(grenade, world, audio) {
  state.blasts.push({ x: grenade.x, y: grenade.y, z: grenade.z, born: state.time });
  for (const actor of state.actors) {
    if (!actor.alive) continue;
    const dx = actor.x - grenade.x;
    const dy = actor.y + 1 - grenade.y;
    const dz = actor.z - grenade.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance > GRENADE.FRAG_RADIUS) continue;
    if (blocked(grenade.x, grenade.y, grenade.z, actor.x, actor.y + 1, actor.z, world.colliders)) continue;
    const falloff = 1 - distance / GRENADE.FRAG_RADIUS;
    const attacker = state.actors[grenade.owner] || null;
    damageActor(actor, GRENADE.FRAG_DAMAGE * falloff * falloff, attacker, 'blast');
  }
  noiseAt(grenade, 62, 'blast');
  audio.explode();
}

function detonateVeil(grenade) {
  state.smokes.push({
    x: grenade.x,
    y: Math.max(0.8, grenade.y),
    z: grenade.z,
    until: state.time + GRENADE.SMOKE_SECONDS,
    born: state.time,
  });
}

export function updateGrenades(world, dt, audio) {
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const grenade = state.grenades[i];
    grenade.fuse -= dt;
    grenade.vy -= GRENADE.FRAG_SPEED * 1.1 * dt;

    const nextX = grenade.x + grenade.vx * dt;
    const nextZ = grenade.z + grenade.vz * dt;
    if (blocked(grenade.x, grenade.y, grenade.z, nextX, grenade.y, nextZ, world.colliders, 0.12)) {
      grenade.vx *= -GRENADE.BOUNCE;
      grenade.vz *= -GRENADE.BOUNCE;
    } else {
      grenade.x = nextX;
      grenade.z = nextZ;
    }
    grenade.y += grenade.vy * dt;
    if (grenade.y < 0.14) {
      grenade.y = 0.14;
      grenade.vy = Math.abs(grenade.vy) * GRENADE.BOUNCE;
      grenade.vx *= 0.78;
      grenade.vz *= 0.78;
    }

    if (grenade.fuse > 0) continue;
    if (grenade.kind === FRAG) detonateFrag(grenade, world, audio);
    else detonateVeil(grenade);
    state.grenades.splice(i, 1);
  }

  for (let i = state.smokes.length - 1; i >= 0; i--) {
    if (state.smokes[i].until < state.time) state.smokes.splice(i, 1);
  }
  for (let i = state.blasts.length - 1; i >= 0; i--) {
    if (state.blasts[i].born + 0.45 < state.time) state.blasts.splice(i, 1);
  }
}
