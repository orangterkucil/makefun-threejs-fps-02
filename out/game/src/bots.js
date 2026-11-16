// bots.js — the Tidewatch (and Slackwater's two escorts): perception, intent, movement.
//
// Each bot is a small state machine with a named intent, and that name is what the HUD's
// signal trace prints, so the decision a bot made is visible instead of implied. The
// cycle is: perceive (vision cone, range, smoke and geometry), decide (engage, investigate,
// take cover, push, hold, retake, plant, defuse), then move and shoot along the lane graph.
// Perception is re-run on the think interval; only steering and aim are per tick.
import { BOT, GRENADE, MOVE } from './config.js';
import { angleDelta, createActor, distance2, noiseAt, random, randomBetween, state } from './state.js';
import { moveActor } from './player.js';
import { blocked, nearestNode, route } from './world.js';
import { fire, startReload } from './weapons.js';
import { smokeBlocks } from './grenades.js';

export function createBots() {
  state.bots = [
    createActor(1, 'SABLE', 0, -4, 30, 'entry'),
    createActor(2, 'REED', 0, 4, 30, 'support'),
    createActor(3, 'FLINT', 1, -21, -30, 'anchor'),
    createActor(4, 'SHALE', 1, 21, -30, 'anchor'),
    createActor(5, 'CINDER', 1, 0, -32, 'rotator'),
  ];
  state.actors = [state.player, ...state.bots];
}

// --- Perception -------------------------------------------------------------------
// Vision is a cone plus a short peripheral ring, broken by geometry and by smoke. This is
// the only place that decides what a bot can see, so the rule is readable in one screen.
function visibleEnemy(bot, world) {
  let best = null;
  let bestDistance = Infinity;
  const reach = BOT.VIEW_DISTANCE * BOT.VIEW_DISTANCE;
  for (const other of state.actors) {
    if (!other.alive || other.team === bot.team) continue;
    const squared = distance2(bot, other);
    if (squared > reach) continue;
    const distance = Math.sqrt(squared);
    const facing = Math.atan2(bot.x - other.x, bot.z - other.z);
    const inCone = Math.abs(angleDelta(facing, bot.yaw)) < BOT.VIEW_CONE;
    if (!inCone && distance > BOT.PERIPHERAL) continue;
    if (smokeBlocks(bot.x, bot.z, other.x, other.z)) continue;
    if (blocked(bot.x, bot.y + 1.5, bot.z, other.x, other.y + 1.2, other.z, world.colliders)) continue;
    if (distance < bestDistance) { bestDistance = distance; best = other; }
  }
  return best;
}

function heardSomething(bot) {
  for (let i = 0; i < state.noises.length; i++) {
    const noise = state.noises[i];
    if (!noise.live || noise.team === bot.team) continue;
    if (state.time - noise.time > 0.9) continue;
    const squared = (bot.x - noise.x) ** 2 + (bot.z - noise.z) ** 2;
    if (squared < noise.radius * noise.radius) return noise;
  }
  return null;
}

// --- Route planning ---------------------------------------------------------------
// Cold path: only on a new goal, at most a handful of times a second across all bots.
function planRoute(bot, world, x, z) {
  const goal = nearestNode(world.nodes, x, z);
  if (bot.goal === goal && bot.path.length) return;
  const start = nearestNode(world.nodes, bot.x, bot.z);
  bot.goal = goal;
  bot.path = route(world.nodes, start, goal);
  bot.pathIndex = bot.path.length > 1 ? 1 : 0;
}

function objectiveGoal(bot, world) {
  const charge = state.charge;
  if (bot.team === 0) {
    // Attackers: escort the carrier, or carry it themselves to the open site.
    if (charge.carrier === bot.id) {
      const site = world.sites[bot.id % world.sites.length];
      return { x: site.x, z: site.z, intent: 'PLANT' };
    }
    if (charge.carrier === state.player.id) {
      return { x: state.player.x, z: state.player.z, intent: 'ESCORT' };
    }
    const site = world.sites[bot.id % world.sites.length];
    return { x: site.x, z: site.z, intent: 'BREACH' };
  }
  // Defenders: retake a live charge, otherwise hold the post the role owns.
  if (charge.planted) return { x: charge.x, z: charge.z, intent: 'RETAKE' };
  if (bot.role === 'anchor') {
    const site = world.sites[bot.id === 3 ? 0 : 1];
    return { x: site.x, z: site.z, intent: 'HOLD' };
  }
  const sweep = Math.floor(state.time / 9) % 3;
  if (sweep === 0) return { x: world.posts.crossing.x, z: world.posts.crossing.z, intent: 'ROTATE' };
  if (sweep === 1) return { x: world.posts.A.x, z: world.posts.A.z, intent: 'ROTATE' };
  return { x: world.posts.B.x, z: world.posts.B.z, intent: 'ROTATE' };
}

// --- Decision ---------------------------------------------------------------------
// Runs on the think interval. Sets the bot's intent and the goal its route heads for; the
// per-tick code below only steers toward whatever was decided here.
function decide(bot, world) {
  const seen = visibleEnemy(bot, world);
  if (seen) {
    if (bot.targetId !== seen.id) bot.reaction = randomBetween(BOT.REACTION_MIN, BOT.REACTION_MAX);
    bot.targetId = seen.id;
    bot.lastSeen = state.time;
    bot.heardX = seen.x;
    bot.heardZ = seen.z;
    bot.intent = state.time < bot.coverUntil ? 'COVER' : 'ENGAGE';
    return;
  }

  bot.targetId = -1;
  const noise = heardSomething(bot);
  if (noise) {
    bot.heardX = noise.x;
    bot.heardZ = noise.z;
    bot.lastSeen = state.time;
    bot.intent = 'INVESTIGATE';
    planRoute(bot, world, noise.x, noise.z);
    return;
  }

  const goal = objectiveGoal(bot, world);
  bot.intent = goal.intent;
  planRoute(bot, world, goal.x, goal.z);
}

// --- Per-tick behaviour -----------------------------------------------------------
function steerAlongPath(bot, world, speed, dt) {
  if (!bot.path.length) return 0;
  const node = world.nodes[bot.path[Math.min(bot.pathIndex, bot.path.length - 1)]];
  const dx = node.x - bot.x;
  const dz = node.z - bot.z;
  const distance = Math.hypot(dx, dz);
  if (distance < BOT.WAYPOINT_RADIUS && bot.pathIndex < bot.path.length - 1) {
    bot.pathIndex++;
    return 0;
  }
  if (distance < 0.001) return 0;
  const blend = Math.min(1, dt * 9);
  bot.vx += ((dx / distance) * speed - bot.vx) * blend;
  bot.vz += ((dz / distance) * speed - bot.vz) * blend;
  return distance;
}

function turnToward(bot, yaw, dt, rate = BOT.AIM_TURN) {
  const delta = angleDelta(yaw, bot.yaw);
  const step = rate * dt;
  bot.yaw += Math.abs(delta) < step ? delta : Math.sign(delta) * step;
  return delta;
}

export function updateBots(world, dt, audio) {
  for (const bot of state.bots) {
    if (!bot.alive) continue;
    bot.think -= dt;
    bot.reaction = Math.max(0, bot.reaction - dt);

    if (bot.think <= 0) {
      bot.think = BOT.THINK_INTERVAL;
      decide(bot, world);
    }

    const target = bot.targetId >= 0 ? state.actors[bot.targetId] : null;
    if (target && target.alive) {
      const dx = target.x - bot.x;
      const dz = target.z - bot.z;
      const distance = Math.hypot(dx, dz) || 1;
      const aimYaw = Math.atan2(bot.x - target.x, bot.z - target.z);
      bot.aimYaw = aimYaw;
      bot.aimPitch = Math.atan2(target.y + 1.25 - (bot.y + MOVE.EYE_STAND), distance);
      const turned = turnToward(bot, aimYaw, dt);

      // Hold the angle instead of charging: a bot that has seen you stops, and its feet
      // stop moving its cone with it.
      const cover = state.time < bot.coverUntil;
      if (cover) {
        const side = bot.id % 2 === 0 ? 1 : -1;
        const strafeX = Math.cos(bot.yaw) * side * 2.2;
        const strafeZ = -Math.sin(bot.yaw) * side * 2.2;
        bot.vx += (strafeX - bot.vx) * Math.min(1, dt * 8);
        bot.vz += (strafeZ - bot.vz) * Math.min(1, dt * 8);
      } else {
        bot.vx *= Math.max(0, 1 - 6 * dt);
        bot.vz *= Math.max(0, 1 - 6 * dt);
      }

      if (bot.reaction <= 0 && Math.abs(turned) < 0.14 && distance < BOT.VIEW_DISTANCE) {
        const moving = Math.hypot(bot.vx, bot.vz) > 0.8 ? BOT.AIM_ERROR_MOVING : 0;
        const error = BOT.AIM_ERROR + moving;
        const yaw = bot.aimYaw + (random() - 0.5) * error * 2;
        const pitch = bot.aimPitch + (random() - 0.5) * error * 2;
        if (fire(bot, world, audio, yaw, pitch, 1.55)) {
          // Short bursts: bots release the trigger so their cone can settle.
          if (bot.burst > 6) { bot.cooldown = 0.3; bot.burst = 0; }
        }
      }
    } else {
      const speed = bot.intent === 'HOLD' ? 0 : bot.intent === 'ENGAGE' ? BOT.ENGAGE_SPEED : BOT.PATROL_SPEED;
      const distance = steerAlongPath(bot, world, speed, dt);
      if (distance < BOT.WAYPOINT_RADIUS) {
        // On post: sweep the lane slowly so the cone covers more than one angle.
        const sweep = Math.sin(state.time * 0.7 + bot.id) * 0.6;
        turnToward(bot, bot.yaw + sweep * dt * 3, dt, 3);
        bot.vx *= Math.max(0, 1 - 8 * dt);
        bot.vz *= Math.max(0, 1 - 8 * dt);
      } else if (Math.abs(bot.vx) + Math.abs(bot.vz) > 0.05) {
        turnToward(bot, Math.atan2(-bot.vx, -bot.vz), dt, 5);
      }
      bot.aimYaw = bot.yaw;
      bot.aimPitch = 0;
    }

    moveActor(bot, bot.vx * dt, bot.vz * dt, world, dt);

    bot.step += Math.hypot(bot.vx, bot.vz) * dt;
    if (bot.step > 3.1) {
      bot.step = 0;
      if (Math.hypot(bot.vx, bot.vz) > 1) noiseAt(bot, MOVE.STEP_NOISE, 'step');
    }

    if (bot.mag === 0) startReload(bot, audio);

    // Utility use: a defender with a veil breaks the lane it is holding, an attacker with
    // a frag softens the site it is about to enter. Both are rare, deliberate throws.
    if (bot.intent === 'RETAKE' && bot.veils > 0 && random() < dt * 0.25) {
      bot.veils--;
      state.grenades.push({
        kind: 'veil', x: bot.x, y: bot.y + GRENADE.THROW_LIFT, z: bot.z,
        vx: -Math.sin(bot.yaw) * 9, vy: 3.4, vz: -Math.cos(bot.yaw) * 9,
        fuse: GRENADE.SMOKE_FUSE, owner: bot.id, team: bot.team,
      });
    }
  }
}

// Charge custody: an attacker bot standing on the site arms the charge, which is the same
// progress the player earns by holding E. Kept next to the planner so the rule reads here.
export function botPlantProgress(bot, world) {
  if (bot.team !== 0 || !bot.alive || state.charge.planted) return false;
  if (state.charge.carrier !== bot.id) return false;
  for (const site of world.sites) {
    if (distance2(bot, site) < site.radius * site.radius && Math.hypot(bot.vx, bot.vz) < 0.9) {
      bot.intent = 'PLANT';
      return true;
    }
  }
  return false;
}

export function defenderOnCharge(bot, world) {
  if (bot.team !== 1 || !bot.alive || !state.charge.planted) return false;
  if (distance2(bot, state.charge) > 9) return false;
  if (blocked(bot.x, 1, bot.z, state.charge.x, 0.4, state.charge.z, world.colliders)) return false;
  bot.intent = 'DEFUSE';
  return true;
}
