// main.js — the entry point: renderer, lights, the fixed-step loop and the input wiring.
//
// The simulation runs at a fixed 60 Hz no matter what the display does; the renderer
// interpolates between the last two ticks. That split is the whole architecture of the
// game: state.js + world.js + player.js + weapons.js + bots.js + rounds.js simulate, and
// render.js + hud.js present. main.js only connects them.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { FIXED_DT, MAX_FRAME_DT, PHASE } from './config.js';
import { createActor, seedRandom, state } from './state.js';
import { auditRoutes, buildWorld } from './world.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createBots, updateBots } from './bots.js';
import { buy, fire, startReload, tickWeapon } from './weapons.js';
import { throwGrenade, updateGrenades, FRAG, VEIL } from './grenades.js';
import { startRound, updateRounds } from './rounds.js';
import { createRender } from './render.js';
import { createHud } from './hud.js';
import { pose } from './poses.js';
import { updateCamera, updatePlayer } from './player.js';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || 1;
const shotName = params.get('shot') || '';
const BUY_SLOTS = 6;
seedRandom(seed);

// --- Renderer and scene -----------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(PALETTE.sky);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
const fog = new THREE.Fog(PALETTE.fog, PALETTE.fogNear, PALETTE.fogFar);
scene.fog = fog;

// Late afternoon on a salt pan: a warm key from the west, a cold sky fill, no shadows.
const key = new THREE.DirectionalLight(0xffe3bd, 2.35);
key.position.set(-30, 46, 22);
scene.add(key);
const fill = new THREE.DirectionalLight(0x9fd4d8, 0.75);
fill.position.set(26, 18, -28);
scene.add(fill);
scene.add(new THREE.HemisphereLight(0xd6ecec, 0x8a7f66, 1.35));

const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.05, 240);
scene.add(camera);

// --- World, actors, round ---------------------------------------------------------
const world = buildWorld(scene);
const audio = createAudio();
state.player = createActor(0, 'SALT', 0, 0, 30, 'entry');
createBots();
startRound(world);

const render = createRender(scene, camera);
const input = createInput(renderer.domElement, state, audio);
const hud = createHud(world);
const canvas = renderer.domElement;

document.getElementById('play').onclick = () => {
  state.started = true;
  state.paused = false;
  audio.unlock();
  canvas.requestPointerLock();
};

// --- One fixed simulation step ----------------------------------------------------
// Order matters and is readable: timers, then the player's intent, then the bots, then
// the round machine, which is the only thing allowed to end a round.
function step(dt) {
  state.time += dt;
  state.tick++;
  for (const actor of state.actors) {
    actor.px = actor.x;
    actor.py = actor.y;
    actor.pz = actor.z;
    tickWeapon(actor, dt);
  }

  const live = state.phase === PHASE.BREACH || state.phase === PHASE.ARMED;
  const player = state.player;

  // Armory: open only in preparation, and the keys are swallowed either way so a stale
  // press cannot fire a shot when the round goes live.
  if (input.consume('KeyB')) {
    if (state.phase === PHASE.PREP) state.buyOpen = !state.buyOpen;
    else state.buyOpen = false;
  }
  for (let slot = 1; slot <= BUY_SLOTS; slot++) {
    const pressed = input.consume(`Digit${slot}`);
    if (pressed && state.buyOpen && state.phase === PHASE.PREP) {
      const result = buy(slot);
      if (!result.ok && result.reason) state.objective.sub = `${result.reason.toUpperCase()} · funds $ ${state.money}`;
    }
  }

  if (input.consume('KeyR')) startReload(player, audio);
  if (input.consume('KeyG')) throwGrenade(player, FRAG, audio);
  if (input.consume('KeyF')) throwGrenade(player, VEIL, audio);

  state.aiming = input.aim && player.alive && !state.buyOpen;
  player.aiming = state.aiming;

  const canControl = live && !state.buyOpen;
  updatePlayer(player, input, world, dt, canControl, audio);

  if (canControl && input.fire) {
    fire(player, world, audio, player.yaw, player.pitch + player.recoil * 0.11, 1);
  }

  if (live) {
    updateBots(world, dt, audio);
    updateGrenades(world, dt, audio);
  }
  updateRounds(world, input, dt, audio);

  state.hitFlash = Math.max(0, state.hitFlash - dt * 6);
  state.damageFlash = Math.max(0, state.damageFlash - dt * 2.2);
}

// --- Frame loop -------------------------------------------------------------------
let lastFrame = performance.now();
let accumulator = 0;
let bobPhase = 0;

function frame(now) {
  const frameDt = Math.min(MAX_FRAME_DT, (now - lastFrame) / 1000);
  lastFrame = now;
  state.paused = state.started && !input.locked && !state.shot;

  if (state.started && !state.shot && !state.paused && !state.buyOpen) {
    accumulator += frameDt;
    while (accumulator >= FIXED_DT) {
      step(FIXED_DT);
      accumulator -= FIXED_DT;
    }
  }
  const alpha = state.shot ? 1 : Math.min(1, accumulator / FIXED_DT);

  if (state.overview) {
    // The capture camera: a steep three-quarter view, fog off so both sites read at once.
    scene.fog = null;
    camera.position.set(0, 56, 40);
    camera.rotation.set(-0.9, 0, 0);
    camera.fov = 62;
    camera.updateProjectionMatrix();
  } else {
    scene.fog = fog;
    const speed = Math.hypot(state.player.vx, state.player.vz);
    bobPhase += frameDt * speed * 2.4;
    const bob = Math.sin(bobPhase) * Math.min(0.012, speed * 0.002);
    updateCamera(camera, state.player, alpha, bob);
  }

  render(alpha, frameDt);
  hud(input);
  renderer.render(scene, camera);
  window.__shotReady = true;
  if (window.__saltline) window.__saltline.frameCount++;
  requestAnimationFrame(frame);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- Capture poses and the inspection surface ------------------------------------
if (shotName) {
  pose(shotName, world, audio);
  state.paused = false;
}

// A small, explicit surface for browser checks: the route audit, the live state, and the
// frame counter. No network access anywhere in the game.
window.__saltline = {
  state,
  world,
  step,
  renderer,
  camera,
  audit: () => auditRoutes(world),
  frameCount: 0,
  pose: (name) => pose(name, world, audio),
};

requestAnimationFrame(frame);
