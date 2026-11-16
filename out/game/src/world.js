// world.js — Pump House Seven: geometry, collision, callouts and the bot route graph.
//
// The map is authored as data: solid boxes go into a collider list and a per-colour batch
// that becomes one InstancedMesh each, so the whole level costs a handful of draw calls.
// Three lanes run north to two pump sites, joined by a south and a north connector, which
// is what makes rotations and retakes possible instead of a single corridor.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Map dimensions in metres. The playable floor is 64 × 68, walls at the edge.
const HALF_WIDTH = 32;
const HALF_DEPTH = 34;
const WALL_HEIGHT = 7;

// --- Collision primitives ---------------------------------------------------------
// Slab test against one AABB. Returns the fraction of the segment that is inside, or
// Infinity when it misses. One function serves line of sight, bullets and smoke tests.
export function segmentBox(ax, ay, az, bx, by, bz, box, pad = 0) {
  let lo = 0;
  let hi = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  let t1;
  let t2;
  if (Math.abs(dx) < 1e-8) {
    if (ax < box.minX - pad || ax > box.maxX + pad) return Infinity;
  } else {
    t1 = (box.minX - pad - ax) / dx;
    t2 = (box.maxX + pad - ax) / dx;
    lo = Math.max(lo, Math.min(t1, t2));
    hi = Math.min(hi, Math.max(t1, t2));
  }
  if (Math.abs(dy) < 1e-8) {
    if (ay < box.minY - pad || ay > box.maxY + pad) return Infinity;
  } else {
    t1 = (box.minY - pad - ay) / dy;
    t2 = (box.maxY + pad - ay) / dy;
    lo = Math.max(lo, Math.min(t1, t2));
    hi = Math.min(hi, Math.max(t1, t2));
  }
  if (Math.abs(dz) < 1e-8) {
    if (az < box.minZ - pad || az > box.maxZ + pad) return Infinity;
  } else {
    t1 = (box.minZ - pad - az) / dz;
    t2 = (box.maxZ + pad - az) / dz;
    lo = Math.max(lo, Math.min(t1, t2));
    hi = Math.min(hi, Math.max(t1, t2));
  }
  return hi >= lo ? lo : Infinity;
}

export function blocked(ax, ay, az, bx, by, bz, colliders, pad = 0) {
  for (let i = 0; i < colliders.length; i++) {
    if (segmentBox(ax, ay, az, bx, by, bz, colliders[i], pad) < 1) return true;
  }
  return false;
}

// --- Route graph ------------------------------------------------------------------
// Lanes are polylines; a shared coordinate is a shared node, so listing a corner twice in
// two lanes is how the graph is stitched. No search runs at load beyond that merge.
const LANES = {
  westLane: [[-24, 30], [-24, 16], [-26, 6], [-26, -6], [-24, -16], [-21, -24]],
  midLane: [[0, 30], [0, 16], [0, 6], [0, -8], [0, -15], [0, -20]],
  eastLane: [[24, 30], [24, 16], [26, 6], [26, -6], [24, -16], [21, -24]],
  southLink: [[-24, 16], [0, 16], [24, 16]],
  northLink: [[-24, -16], [0, -15], [24, -16]],
  northArc: [[-21, -24], [-12, -21], [0, -20], [12, -21], [21, -24]],
  defendWest: [[-21, -24], [-21, -30]],
  defendEast: [[21, -24], [21, -30]],
  defendLine: [[-21, -30], [0, -32], [21, -30]],
};

function buildGraph() {
  const nodes = [];
  const byKey = new Map();
  const nodeAt = (x, z) => {
    const key = `${x},${z}`;
    let index = byKey.get(key);
    if (index === undefined) {
      index = nodes.length;
      nodes.push({ x, z, links: [] });
      byKey.set(key, index);
    }
    return index;
  };
  const link = (a, b) => {
    if (a === b) return;
    if (!nodes[a].links.includes(b)) nodes[a].links.push(b);
    if (!nodes[b].links.includes(a)) nodes[b].links.push(a);
  };
  for (const lane of Object.values(LANES)) {
    for (let i = 0; i < lane.length - 1; i++) {
      link(nodeAt(lane[i][0], lane[i][1]), nodeAt(lane[i + 1][0], lane[i + 1][1]));
    }
  }
  return nodes;
}

export function nearestNode(nodes, x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d = (nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// Breadth-first over the lane graph. Paths are short (six to fourteen nodes) and are
// rebuilt only when a bot picks a new goal, never per frame.
export function route(nodes, start, goal) {
  if (start === goal) return [start];
  const prev = new Int16Array(nodes.length).fill(-1);
  const queue = [start];
  prev[start] = start;
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    if (node === goal) break;
    for (const next of nodes[node].links) {
      if (prev[next] === -1) { prev[next] = node; queue.push(next); }
    }
  }
  if (prev[goal] === -1) return [start];
  const out = [goal];
  while (out[out.length - 1] !== start) out.push(prev[out[out.length - 1]]);
  return out.reverse();
}

// --- Callouts ---------------------------------------------------------------------
// The HUD names the zone you stand in; bots use the same table to describe where they are
// heading, so a reader can match a bot's intent line to a place on the map.
const CALLOUTS = [
  { name: 'SOUTH YARD', test: (x, z) => z > 20 },
  { name: 'WEST TANKS', test: (x, z) => z < -18 && x < -8 },
  { name: 'EAST GALLERY', test: (x, z) => z < -18 && x > 8 },
  { name: 'PUMP CROSSING', test: (x, z) => z < -18 },
  { name: 'VALVE HALL', test: (x, z) => Math.abs(x) < 7 && z > -9 && z < 9 },
  { name: 'WEST LANE', test: (x) => x < -18 },
  { name: 'EAST LANE', test: (x) => x > 18 },
  { name: 'CONNECTOR', test: () => true },
];

export function zoneAt(x, z) {
  for (const callout of CALLOUTS) if (callout.test(x, z)) return callout.name;
  return 'PUMP HOUSE';
}

// --- Geometry ---------------------------------------------------------------------
function makeSignMesh(text, color, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const paint = canvas.getContext('2d');
  paint.fillStyle = '#1b2629';
  paint.fillRect(0, 0, 512, 256);
  paint.strokeStyle = color;
  paint.lineWidth = 6;
  paint.strokeRect(14, 14, 484, 228);
  paint.fillStyle = color;
  paint.font = 'bold 118px system-ui, sans-serif';
  paint.textAlign = 'center';
  paint.textBaseline = 'middle';
  paint.fillText(text, 256, 138);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, transparent: false }),
  );
  return mesh;
}

export function buildWorld(scene) {
  const colliders = [];
  const boxesByColour = new Map();
  const cylinders = [];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();

  function pushBox(batch, x, y, z, w, h, d) {
    if (!boxesByColour.has(batch)) boxesByColour.set(batch, []);
    boxesByColour.get(batch).push({ x, y, z, w, h, d });
  }

  // A solid block: centred on (x, z), standing on the floor, colliding from y = 0 to h.
  function block(x, z, w, d, h, colour, options = {}) {
    const y = options.y ?? 0;
    pushBox(colour, x, y + h / 2, z, w, h, d);
    if (options.solid !== false) {
      colliders.push({
        minX: x - w / 2, maxX: x + w / 2,
        minY: y, maxY: y + h,
        minZ: z - d / 2, maxZ: z + d / 2,
      });
    }
    return { x, z, w, d, h };
  }

  // Decoration: drawn, never collided, so trim and signage cost nothing at runtime.
  function trim(x, y, z, w, h, d, colour) {
    pushBox(colour, x, y, z, w, h, d);
  }

  function tank(x, z, radius, height, colour) {
    cylinders.push({ x, y: height / 2, z, radius, height, colour });
    colliders.push({
      minX: x - radius * 0.86, maxX: x + radius * 0.86,
      minY: 0, maxY: height,
      minZ: z - radius * 0.86, maxZ: z + radius * 0.86,
    });
  }

  // --- Floor, walls and light masts ---------------------------------------------
  // The pan runs to the horizon so the map sits in a place rather than on a table; the
  // concrete pad inside the walls is what the fight happens on.
  const pan = new THREE.Mesh(
    new THREE.PlaneGeometry(520, 520),
    new THREE.MeshLambertMaterial({ color: PALETTE.salt }),
  );
  pan.rotation.x = -Math.PI / 2;
  pan.position.y = -0.03;
  scene.add(pan);

  // The pan is 520 m across, so it needs scale references: a berm line and far silos and
  // sheds. None of it is collided or walked on; it keeps the overview out of a void.
  const FAR = [
    [-62, 44, 30, 3, 1.6, 'saltFar'],
    [62, 44, 30, 3, 1.6, 'saltFar'],
    [-62, -44, 30, 3, 1.6, 'saltFar'],
    [62, -44, 30, 3, 1.6, 'saltFar'],
    [-86, 8, 3, 40, 1.4, 'saltFar'],
    [86, 8, 3, 40, 1.4, 'saltFar'],
    [-74, -14, 9, 9, 12.5, 'concrete'],
    [-88, 26, 7, 7, 9, 'concrete'],
    [78, -30, 11, 8, 14, 'concrete'],
    [96, 18, 6, 6, 7.5, 'concrete'],
    [-104, -46, 14, 10, 6, 'steelLight'],
    [110, -52, 16, 12, 5, 'steelLight'],
  ];
  for (const [x, z, w, d, h, colour] of FAR) trim(x, h / 2, z, w, h, d, colour);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF_WIDTH * 2, HALF_DEPTH * 2),
    new THREE.MeshLambertMaterial({ color: PALETTE.ground }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // Expansion joints: the pad is poured in bays, and the grid gives the floor a scale.
  for (let x = -24; x <= 24; x += 8) trim(x, 0.006, 0, 0.1, 0.012, HALF_DEPTH * 2, 'concreteDark');
  for (let z = -28; z <= 28; z += 8) trim(0, 0.006, z, HALF_WIDTH * 2, 0.012, 0.1, 'concreteDark');

  block(0, HALF_DEPTH, HALF_WIDTH * 2, 1, WALL_HEIGHT, 'concreteDark');
  block(0, -HALF_DEPTH, HALF_WIDTH * 2, 1, WALL_HEIGHT, 'concreteDark');
  block(-HALF_WIDTH, 0, 1, HALF_DEPTH * 2, WALL_HEIGHT, 'concreteDark');
  block(HALF_WIDTH, 0, 1, HALF_DEPTH * 2, WALL_HEIGHT, 'concreteDark');
  for (const side of [-1, 1]) {
    for (let z = -30; z <= 30; z += 10) {
      trim(side * (HALF_WIDTH - 0.4), 3.4, z, 0.5, 6.8, 0.5, 'steel');
    }
    for (let x = -28; x <= 28; x += 10) {
      trim(x, 3.4, side * (HALF_DEPTH - 0.4), 0.5, 6.8, 0.5, 'steel');
    }
  }
  // Steel capping along every wall reads as a roofline from inside the map.
  for (const side of [-1, 1]) {
    trim(0, WALL_HEIGHT - 0.2, side * (HALF_DEPTH - 0.5), HALF_WIDTH * 2, 0.4, 1.2, 'steel');
    trim(side * (HALF_WIDTH - 0.5), WALL_HEIGHT - 0.2, 0, 1.2, 0.4, HALF_DEPTH * 2, 'steel');
  }

  // --- Central valve hall: two plant buildings that split the map in three ---------
  for (const side of [-1, 1]) {
    const cx = side * 11;
    block(cx, 0, 10, 16, 6.5, 'concrete');
    trim(cx, 6.65, 0, 10.6, 0.3, 16.6, 'steel'); // roof lip
    trim(cx, 7.4, 0, 6, 1.4, 6, 'steelLight'); // roof plant
    trim(cx, 8.2, 0, 4.4, 0.4, 4.4, 'steel');
    for (const z of [-5, 0, 5]) {
      // Recessed window band on the lane-facing wall, with a rusted frame.
      const faceX = cx + side * 5.02;
      trim(faceX, 3.6, z, 0.12, 1.9, 3.2, 'steel');
      trim(faceX + side * 0.06, 3.6, z, 0.08, 1.5, 2.8, 'rust');
    }
    // Pipe run along the mid-facing wall: the clearest read that this is a pump house.
    const innerX = cx - side * 5.1;
    trim(innerX, 5.2, 0, 0.34, 0.34, 15, 'rust');
    trim(innerX, 4.3, 0, 0.26, 0.26, 15, 'steelLight');
    for (const z of [-6, 0, 6]) trim(innerX, 4.8, z, 0.5, 1.6, 0.4, 'steel');
  }
  // A gantry connects the two roofs, framing the mid lane from below. Its legs stand at the
  // building faces, never in the lane: the centre of the map stays a clear sight line.
  trim(0, 8.4, 0, 12, 0.5, 1.4, 'steel');
  trim(0, 7.9, 0, 12, 0.2, 0.9, 'rust');
  for (const x of [-5.7, 5.7]) trim(x, 4.2, 0, 0.24, 8, 0.24, 'steel');
  trim(0, 8.75, 0, 11, 0.14, 0.3, 'steelLight'); // handrail on the walkway

  // --- Pump sites ------------------------------------------------------------------
  // Site A: two brine tanks on a painted pad, west of the crossing.
  block(-21, -24, 12, 10, 0.02, 'concreteDark', { solid: false, y: 0 });
  tank(-27.5, -27.5, 3.4, 6.4, 'concrete');
  tank(-16.5, -26.6, 2.4, 5.6, 'concrete');
  for (const [tx, tz, r, h] of [[-27.5, -27.5, 3.4, 6.4], [-16.5, -26.6, 2.4, 5.6]]) {
    trim(tx, h + 0.06, tz, r * 2.06, 0.12, r * 2.06, 'rust'); // lid plate
    trim(tx, 3.2, tz, r * 2.06, 0.18, r * 2.06, 'steel'); // band
    trim(tx, h + 0.9, tz, 0.18, 1.6, 0.18, 'steel'); // vent stack
  }
  // Site B: an open gallery under a steel canopy, east of the crossing.
  block(21, -24, 12, 10, 0.02, 'concreteDark', { solid: false, y: 0 });
  for (const [px, pz] of [[16.5, -28.5], [25.5, -28.5], [16.5, -19.5], [25.5, -19.5]]) {
    block(px, pz, 0.5, 0.5, 4.4, 'steel');
  }
  trim(21, 4.6, -24, 10.5, 0.5, 10.5, 'steel');
  trim(21, 5.0, -24, 9.4, 0.2, 9.4, 'rust');

  // --- North control room between the sites ----------------------------------------
  block(0, -26, 12, 6, 5.5, 'concrete');
  trim(0, 5.75, -26, 12.6, 0.3, 6.6, 'steel');
  trim(0, 6.9, -26, 0.3, 2.4, 0.3, 'steel'); // antenna mast
  trim(0, 8.2, -26, 2.4, 0.12, 0.12, 'rust');
  trim(-3.2, 2.4, -22.95, 2.6, 2.2, 0.14, 'steel'); // door frame facing the crossing
  trim(0, 3.1, -22.9, 0.12, 1.1, 0.1, 'charge');

  // --- Cover: crates that break sightlines without sealing a lane -------------------
  const CRATES = [
    [-21.5, 20, 2.6, 2.2, 1.35],
    [-28, 10, 2.4, 3, 1.5],
    [-21.5, -11, 2.2, 2.6, 1.4],
    [-17.5, -25.5, 2.6, 2.1, 1.2],
    [-25, -21, 2.4, 2, 1.15],
    [21.5, 20, 2.6, 2.2, 1.35],
    [27.5, 10, 2.4, 3, 1.5],
    [21.5, -11, 2.2, 2.6, 1.4],
    [17.5, -25.5, 2.6, 2.1, 1.2],
    [25, -21, 2.4, 2, 1.15],
    [-4, 11, 2.6, 2.2, 1.3],
    [4.2, -3.5, 2.2, 2.4, 1.2],
    [3.6, -12, 2.2, 2.2, 1.15],
    [-3.4, -17, 2.2, 2.2, 1.15],
    [-14, 24, 3, 1.6, 0.9],
    [14, 24, 3, 1.6, 0.9],
  ];
  for (const [x, z, w, d, h] of CRATES) {
    block(x, z, w, d, h, 'steelLight');
    trim(x, h + 0.06, z, w + 0.1, 0.12, d + 0.1, 'steel');
    trim(x, h * 0.55, z + d / 2 + 0.02, w * 0.62, 0.14, 0.06, 'rust');
  }

  // --- Floor paint: lane dashes, site pads and the spawn line -----------------------
  // Dashes mark all three lanes and two solid lines fence the crossing, so the layout the
  // HUD calls "three lanes, one crossing" is drawn on the floor too.
  for (let z = -30; z <= 30; z += 4) {
    trim(0, 0.012, z, 0.16, 0.02, 1.6, 'bone');
    for (const side of [-1, 1]) trim(side * 24, 0.012, z, 0.16, 0.02, 1.6, 'bone');
  }
  for (const z of [-17.1, -14.9]) trim(0, 0.012, z, HALF_WIDTH * 2 - 4, 0.02, 0.16, 'bone');
  for (const side of [-1, 1]) {
    trim(side * 21, 0.012, 28, 8, 0.02, 0.2, 'charge');
    trim(side * 21, 0.012, 26.8, 8, 0.02, 0.2, 'charge');
  }
  trim(-21, 0.014, -24, 3.6, 0.02, 0.24, 'charge');
  trim(21, 0.014, -24, 3.6, 0.02, 0.24, 'charge');

  // Site letters painted on the pads: a glyph on a flat canvas texture, not floor stripes,
  // because a letterform built from stripes reads as a ladder from the air.
  function siteLetter(letter, x, z) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f0a63c';
    ctx.font = 'bold 220px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, 128, 138);
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 6),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(x, 0.07, z);
    scene.add(plate);
  }
  siteLetter('A', -21, -20.4);
  siteLetter('B', 21, -20.4);

  // --- Catwalk, masts, containers: the industrial read at a glance ------------------
  // A walkway crosses the south connector at roof height: decoration, but it frames the
  // mid lane and gives the overview a spine.
  for (const x of [-30, -18, -6, 6, 18, 30]) trim(x, 2.1, 16, 0.3, 4.2, 0.3, 'steel');
  trim(0, 4.3, 16, 62, 0.18, 2.6, 'steelLight');
  for (const side of [-1, 1]) {
    trim(0, 4.55, 16 + side * 1.2, 62, 0.1, 0.12, 'rust');
    for (let x = -30; x <= 30; x += 2) trim(x, 4.9, 16 + side * 1.2, 0.09, 0.9, 0.09, 'steel');
  }
  trim(0, 4.75, 16, 62, 0.06, 0.5, 'concreteDark');

  // Floodlight masts in the four corners, angled heads over the lanes.
  for (const [mx, mz, ry] of [[-30, 30, 0.7], [30, 30, -0.7], [-30, -30, 2.4], [30, -30, -2.4]]) {
    trim(mx, 5.4, mz, 0.4, 10.8, 0.4, 'steel');
    trim(mx, 10.9, mz, 2.6, 0.24, 0.5, 'steelLight');
    for (const dx of [-0.9, 0, 0.9]) trim(mx + Math.cos(ry) * dx, 10.66, mz + Math.sin(ry) * dx, 0.5, 0.34, 0.5, 'chargeHot');
  }

  // Sea containers against the side walls: mass, colour and a reason to look up. They sit
  // clear of every lane node, so the route audit stays clean.
  for (const [cx, cz, w, d, colour] of [
    [-29.8, 24, 3.2, 6.4, 'rust'],
    [29.8, 24, 3.2, 6.4, 'allyDark'],
    [-29.8, 8, 3.2, 5.2, 'allyDark'],
    [29.8, 8, 3.2, 5.2, 'rust'],
  ]) {
    block(cx, cz, w, d, 2.6, colour);
    trim(cx, 2.66, cz, w + 0.12, 0.12, d + 0.12, 'steel');
    for (let i = -2; i <= 2; i++) trim(cx + w / 2 + 0.02, 1.3, cz + i * 1.1, 0.06, 2.5, 0.12, 'steel');
  }

  // Pipe runs and valve wheels along the plant walls: the pump house is a machine.
  for (const side of [-1, 1]) {
    trim(side * 17.5, 3.1, 12, 0.5, 0.5, 18, 'rust');
    trim(side * 17.5, 2.4, -4, 0.34, 0.34, 14, 'steelLight');
    for (const z of [-4, 2, 8]) {
      trim(side * 17.5, 3.1, z, 0.8, 0.8, 0.2, 'steel');
      trim(side * 17.5, 3.1, z, 0.9, 0.12, 0.12, 'steelLight');
    }
  }
  // A pair of brine silos outside the north wall, lit so they read against the sky.
  for (const [sx, sz, r, h] of [[-38, -46, 5, 15], [-24, -50, 4, 12], [40, -44, 4.5, 13]]) {
    cylinders.push({ x: sx, y: h / 2, z: sz, radius: r, height: h, colour: 'concreteDark' });
    trim(sx, h + 0.4, sz, r * 2.1, 0.8, 0.8, 'rust');
  }

  // --- Signs and distant silhouettes ----------------------------------------------
  const signA = makeSignMesh('A', '#f0a63c', 5.2, 2.6);
  signA.position.set(-21, 3.4, -29.6);
  scene.add(signA);
  const signB = makeSignMesh('B', '#4fb3bd', 5.2, 2.6);
  signB.position.set(21, 3.4, -29.6);
  scene.add(signB);
  const signHall = makeSignMesh('PUMP HOUSE 7', '#efe6d0', 9, 2.2);
  signHall.position.set(0, 5.2, -33.4);
  scene.add(signHall);
  // Beyond the north wall: salt silos, unlit and unsolid, for depth down every lane.
  for (let i = 0; i < 9; i++) {
    const x = -30 + i * 7.5;
    const height = 9 + ((i * 5) % 7);
    trim(x, height / 2, -40 - (i % 3) * 6, 5, height, 5, i % 2 ? 'steelLight' : 'concreteDark');
    trim(x, height + 0.6, -40 - (i % 3) * 6, 0.3, 1.2, 0.3, 'steel');
  }
  for (let i = 0; i < 6; i++) {
    trim(-40 - i * 7, 6, -12 + i * 6, 6, 12, 6, 'concreteDark');
    trim(40 + i * 7, 5, 14 - i * 6, 6, 10, 6, 'concreteDark');
  }

  // --- Batches ---------------------------------------------------------------------
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  for (const [colour, list] of boxesByColour) {
    const mesh = new THREE.InstancedMesh(
      unitBox,
      new THREE.MeshLambertMaterial({ color: PALETTE[colour] ?? PALETTE.concrete }),
      list.length,
    );
    list.forEach((b, i) => {
      position.set(b.x, b.y, b.z);
      scale.set(b.w, b.h, b.d);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }
  const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 18);
  for (const tank of cylinders) {
    const mesh = new THREE.Mesh(
      unitCylinder,
      new THREE.MeshLambertMaterial({ color: PALETTE[tank.colour] ?? PALETTE.concrete }),
    );
    mesh.position.set(tank.x, tank.y, tank.z);
    mesh.scale.set(tank.radius, tank.height, tank.radius);
    scene.add(mesh);
  }

  const nodes = buildGraph();
  const sites = [
    { name: 'A', label: 'WEST TANKS', x: -21, z: -24, radius: 4.6 },
    { name: 'B', label: 'EAST GALLERY', x: 21, z: -24, radius: 4.6 },
  ];
  return {
    colliders,
    nodes,
    sites,
    lanes: LANES,
    spawns: {
      attack: [{ x: 0, z: 30 }, { x: -4, z: 30 }, { x: 4, z: 30 }],
      defend: [{ x: -21, z: -30 }, { x: 21, z: -30 }, { x: 0, z: -32 }],
    },
    // Defenders pick a post per site: one holds the crossing, one holds the site itself.
    posts: {
      crossing: { x: 0, z: -19 },
      A: { x: -21, z: -21 },
      B: { x: 21, z: -21 },
    },
    bounds: { halfWidth: HALF_WIDTH, halfDepth: HALF_DEPTH },
    // Footprint for the radar: the two plant buildings, the control room and the tanks.
    // The HUD draws the plan, so the minimap and the world cannot drift apart.
    plan: {
      blocks: [
        { x: -11, z: 0, w: 10, d: 16 },
        { x: 11, z: 0, w: 10, d: 16 },
        { x: 0, z: -26, w: 12, d: 6 },
      ],
      tanks: [
        { x: -27.5, z: -27.5, r: 3.4 },
        { x: -15.5, z: -28.5, r: 3.1 },
      ],
      lanes: [
        { x: -24, z: 30, x2: -24, z2: -16 },
        { x: 0, z: 30, x2: 0, z2: -15 },
        { x: 24, z: 30, x2: 24, z2: -16 },
        { x: -24, z: 16, x2: 24, z2: 16 },
        { x: -24, z: -16, x2: 24, z2: -16 },
      ],
    },
  };
}

// Dev-time audit: every graph edge must be walkable. main.js calls this and exposes the
// result, so a map edit that seals a lane fails loudly instead of stranding a bot.
export function auditRoutes(world) {
  const broken = [];
  for (let i = 0; i < world.nodes.length; i++) {
    for (const j of world.nodes[i].links) {
      if (j < i) continue;
      const a = world.nodes[i];
      const b = world.nodes[j];
      if (blocked(a.x, 1, a.z, b.x, 1, b.z, world.colliders, 0.4)) {
        broken.push(`${i}->${j} (${a.x},${a.z})->(${b.x},${b.z})`);
      }
    }
  }
  return { nodes: world.nodes.length, edges: world.nodes.reduce((n, node) => n + node.links.length, 0) / 2, broken };
}
