// player.js — movement, collision and the view camera.
//
// Movement is a fixed-step, velocity-based model: input sets a target velocity, the actor
// accelerates toward it and friction bleeds it off, so a player who stops to shoot is
// actually standing still (and accurate) a moment later. Collision is a vertical capsule
// swept one axis at a time against the world's boxes, which slides along walls instead of
// sticking to them.
import { COMBAT, MOVE } from './config.js';
import { clamp, noiseAt, state } from './state.js';

// Capsule against AABB: closest point in XZ, then the vertical gap of the two end caps.
export function overlaps(x, y, z, height, box, radius = MOVE.RADIUS) {
  const nearestX = clamp(x, box.minX, box.maxX);
  const nearestZ = clamp(z, box.minZ, box.maxZ);
  const bottom = y + radius;
  const top = y + height - radius;
  const gap = bottom > box.maxY ? bottom - box.maxY : top < box.minY ? box.minY - top : 0;
  return (x - nearestX) ** 2 + (z - nearestZ) ** 2 + gap * gap < radius * radius;
}

export function isFree(world, x, y, z, height) {
  for (let i = 0; i < world.colliders.length; i++) {
    if (overlaps(x, y, z, height, world.colliders[i])) return false;
  }
  return true;
}

export function moveActor(a, dx, dz, world, dt) {
  const height = a.crouch ? MOVE.CROUCH_HEIGHT : MOVE.STAND_HEIGHT;
  // Substeps bound the distance per test, so a fast actor cannot tunnel a wall.
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.18));
  const stepX = dx / steps;
  const stepZ = dz / steps;
  for (let s = 0; s < steps; s++) {
    if (stepX !== 0) {
      if (isFree(world, a.x + stepX, a.y, a.z, height)) a.x += stepX;
      else a.vx = 0;
    }
    if (stepZ !== 0) {
      if (isFree(world, a.x, a.y, a.z + stepZ, height)) a.z += stepZ;
      else a.vz = 0;
    }
  }

  // Gravity and floor resolution: the highest surface under the capsule wins.
  a.vy -= MOVE.GRAVITY * dt;
  const nextY = a.y + a.vy * dt;
  let floor = 0;
  for (let i = 0; i < world.colliders.length; i++) {
    const box = world.colliders[i];
    if (a.x + 0.22 > box.minX && a.x - 0.22 < box.maxX && a.z + 0.22 > box.minZ && a.z - 0.22 < box.maxZ) {
      if (a.vy <= 0 && a.y >= box.maxY - 0.06 && nextY <= box.maxY) floor = Math.max(floor, box.maxY);
      if (a.vy > 0 && a.y + height <= box.minY && nextY + height >= box.minY) a.vy = 0;
    }
  }
  a.y = Math.max(floor, nextY);
  a.grounded = a.y <= floor + 0.002;
  if (a.grounded) a.vy = 0;
}

// Speed the actor is allowed to travel at this tick. Aiming down sights is slow on
// purpose: the trade for a tighter shot is that you cannot strafe out of a duel.
export function speedFor(a, keys, aiming) {
  if (a.crouch) return MOVE.CROUCH_SPEED;
  if (aiming) return MOVE.ADS_SPEED;
  if (keys.has('ShiftLeft') || keys.has('ShiftRight')) return MOVE.QUIET_SPEED;
  return MOVE.WALK_SPEED;
}

export function updatePlayer(a, input, world, dt, active, audio) {
  // Look first: the view must respond even while the round machine is holding movement.
  a.yaw -= input.dx * MOVE.SENSITIVITY;
  a.pitch = clamp(a.pitch - input.dy * MOVE.SENSITIVITY, -MOVE.PITCH_LIMIT, MOVE.PITCH_LIMIT);
  input.dx = 0;
  input.dy = 0;
  if (!a.alive) return;

  const keys = input.keys;
  if (keys.has('ControlLeft') || keys.has('ControlRight')) {
    if (!a.crouch) {
      a.crouch = true;
      if (!isFree(world, a.x, a.y, a.z, MOVE.CROUCH_HEIGHT)) a.crouch = false;
    }
  } else if (a.crouch) {
    // Stand only where the full capsule fits; otherwise stay low under the obstacle.
    if (isFree(world, a.x, a.y, a.z, MOVE.STAND_HEIGHT)) a.crouch = false;
  }

  let forward = 0;
  let side = 0;
  if (active) {
    forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    side = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  }
  const moving = forward !== 0 || side !== 0;
  const speed = speedFor(a, keys, input.aim);
  const length = Math.hypot(forward, side) || 1;
  const sin = Math.sin(a.yaw);
  const cos = Math.cos(a.yaw);
  const targetX = ((side * cos - forward * sin) / length) * speed;
  const targetZ = ((-forward * cos - side * sin) / length) * speed;

  const accel = a.grounded ? (moving ? MOVE.ACCEL : MOVE.DECEL) : MOVE.AIR_ACCEL;
  const blend = 1 - Math.exp(-accel * dt);
  a.vx += (targetX - a.vx) * blend;
  a.vz += (targetZ - a.vz) * blend;
  if (!moving && a.grounded) {
    const friction = Math.max(0, 1 - MOVE.FRICTION * dt);
    a.vx *= friction;
    a.vz *= friction;
  }

  if (active && input.consume('Space') && a.grounded && !a.crouch) {
    a.vy = MOVE.JUMP;
    a.grounded = false;
  }

  moveActor(a, a.vx * dt, a.vz * dt, world, dt);

  // Footsteps are both a sound and a tactical tell: quiet-walking makes none.
  const travelled = Math.hypot(a.vx, a.vz) * dt;
  a.step += travelled;
  if (a.step > MOVE.STEP_LENGTH && a.grounded) {
    a.step = 0;
    if (a === state.player) audio.step();
    const quiet = keys.has('ShiftLeft') || keys.has('ShiftRight') || a.crouch;
    if (!quiet) noiseAt(a, MOVE.STEP_NOISE, 'step');
  }
}

// The camera trails the simulation by one tick and interpolates, so a 60 Hz simulation
// still looks smooth at any refresh rate. Recoil rides on top of the aim pitch.
export function updateCamera(camera, a, alpha, bob) {
  const eye = a.crouch ? MOVE.EYE_CROUCH : MOVE.EYE_STAND;
  camera.position.set(
    a.px + (a.x - a.px) * alpha,
    a.py + (a.y - a.py) * alpha + eye,
    a.pz + (a.z - a.pz) * alpha,
  );
  camera.rotation.set(a.pitch + a.recoil * 0.11 + bob, a.yaw, 0, 'YXZ');
}

// Aim-down-sights narrows the field of view; the render loop eases between the two.
export function targetFov(a, aiming) {
  return aiming && a.alive ? COMBAT.ADS_FOV : COMBAT.HIP_FOV;
}
