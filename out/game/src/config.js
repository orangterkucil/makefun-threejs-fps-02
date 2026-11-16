// config.js — the numbers the simulation obeys, named once.
//
// Nothing in the game hard-codes a duration, a speed or a price: those live here so a
// reader can see the design as a table, and so the round structure (preparation, breach,
// armed/retake, debrief) is legible from a single file instead of scattered through the
// systems that consume it.

// --- Simulation -------------------------------------------------------------------
export const TICK_HZ = 60;
export const FIXED_DT = 1 / TICK_HZ;
export const MAX_FRAME_DT = 0.1; // a stalled tab never fast-forwards the round

// --- Round structure --------------------------------------------------------------
// A round is four phases in a fixed order. The names are used verbatim by the HUD, the
// round machine and the bot planner, so "where are we in the round" has one answer.
export const PHASE = Object.freeze({
  PREP: 'prep', // free buy window, no shooting, no movement outside spawn
  BREACH: 'breach', // attackers push a site, defenders hold; win by wipe or by arming
  ARMED: 'armed', // charge is live: attackers defend it, defenders retake and defuse
  OVER: 'over', // debrief board, then the next round starts itself
  MATCH: 'match', // match point reached, final board, then a new match
});

export const ROUND = Object.freeze({
  PREP_SECONDS: 16,
  BREACH_SECONDS: 105,
  FUSE_SECONDS: 35,
  OVER_SECONDS: 7,
  MATCH_SECONDS: 12,
  PLANT_SECONDS: 3.2,
  DEFUSE_SECONDS: 7,
  ROUNDS_TO_WIN: 7,
  MAX_ROUNDS: 13,
});

// --- Economy ----------------------------------------------------------------------
// Money is the tactical layer: losing teams still buy, so a bad round is recoverable and
// a good round is worth protecting. Values are round payouts in dollars.
export const ECONOMY = Object.freeze({
  START: 800,
  CAP: 12000,
  WIN: 3250,
  LOSS_BASE: 1400,
  LOSS_STEP: 500, // added per consecutive loss
  LOSS_STEPS_MAX: 3,
  PLANT: 300, // paid to the attacking side that arms the charge
  DEFUSE: 300,
  KILL_RIFLE: 300,
  KILL_SMG: 600,
  KILL_SHOTGUN: 900,
  KILL_PISTOL: 300,
  SURVIVE: 0,
});

// --- Movement ---------------------------------------------------------------------
export const MOVE = Object.freeze({
  WALK_SPEED: 5.2,
  ADS_SPEED: 2.7,
  CROUCH_SPEED: 2.05,
  QUIET_SPEED: 2.4, // shift-walk: slow, and makes no footstep noise
  ACCEL: 12,
  DECEL: 16,
  AIR_ACCEL: 1.6,
  FRICTION: 8,
  JUMP: 6.1,
  GRAVITY: 20,
  RADIUS: 0.34,
  STAND_HEIGHT: 1.8,
  CROUCH_HEIGHT: 1.15,
  EYE_STAND: 1.62,
  EYE_CROUCH: 1.06,
  STEP_LENGTH: 2.4, // metres walked between footstep sounds
  STEP_NOISE: 13, // metres a footstep is heard by enemies
  LAND_NOISE: 9,
  SENSITIVITY: 0.0021,
  PITCH_LIMIT: 1.36,
});

// --- Combat -----------------------------------------------------------------------
// Zones are the reason aim matters: the head is worth several torso hits, the legs are a
// partial hit, and everything decays with range so a lane is not a free kill.
export const COMBAT = Object.freeze({
  HEAD_MULT: 3.4,
  TORSO_MULT: 1,
  LEGS_MULT: 0.72,
  ARMOR_ABSORB: 0.5, // share of a hit the vest eats while it has points
  ARMOR_MAX: 100,
  HEALTH_MAX: 100,
  FALLOFF_START: 16, // metres before damage begins to drop
  FALLOFF_END: 48,
  FALLOFF_FLOOR: 0.5,
  MOVE_SPREAD: 0.032, // added at full sprint speed
  AIR_SPREAD: 0.05,
  CROUCH_SPREAD: 0.62, // multiplier while crouched
  ADS_SPREAD: 0.42, // multiplier while aiming down sights
  ADS_FOV: 48,
  HIP_FOV: 74,
  RECOIL_RECOVERY: 3.4, // units per second the view settles
  BURST_DECAY: 6, // shots of accumulated climb bleed off per second
  TRACER_LIFETIME: 0.07,
  MUZZLE_FLASH: 0.055,
});

// --- Grenades ---------------------------------------------------------------------
export const GRENADE = Object.freeze({
  FRAG_FUSE: 1.9,
  FRAG_DAMAGE: 118,
  FRAG_RADIUS: 8,
  FRAG_SPEED: 13,
  SMOKE_FUSE: 1.4,
  SMOKE_RADIUS: 4.6,
  SMOKE_SECONDS: 14,
  THROW_LIFT: 1.45,
  BOUNCE: 0.42,
});

// --- Bots -------------------------------------------------------------------------
// Reaction is deliberately human-scale: a bot that has just seen you needs a moment and
// its first shots are wide, which is what makes stopping to aim win exchanges.
export const BOT = Object.freeze({
  THINK_INTERVAL: 0.19,
  VIEW_DISTANCE: 54,
  VIEW_CONE: 1.15, // half-angle in radians
  PERIPHERAL: 15, // inside this range a bot notices you outside its cone
  REACTION_MIN: 0.24,
  REACTION_MAX: 0.46,
  AIM_TURN: 7.5, // radians per second of turn toward a target
  AIM_ERROR: 0.019,
  AIM_ERROR_MOVING: 0.036,
  MEMORY_SECONDS: 5,
  COVER_SECONDS: 1.4,
  PATROL_SPEED: 3.3,
  ENGAGE_SPEED: 2.4,
  WAYPOINT_RADIUS: 1.5,
});

// --- Match presentation -----------------------------------------------------------
export const UI = Object.freeze({
  RADAR_SCALE: 2.9, // pixels per metre on the radar
  FEED_LINES: 5,
  FEED_SECONDS: 5.5,
  TRACE_REFRESH: 0.2,
});
