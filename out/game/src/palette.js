// palette.js — the whole look in one table.
//
// Every mesh, HUD accent and fog value in the game comes from here, so the art is a
// decision made once instead of a colour guessed at each call site. The palette is a
// bleached salt pan at late afternoon: warm bone concrete, cold oxidised steel, one
// amber accent for the charge and the objective, one cyan for your own side.
export const PALETTE = Object.freeze({
  // Sky and atmosphere
  sky: 0xb9c6c4,
  fog: 0xa9b8b6,
  fogNear: 26,
  fogFar: 108,

  // Structure
  ground: 0xc4bda6,
  salt: 0xd2c9ae,
  saltFar: 0xb9ae94,
  concrete: 0xd8cfb6,
  concreteDark: 0xb3a992,
  steel: 0x3d4a4d,
  steelLight: 0x6d7d80,
  rust: 0x9a5f42,
  bone: 0xefe6d0,

  // Team and signal
  ally: 0x4fb3bd,
  allyDark: 0x2c7079,
  enemy: 0xd0743c,
  enemyDark: 0x8d4726,
  charge: 0xf0a63c,
  chargeHot: 0xffd9a0,
  veil: 0xdfe7e6,

  // Effects
  tracer: 0xff9a2e,
  blood: 0x7a2f22,
  shadow: 0x2b3336,
});

// Material lookup used by the renderer; the keys are the only colours a mesh may name.
export const MATERIALS = Object.freeze([
  'ground', 'concrete', 'concreteDark', 'steel', 'steelLight', 'rust', 'bone',
  'ally', 'allyDark', 'enemy', 'enemyDark', 'charge', 'shadow',
]);
