// poses.js — the four capture states, built from the real simulation.
//
// A pose is not a mock-up: it moves the same actors, arms the same charge and fills the
// same HUD the player uses, then freezes the clock so a headless capture is reproducible
// from the seed. Every value here is a decision about what the screenshot should prove.
import { PHASE } from './config.js';
import { addTracer, pushFeed, state } from './state.js';
import { equip } from './weapons.js';

// Place one operator: position, facing, and whatever stance the shot needs.
function place(actor, x, z, yaw, options = {}) {
  actor.x = x; actor.y = options.y ?? 0; actor.z = z;
  actor.px = actor.x; actor.py = actor.y; actor.pz = actor.z;
  actor.vx = 0; actor.vy = 0; actor.vz = 0;
  actor.yaw = yaw;
  actor.aimYaw = yaw;
  actor.pitch = options.pitch ?? 0;
  actor.crouch = Boolean(options.crouch);
  actor.alive = options.alive !== false;
  actor.hp = options.hp ?? (actor.alive ? 100 : 0);
  actor.armor = options.armor ?? 0;
  actor.intent = options.intent ?? (actor.team === 0 ? 'BREACH' : 'HOLD');
  actor.flash = options.flash ?? 0;
  if (options.weapon) equip(actor, options.weapon);
  if (options.mag !== undefined) actor.mag = options.mag;
  if (options.reserve !== undefined) actor.reserve = options.reserve;
}

function tracer(from, to) {
  addTracer(from.x, from.y + 1.5, from.z, to.x, to.y + 1.2, to.z, 6);
}

export function pose(name, world, audio) {
  const player = state.player;
  const [sable, reed, flint, shale, cinder] = state.bots;

  state.shot = name;
  state.started = true;
  state.paused = false;
  state.buyOpen = false;
  state.aiming = false;
  state.time = 12;
  state.phase = PHASE.BREACH;
  state.round = 5;
  state.score = [3, 2];
  state.money = 4350;
  state.timer = 74;
  state.hitFlash = 0;
  state.damageFlash = 0;
  state.kills = 6;
  state.deaths = 3;
  state.feed.length = 0;
  state.charge.planted = false;
  state.charge.carrier = player.id;
  state.charge.plant = 0;
  state.charge.defuse = 0;

  // A standing cast: the player mid-site, two escorts, three defenders.
  place(player, -20, -14, -0.34, { weapon: 'rifle', mag: 21, reserve: 90, armor: 78, hp: 88 });
  place(sable, -24, -10, -0.2, { weapon: 'rifle', mag: 18, armor: 60, intent: 'BREACH' });
  place(reed, -16, -12, -0.6, { weapon: 'smg', mag: 12, armor: 40, intent: 'BREACH' });
  place(flint, -21, -21, Math.PI, { weapon: 'rifle', mag: 9, armor: 100, intent: 'HOLD', crouch: true });
  place(shale, -14, -20, Math.PI + 0.4, { weapon: 'rifle', mag: 14, armor: 100, intent: 'ROTATE' });
  place(cinder, 6, -19, Math.PI - 0.5, { weapon: 'smg', mag: 20, armor: 100, intent: 'ROTATE' });
  player.frags = 2;
  player.veils = 1;
  player.kills = 6;
  player.deaths = 3;
  player.damage = 412;

  if (name === 'breach') {
    // The cover: a live firefight over an armed charge, with the retake already underway.
    // The player stands at the mouth of the west lane, the pad and the defuser in view, a
    // tracer coming back the other way, so the frame says "contested objective" at once.
    state.phase = PHASE.ARMED;
    state.timer = 21.4;
    state.charge.planted = true;
    state.charge.site = 'A';
    state.charge.x = -21.9;
    state.charge.z = -22.6;
    state.charge.fuse = 21.4;
    state.charge.defuse = 2.6;
    place(player, -18.2, -10.5, 0.24, { weapon: 'rifle', mag: 21, reserve: 90, armor: 78, hp: 88 });
    player.pitch = -0.035;
    player.flash = 0.05;
    player.recoil = 0.2;
    place(sable, -23.6, -17.2, 0.16, { weapon: 'rifle', mag: 18, armor: 60, intent: 'HOLD' });
    place(reed, -14.6, -13.2, 0.55, { weapon: 'smg', mag: 12, armor: 40, intent: 'HOLD' });
    place(flint, -20.4, -22.0, Math.PI + 0.54, { weapon: 'rifle', mag: 9, armor: 100, intent: 'DEFUSE', crouch: true });
    place(shale, -25.2, -19.4, Math.PI + 0.45, { weapon: 'rifle', mag: 14, armor: 100, intent: 'ENGAGE', flash: 0.05 });
    place(cinder, 2.5, -17.5, Math.PI - 0.6, { weapon: 'smg', mag: 20, armor: 100, intent: 'RETAKE' });
    state.objective = {
      kicker: 'MISSION / DEFEND',
      text: 'Tidewatch is disarming at A',
      sub: 'FLINT on the charge · 2.6s of 7s · contest the pad',
    };
    tracer({ x: -25.2, y: 1.35, z: -19.4 }, { x: -19.0, y: 1.4, z: -11.4 });
    tracer({ x: -23.6, y: 1.35, z: -17.2 }, { x: -21.6, y: 0.9, z: -22.2 });
    state.hitFlash = 1;
    state.damageFlash = 0.22;
    pushFeed('SABLE · HIT · SHALE', 0);
    pushFeed('CHARGE ARMED AT A', 0);
    pushFeed('FLINT · DEFUSE START', 1);
    pushFeed('REED · HIT · CINDER', 0);
  }

  if (name === 'overview') {
    // The map read from above: every lane, both pads, and the operators mid-round.
    state.overview = true;
    state.phase = PHASE.ARMED;
    state.timer = 18.2;
    state.charge.planted = true;
    state.charge.site = 'B';
    state.charge.x = 21;
    state.charge.z = -23;
    state.charge.fuse = 18.2;
    state.charge.defuse = 0;
    place(player, 15, -17, -0.5, { weapon: 'rifle', mag: 24, armor: 90, hp: 100 });
    place(sable, 12, -20, -0.2, { weapon: 'rifle', mag: 21, armor: 100, intent: 'HOLD' });
    place(reed, 8, -16, 0.3, { weapon: 'smg', mag: 30, armor: 60, intent: 'HOLD' });
    place(flint, 24.5, -21.5, Math.PI, { weapon: 'rifle', mag: 20, armor: 100, intent: 'RETAKE' });
    place(shale, 20, -28, Math.PI - 0.2, { weapon: 'rifle', mag: 17, armor: 100, intent: 'RETAKE', crouch: true });
    place(cinder, 2, -19, Math.PI / 2, { weapon: 'smg', mag: 22, armor: 100, intent: 'ROTATE' });
    state.objective = {
      kicker: 'MAP / PUMP HOUSE SEVEN',
      text: 'Three lanes, two pump sites, one crossing',
      sub: 'West lane · valve hall · east lane · the arc behind the hall is the rotate',
    };
    pushFeed('CHARGE ARMED AT B', 0);
    pushFeed('SHALE · HIT · REED', 1);
  }

  if (name === 'ads') {
    // Weapon detail: sights on a defender down the valve hall, steady and aimed.
    state.phase = PHASE.BREACH;
    state.timer = 61;
    state.aiming = true;
    place(player, 0.4, 7.5, 0.02, { weapon: 'rifle', mag: 27, reserve: 90, armor: 100, hp: 100 });
    player.pitch = -0.012;
    place(sable, -4.5, 2, 0.1, { weapon: 'rifle', mag: 22, armor: 100, intent: 'HOLD' });
    place(reed, 4.6, -1.5, 0.1, { weapon: 'smg', mag: 26, armor: 60, intent: 'HOLD' });
    place(flint, -1.2, -6.5, Math.PI, { weapon: 'rifle', mag: 18, armor: 100, intent: 'HOLD' });
    place(shale, 1.6, -13, Math.PI + 0.1, { weapon: 'rifle', mag: 15, armor: 100, intent: 'HOLD' });
    place(cinder, -3.2, -16.5, Math.PI - 0.3, { weapon: 'smg', mag: 24, armor: 100, intent: 'ROTATE' });
    state.charge.carrier = player.id;
    state.objective = {
      kicker: 'MISSION / BREACH',
      text: 'Hold the valve hall and take the crossing',
      sub: 'Sights on FLINT at 14m · a still rifle is an accurate rifle',
    };
  }

  if (name === 'debrief') {
    // The round board: who won, what it paid, and the match score behind it.
    state.phase = PHASE.OVER;
    state.round = 6;
    state.score = [4, 2];
    state.timer = 4;
    state.roundWinner = 0;
    state.roundReason = 'SLACKWATER · CHARGE DETONATED';
    state.roundPayout = 3250;
    state.money = 7600;
    state.charge.planted = false;
    state.charge.plant = 0;
    place(player, 6, -12, -0.2, { weapon: 'rifle', mag: 19, armor: 90, hp: 46 });
    player.kills = 9;
    player.deaths = 4;
    player.damage = 731;
    place(sable, 10, -14, 0.3, { weapon: 'rifle', mag: 12, armor: 70, alive: false });
    place(reed, 2, -18, -0.4, { weapon: 'smg', mag: 8, armor: 40 });
    place(flint, 18, -20, Math.PI, { weapon: 'rifle', mag: 0, armor: 0, alive: false });
    place(shale, 22, -26, Math.PI - 0.2, { weapon: 'rifle', mag: 6, armor: 20, alive: false });
    place(cinder, 12, -24, Math.PI + 0.2, { weapon: 'smg', mag: 11, armor: 55 });
    sable.kills = 5; sable.deaths = 5; sable.damage = 388;
    reed.kills = 3; reed.deaths = 4; reed.damage = 264;
    flint.kills = 4; flint.deaths = 5; flint.damage = 301;
    shale.kills = 2; shale.deaths = 6; shale.damage = 176;
    cinder.kills = 5; cinder.deaths = 4; cinder.damage = 342;
    state.objective = {
      kicker: 'ROUND 06 / DEBRIEF',
      text: 'The charge went off inside the east gallery',
      sub: 'Tidewatch retakes next round · spend the payout',
    };
    pushFeed('CHARGE DETONATED', 0);
  }

  // Snapshot the previous transform so the first rendered frame has nothing to interpolate.
  for (const actor of state.actors) {
    actor.px = actor.x;
    actor.py = actor.y;
    actor.pz = actor.z;
  }
  if (audio) audio.unlock();
  return world;
}
