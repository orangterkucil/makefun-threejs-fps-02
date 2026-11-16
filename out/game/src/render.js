// render.js — everything the player sees: operators, the view weapon, and the effects.
//
// Rendering only reads the simulation. Actors are interpolated between the last two ticks
// so a fixed 60 Hz step looks smooth at any refresh rate, and every mesh is built once at
// load: no geometry, material or object is created inside the frame loop.
//
// The view weapon is modelled on its own bore line — rear aperture, front post and muzzle
// all at y = 0 — and both holds are three-quarter, so a rifle reads as a rifle at 720p.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { COMBAT, GRENADE, PHASE } from './config.js';
import { state } from './state.js';

const TRACER_CAPACITY = 48;
const SMOKE_PUFFS = 7;
const SMOKE_CAPACITY = 24;
const TRACER_WIDTH = 0.055;
const TRACER_LENGTH = 6;
const TRACER_NEAR_SQ = 2.6 * 2.6;

// Hip and aim transforms, in the weapon group's own space. The model's origin is the rear
// aperture; both poses hold the weapon down and to the right so the receiver, rail and
// barrel are seen in perspective rather than end-on.
const HIP_POSE = { x: 0.28, y: -0.17, z: -0.56, yaw: 0.3, pitch: 0.05, roll: 0.1 };
// The aim pose lifts and tightens the same three-quarter hold: the stock stays in the lower
// right of frame and the barrel swings in to point at the crosshair, so the weapon reads as
// a long shape aimed at the target instead of a block foreshortened straight down the lens.
const AIM_POSE = { x: 0.26, y: -0.19, z: -0.52, yaw: 0.34, pitch: 0.05, roll: 0.05 };

// The view weapon is lit by its own emissive term as well as the scene: held a hand's width
// from the lens it would otherwise be a silhouette against a bright sky.
function viewMaterial(colour) {
  return new THREE.MeshLambertMaterial({
    color: colour,
    emissive: new THREE.Color(colour).multiplyScalar(0.42),
  });
}

export function createRender(scene, camera) {
  const materials = {};
  for (const [name, colour] of Object.entries(PALETTE)) {
    if (typeof colour !== 'number') continue;
    materials[name] = new THREE.MeshLambertMaterial({ color: colour });
    materials[name + 'View'] = viewMaterial(colour);
  }
  const glow = (colour, opacity = 1) => new THREE.MeshBasicMaterial({
    color: colour,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
  });
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  function part(parent, x, y, z, w, h, d, colour, view = false) {
    const key = view ? colour + 'View' : colour;
    const mesh = new THREE.Mesh(unitBox, materials[key] || materials.concrete);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    parent.add(mesh);
    return mesh;
  }

  // --- Operators ------------------------------------------------------------------
  // A box soldier reads at distance: shoulders, a helmet with a team band, a plate vest,
  // a pack, two bent arms holding a rifle, and legs that swing. The silhouette is
  // deliberately top-heavy so a head is a head at forty metres.
  function buildSoldier(actor) {
    const root = new THREE.Group();
    const suit = actor.team === 0 ? 'ally' : 'enemy';
    const suitDark = actor.team === 0 ? 'allyDark' : 'enemyDark';

    part(root, 0, 0.94, 0, 0.44, 0.26, 0.3, 'steel'); // hips
    part(root, 0, 1.24, 0, 0.52, 0.52, 0.32, suit); // torso
    part(root, 0, 1.22, -0.18, 0.46, 0.44, 0.1, 'steelLight'); // plate
    part(root, 0, 1.26, 0.21, 0.36, 0.36, 0.16, 'rust'); // pack
    for (const side of [-1, 1]) part(root, side * 0.32, 1.42, 0, 0.18, 0.2, 0.3, suitDark); // shoulders
    part(root, 0, 1.54, 0, 0.26, 0.14, 0.24, 'steel'); // neck
    part(root, 0, 1.69, 0, 0.34, 0.26, 0.36, suitDark); // helmet
    part(root, 0, 1.62, -0.17, 0.24, 0.11, 0.07, 'bone'); // visor
    part(root, 0, 1.84, 0, 0.12, 0.05, 0.3, suit); // crest
    part(root, 0, 1.5, -0.16, 0.2, 0.1, 0.04, 'ally'); // collar light

    const legs = [];
    for (const x of [-0.13, 0.13]) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.92, 0);
      part(leg, 0, -0.24, 0, 0.19, 0.46, 0.22, suitDark);
      part(leg, 0, -0.66, 0, 0.17, 0.4, 0.2, 'steel');
      part(leg, 0, -0.9, -0.04, 0.21, 0.13, 0.32, 'steel');
      root.add(leg);
      legs.push(leg);
    }

    // Two-segment arms: the elbow bend is what stops a limb reading as a stick.
    const arms = [];
    for (const side of [-1, 1]) {
      const upper = new THREE.Group();
      upper.position.set(side * 0.3, 1.4, 0);
      upper.rotation.x = -0.5;
      upper.rotation.z = side * 0.14;
      part(upper, 0, -0.15, 0, 0.15, 0.3, 0.16, suit);
      const fore = new THREE.Group();
      fore.position.set(0, -0.29, 0);
      fore.rotation.x = -1.05;
      part(fore, 0, -0.13, 0, 0.13, 0.28, 0.14, suit);
      part(fore, 0, -0.29, 0, 0.13, 0.11, 0.14, 'bone'); // glove
      upper.add(fore);
      root.add(upper);
      arms.push(upper);
    }

    const rifle = new THREE.Group();
    rifle.position.set(0.08, 1.28, -0.26);
    part(rifle, 0, 0, -0.04, 0.07, 0.1, 0.34, 'steel');
    part(rifle, 0, -0.01, -0.32, 0.06, 0.07, 0.26, 'steelLight');
    part(rifle, 0, 0, -0.52, 0.03, 0.03, 0.2, 'steel');
    part(rifle, 0, -0.11, -0.04, 0.05, 0.16, 0.08, 'steelLight');
    part(rifle, 0, 0.01, 0.16, 0.05, 0.07, 0.16, 'steel');
    root.add(rifle);

    const flash = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 0), glow(PALETTE.chargeHot, 0.9));
    flash.position.set(0.08, 1.28, -0.86);
    flash.scale.set(0.7, 0.7, 2.6);
    flash.visible = false;
    root.add(flash);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.52, 14),
      glow(PALETTE.shadow, 0.22),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    root.add(shadow);

    scene.add(root);
    return { actor, root, legs, arms, flash, rifle };
  }

  const soldiers = state.bots.map(buildSoldier);

  // --- View weapon ----------------------------------------------------------------
  // The group's origin is the rear aperture: local -z runs down the barrel, local +z runs
  // back to the stock, which sits behind the eye and therefore out of frame when aiming.
  // Every gun is built from the same vocabulary — sight frame, rail, receiver, handguard,
  // magazine, grip, stock, two hands — so the four weapons read as one armoury.
  function buildViewWeapon(id) {
    const group = new THREE.Group();
    const p = (x, y, z, w, h, d, colour) => part(group, x, y, z, w, h, d, colour, true);
    // A bright square aperture around a bright front post: the sights are the one part of
    // the weapon a player must find in a single glance, so they carry the light colour.
    const aperture = (half, thickness, depth) => {
      p(half, 0, -0.005, thickness, half * 2 + thickness, depth, 'bone');
      p(-half, 0, -0.005, thickness, half * 2 + thickness, depth, 'bone');
      p(0, half, -0.005, half * 2 + thickness, thickness, depth, 'bone');
      p(0, -half, -0.005, half * 2 + thickness, thickness, depth, 'bone');
    };

    if (id === 'rifle') {
      // The bore sits a hand's width under the sight line, so from behind the aperture the
      // handguard and barrel are visible *over* the receiver, converging on the target.
      aperture(0.028, 0.014, 0.02);
      p(0, -0.03, -0.02, 0.07, 0.03, 0.05, 'steel'); // sight mount
      p(0, -0.038, -0.2, 0.05, 0.012, 0.36, 'steelLight'); // rail
      p(0, -0.075, -0.2, 0.075, 0.07, 0.34, 'steel'); // receiver
      p(0.04, -0.06, -0.22, 0.005, 0.026, 0.1, 'steelLight'); // ejection port
      p(-0.045, -0.075, -0.06, 0.02, 0.02, 0.07, 'steelLight'); // charging handle
      p(0, -0.055, -0.5, 0.062, 0.055, 0.28, 'steelLight'); // handguard
      for (let z = -0.4; z > -0.62; z -= 0.045) p(0, -0.024, z, 0.04, 0.01, 0.024, 'steel');
      p(0, -0.05, -0.72, 0.026, 0.026, 0.16, 'steel'); // barrel
      p(0, -0.05, -0.82, 0.042, 0.042, 0.05, 'steel'); // brake
      p(0, -0.035, -0.66, 0.034, 0.03, 0.04, 'steel'); // front base
      p(0, -0.012, -0.66, 0.009, 0.045, 0.012, 'bone'); // front post
      p(0, -0.19, -0.14, 0.055, 0.17, 0.1, 'steelLight'); // magazine
      p(0, -0.19, 0.02, 0.05, 0.15, 0.09, 'steel'); // grip
      p(0, -0.075, 0.16, 0.05, 0.08, 0.2, 'steel'); // stock
      p(0, -0.075, 0.27, 0.056, 0.1, 0.03, 'steelLight'); // butt
      p(0.045, -0.075, -0.3, 0.006, 0.028, 0.16, 'ally'); // team stripe
      p(0.035, -0.17, 0.02, 0.085, 0.1, 0.12, 'bone'); // firing hand
      p(-0.002, -0.11, -0.46, 0.095, 0.075, 0.13, 'bone'); // support hand
    } else if (id === 'smg') {
      aperture(0.036, 0.018, 0.026);
      p(0, -0.028, -0.14, 0.05, 0.018, 0.3, 'steelLight');
      p(0, -0.08, -0.14, 0.08, 0.085, 0.3, 'steel');
      p(0.042, -0.06, -0.16, 0.005, 0.024, 0.09, 'steelLight');
      p(0, -0.08, -0.38, 0.065, 0.07, 0.2, 'steelLight');
      p(0, -0.075, -0.52, 0.026, 0.026, 0.1, 'steel');
      p(0, -0.012, -0.42, 0.009, 0.042, 0.01, 'bone');
      p(0, -0.21, -0.06, 0.05, 0.19, 0.08, 'steelLight');
      p(0, -0.18, 0.06, 0.05, 0.14, 0.08, 'steel');
      p(0, -0.07, 0.15, 0.048, 0.08, 0.16, 'steel');
      p(0.046, -0.08, -0.26, 0.006, 0.026, 0.14, 'ally');
      p(0.035, -0.17, 0.05, 0.085, 0.095, 0.11, 'bone');
      p(-0.004, -0.15, -0.36, 0.09, 0.075, 0.12, 'bone');
    } else if (id === 'shotgun') {
      aperture(0.03, 0.018, 0.026);
      p(0, -0.09, -0.16, 0.09, 0.1, 0.36, 'rust');
      p(0, -0.08, -0.55, 0.05, 0.05, 0.34, 'steel');
      p(0, -0.14, -0.5, 0.08, 0.06, 0.2, 'steelLight'); // pump
      p(0, -0.06, -0.76, 0.014, 0.014, 0.014, 'chargeHot'); // bead
      p(0, -0.2, 0.04, 0.05, 0.15, 0.09, 'rust');
      p(0, -0.08, 0.16, 0.05, 0.1, 0.22, 'rust');
      p(0, -0.08, 0.28, 0.055, 0.12, 0.03, 'steelLight');
      p(0.035, -0.18, 0.04, 0.085, 0.095, 0.11, 'bone');
      p(-0.004, -0.16, -0.5, 0.095, 0.075, 0.13, 'bone');
    } else {
      p(0.016, 0, -0.005, 0.012, 0.045, 0.02, 'steel');
      p(-0.016, 0, -0.005, 0.012, 0.045, 0.02, 'steel');
      p(0, -0.04, -0.005, 0.05, 0.016, 0.02, 'steel');
      p(0, -0.06, -0.12, 0.055, 0.08, 0.28, 'steel');
      p(0, -0.028, -0.12, 0.045, 0.018, 0.26, 'steelLight');
      p(0, -0.11, -0.1, 0.05, 0.05, 0.2, 'steelLight');
      p(0, -0.19, 0.04, 0.05, 0.17, 0.09, 'steel');
      p(0, -0.01, -0.26, 0.009, 0.03, 0.009, 'bone');
      p(0.028, -0.16, 0.04, 0.075, 0.09, 0.1, 'bone');
    }
    const muzzle = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), glow(PALETTE.chargeHot, 0.95));
    muzzle.position.set(0, id === 'pistol' ? -0.06 : -0.08, { rifle: -0.86, smg: -0.58, shotgun: -0.8, pistol: -0.3 }[id]);
    muzzle.scale.set(0.55, 0.55, 1.9);
    muzzle.visible = false;
    group.add(muzzle);
    group.visible = false;
    camera.add(group);
    return { group, muzzle };
  }

  const viewWeapons = {
    rifle: buildViewWeapon('rifle'),
    smg: buildViewWeapon('smg'),
    shotgun: buildViewWeapon('shotgun'),
    pistol: buildViewWeapon('pistol'),
  };

  // --- Charge, effects -------------------------------------------------------------
  const charge = new THREE.Group();
  part(charge, 0, 0.24, 0, 0.9, 0.44, 0.7, 'steel');
  part(charge, 0, 0.5, 0, 0.66, 0.1, 0.48, 'charge');
  const chargeLamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.16), glow(PALETTE.chargeHot));
  chargeLamp.position.set(0, 0.6, 0);
  charge.add(chargeLamp);
  // A beacon over the charge: at twelve metres the box alone is a dark smudge, so the site
  // carries a saturated mast and a lamp that stay legible against the pale walls.
  const beacon = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 1.7, 0.16),
    new THREE.MeshBasicMaterial({ color: PALETTE.enemy }),
  );
  beacon.position.set(0, 1.45, 0);
  charge.add(beacon);
  const beaconLamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), glow(PALETTE.chargeHot));
  beaconLamp.position.set(0, 2.4, 0);
  charge.add(beaconLamp);
  const chargeRing = new THREE.Mesh(
    new THREE.RingGeometry(1.05, 1.2, 36),
    new THREE.MeshBasicMaterial({ color: PALETTE.charge, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }),
  );
  chargeRing.rotation.x = -Math.PI / 2;
  chargeRing.position.y = 0.03;
  charge.add(chargeRing);
  scene.add(charge);

  // Site marks: two columns that appear only on the overview, so the map names its objectives.
  const siteMarks = new THREE.Group();
  for (const [x, z, label] of [[-21, -23, 'A'], [21, -23, 'B']]) {
    const column = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7, 0.4), glow(PALETTE.charge, 0.5));
    column.position.set(x, 3.5, z);
    siteMarks.add(column);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.6, 4.0, 40),
      new THREE.MeshBasicMaterial({ color: PALETTE.charge, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.05, z);
    siteMarks.add(ring);
    const letter = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 1.6), glow(PALETTE.bone, 0.35));
    letter.position.set(x, 7.4, z);
    letter.name = `site-${label}`;
    siteMarks.add(letter);
  }
  siteMarks.visible = false;
  scene.add(siteMarks);

  // Tracers are thin boxes, not lines: a line is one pixel wide at any distance.
  const tracerMesh = new THREE.InstancedMesh(
    unitBox,
    new THREE.MeshBasicMaterial({ color: PALETTE.tracer, transparent: true, opacity: 0.92, depthWrite: false }),
    TRACER_CAPACITY,
  );
  tracerMesh.count = 0;
  tracerMesh.frustumCulled = false;
  scene.add(tracerMesh);

  const grenadeMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.13, 0), materials.steel, 8);
  grenadeMesh.count = 0;
  scene.add(grenadeMesh);

  const smokeMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 10, 8),
    new THREE.MeshBasicMaterial({ color: PALETTE.veil, transparent: true, opacity: 0.34, depthWrite: false }),
    SMOKE_CAPACITY * SMOKE_PUFFS,
  );
  smokeMesh.count = 0;
  scene.add(smokeMesh);

  const blast = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: PALETTE.charge, wireframe: true, transparent: true, opacity: 0.55 }),
  );
  blast.visible = false;
  scene.add(blast);

  const matrix = new THREE.Matrix4();
  const vector = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const forward = new THREE.Vector3(0, 0, 1);
  const sc = new THREE.Vector3();
  let adsBlend = 0;
  let activeWeapon = '';
  let swayPhase = 0;

  function updateWeapon(dt) {
    const player = state.player;
    const id = player.weapon;
    if (activeWeapon !== id) {
      for (const key of Object.keys(viewWeapons)) viewWeapons[key].group.visible = false;
      activeWeapon = id;
    }
    const view = viewWeapons[id];
    view.group.visible = player.alive && !state.overview;

    const aiming = state.aiming && player.alive && state.phase !== PHASE.PREP;
    adsBlend += ((aiming ? 1 : 0) - adsBlend) * Math.min(1, dt * 14);

    // Sway and bob shrink as you settle: a still player has a still rifle.
    const speed = Math.hypot(player.vx, player.vz);
    const movement = Math.min(1, speed / 4.4);
    swayPhase += dt * (1.4 + movement * 6.5);
    const swayX = Math.sin(swayPhase) * 0.012 * movement;
    const swayY = Math.cos(swayPhase * 2) * 0.008 * movement;
    const kick = player.recoil * 0.045;

    view.group.position.set(
      HIP_POSE.x + (AIM_POSE.x - HIP_POSE.x) * adsBlend + swayX,
      HIP_POSE.y + (AIM_POSE.y - HIP_POSE.y) * adsBlend + swayY + kick * 0.4,
      HIP_POSE.z + (AIM_POSE.z - HIP_POSE.z) * adsBlend + player.recoil * 0.03,
    );
    view.group.rotation.set(
      HIP_POSE.pitch + (AIM_POSE.pitch - HIP_POSE.pitch) * adsBlend + player.recoil * 0.06,
      HIP_POSE.yaw + (AIM_POSE.yaw - HIP_POSE.yaw) * adsBlend,
      HIP_POSE.roll + (AIM_POSE.roll - HIP_POSE.roll) * adsBlend + (player.reload > 0 ? -0.5 : 0),
    );
    // A reload drops the muzzle out of frame for the length of the animation.
    if (player.reload > 0) {
      view.group.position.y -= 0.16;
      view.group.rotation.y += 0.3;
    }
    view.muzzle.visible = player.flash > 0;
    view.muzzle.scale.set(0.55 + player.recoil * 0.2, 0.55 + player.recoil * 0.2, 1.9);
  }

  function updateSoldiers(alpha) {
    for (let i = 0; i < soldiers.length; i++) {
      const soldier = soldiers[i];
      const actor = soldier.actor;
      const x = actor.px + (actor.x - actor.px) * alpha;
      const y = actor.py + (actor.y - actor.py) * alpha;
      const z = actor.pz + (actor.z - actor.pz) * alpha;
      soldier.root.position.set(x, y, z);

      if (!actor.alive) {
        soldier.root.rotation.set(-Math.PI / 2, actor.yaw, 0);
        soldier.root.position.y = y + 0.22;
        soldier.flash.visible = false;
        continue;
      }
      soldier.root.rotation.set(0, actor.yaw, 0);
      soldier.root.scale.y = actor.crouch ? 0.8 : 1;
      const speed = Math.hypot(actor.vx, actor.vz);
      const stride = Math.min(1, speed / 3.4);
      soldier.legs[0].rotation.x = Math.sin(state.time * 11 + actor.id) * stride * 0.55;
      soldier.legs[1].rotation.x = -soldier.legs[0].rotation.x;
      soldier.rifle.rotation.x = -actor.aimPitch * 0.8;
      soldier.flash.visible = actor.flash > 0;
    }
  }

  function updateEffects() {
    // Tracers: one oriented box per live shot, written into a fixed instance buffer. Only the
    // first few metres out of the muzzle are drawn — a full flight path reads as a wire
    // stretched across the map, while a short streak reads as a round in the air.
    let live = 0;
    for (let i = 0; i < state.tracers.length && live < TRACER_CAPACITY; i++) {
      const tracer = state.tracers[i];
      if (!tracer.live || tracer.until < state.time) continue;
      // A round leaving your own muzzle is a flash, not a line: skip any tracer that starts
      // inside arm's reach of the camera so the player never sees a beam through their face.
      if (camera.position.distanceToSquared(vector.set(tracer.ax, tracer.ay, tracer.az)) < TRACER_NEAR_SQ) continue;
      direction.set(tracer.bx - tracer.ax, tracer.by - tracer.ay, tracer.bz - tracer.az);
      const flight = direction.length() || 0.01;
      direction.divideScalar(flight);
      const drawn = Math.min(flight, TRACER_LENGTH);
      const ax = tracer.ax;
      const ay = tracer.ay;
      const az = tracer.az;
      vector.set(ax + direction.x * drawn * 0.5, ay + direction.y * drawn * 0.5, az + direction.z * drawn * 0.5);
      quaternion.setFromUnitVectors(forward, direction);
      sc.set(TRACER_WIDTH, TRACER_WIDTH, drawn);
      matrix.compose(vector, quaternion, sc);
      tracerMesh.setMatrixAt(live++, matrix);
    }
    tracerMesh.count = live;
    tracerMesh.instanceMatrix.needsUpdate = true;

    // Grenades in flight.
    const grenadeCount = Math.min(8, state.grenades.length);
    grenadeMesh.count = grenadeCount;
    for (let i = 0; i < grenadeCount; i++) {
      const grenade = state.grenades[i];
      matrix.makeTranslation(grenade.x, grenade.y, grenade.z);
      grenadeMesh.setMatrixAt(i, matrix);
    }
    grenadeMesh.instanceMatrix.needsUpdate = true;

    // Smoke: each cloud is a ring of puffs that swells then thins as it expires.
    let puff = 0;
    for (const cloud of state.smokes) {
      const age = state.time - cloud.born;
      const life = Math.max(0, Math.min(1, (cloud.until - state.time) / GRENADE.SMOKE_SECONDS));
      const radius = GRENADE.SMOKE_RADIUS * Math.min(1, 0.45 + age * 0.6);
      for (let p = 0; p < SMOKE_PUFFS && puff < SMOKE_CAPACITY * SMOKE_PUFFS; p++) {
        const angle = (p / SMOKE_PUFFS) * Math.PI * 2 + cloud.born;
        const ring = p === 0 ? 0 : radius * 0.55;
        vector.set(
          cloud.x + Math.cos(angle) * ring,
          cloud.y + 0.5 + (p % 2) * 0.9 + Math.sin(age + p) * 0.15,
          cloud.z + Math.sin(angle) * ring,
        );
        sc.setScalar(radius * (p === 0 ? 0.9 : 0.55) * (0.7 + life * 0.3));
        matrix.compose(vector, quaternion, sc);
        smokeMesh.setMatrixAt(puff++, matrix);
      }
    }
    smokeMesh.count = puff;
    smokeMesh.instanceMatrix.needsUpdate = true;

    // Charge, lamp and blast.
    const armed = state.charge.planted || state.charge.carrier < 0;
    charge.visible = armed || state.charge.plant > 0;
    if (charge.visible) {
      charge.position.set(state.charge.x, 0, state.charge.z);
      const pulse = 0.5 + 0.5 * Math.sin(state.time * (state.charge.planted ? 10 : 4));
      chargeLamp.scale.setScalar(0.7 + pulse * 0.7);
      chargeRing.scale.setScalar(1 + Math.sin(state.time * 5) * 0.06);
    }
    if (state.blasts.length) {
      const latest = state.blasts[state.blasts.length - 1];
      const age = state.time - latest.born;
      blast.visible = age < 0.4;
      blast.position.set(latest.x, latest.y, latest.z);
      blast.scale.setScalar(0.5 + age * 22);
    } else {
      blast.visible = false;
    }
    siteMarks.visible = state.overview;
  }

  // The render call: interpolate actors, place the weapon, then let three.js draw.
  return function render(alpha, dt) {
    updateWeapon(dt);
    updateSoldiers(alpha);
    updateEffects();
    if (!state.overview) {
      camera.fov += (targetFovFor(state.player) - camera.fov) * Math.min(1, dt * 10);
      camera.updateProjectionMatrix();
    }
  };
}

// Field of view depends on whether the player is aiming: a narrow view is a zoom, and a
// zoom is a reason to hold an angle rather than run it.
function targetFovFor(actor) {
  const aiming = state.aiming && actor.alive;
  return aiming ? COMBAT.ADS_FOV : COMBAT.HIP_FOV;
}
