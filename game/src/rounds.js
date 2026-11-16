// rounds.js — the round machine: preparation, breach, armed charge, retake, debrief.
//
// This module owns the only thing that decides a round, and it does so with explicit
// named transitions rather than timers scattered around the game:
//
//   PREP   free buy window. Nothing moves, nothing shoots.
//   BREACH attackers push A or B; defenders hold. Win by wipe, by arming, or by time.
//   ARMED  the charge is live: attackers defend it, Tidewatch retakes and defuses.
//   OVER   the debrief board, economy paid, then the next round starts itself.
//   MATCH  someone reached seven rounds; the final board, then a fresh match.
//
// Money is paid here too, so the economy has one author: win, loss streak, plant, defuse.
import { ECONOMY, PHASE, ROUND } from './config.js';
import { aliveCount, distance2, pushFeed, resetActor, state } from './state.js';
import { botPlantProgress, defenderOnCharge } from './bots.js';
import { equip } from './weapons.js';

const ATTACKERS = 0;
const DEFENDERS = 1;

// Which gun a side carries into a round. Bots buy on a simple curve so the first rounds
// are pistol and SMG fights and later rounds are rifle duels, like a real economy.
function armBot(bot, round) {
  if (round >= 3) equip(bot, 'rifle');
  else if (round >= 2) equip(bot, 'smg');
  else equip(bot, 'pistol');
  bot.armor = round >= 3 ? 100 : 0;
  bot.frags = bot.team === ATTACKERS ? 1 : 0;
  bot.veils = bot.team === DEFENDERS ? 1 : 0;
}

function resetCharge() {
  const charge = state.charge;
  charge.planted = false;
  charge.x = 0;
  charge.z = 0;
  charge.fuse = 0;
  charge.site = '';
  charge.defuse = 0;
  charge.plant = 0;
  charge.carrier = state.player.id; // the human always carries the first charge
}

export function startRound(world) {
  state.round++;
  state.phase = PHASE.PREP;
  state.timer = ROUND.PREP_SECONDS;
  state.buyOpen = false;
  state.roundWinner = -1;
  state.roundReason = '';
  state.roundPayout = 0;
  state.hitFlash = 0;
  state.damageFlash = 0;
  state.grenades.length = 0;
  state.smokes.length = 0;
  state.blasts.length = 0;
  state.feed.length = 0;
  for (const noise of state.noises) noise.live = false;
  resetCharge();

  const attackSpawns = world.spawns.attack;
  const defendSpawns = world.spawns.defend;
  let attackIndex = 0;
  let defendIndex = 0;
  for (const actor of state.actors) {
    const spawn = actor.team === ATTACKERS ? attackSpawns[attackIndex++ % 3] : defendSpawns[defendIndex++ % 3];
    resetActor(actor, spawn.x, spawn.z);
    if (actor.team === ATTACKERS) {
      equip(actor, state.round === 1 ? 'pistol' : actor.weapon);
      if (actor === state.player) {
        // The player's buy is theirs; bots are issued their gun by the round.
        actor.frags = state.round === 1 ? 2 : actor.frags;
        actor.veils = state.round === 1 ? 1 : actor.veils;
      }
    } else {
      armBot(actor, state.round);
    }
  }
  // The player keeps their purchased loadout across rounds; only a fresh match resets it.
  state.objective = {
    kicker: 'MISSION / BREACH',
    text: 'Escort the charge to a pump site',
    sub: 'Press B in preparation to buy · A west tanks · B east gallery',
  };
  pushFeed(`ROUND ${state.round} · PREPARATION`, ATTACKERS);
}

function finishRound(team, reason) {
  if (state.phase === PHASE.OVER || state.phase === PHASE.MATCH) return;
  state.phase = PHASE.OVER;
  state.timer = ROUND.OVER_SECONDS;
  state.roundWinner = team;
  state.roundReason = reason;
  state.score[team]++;
  state.buyOpen = false;

  // Payout: the winners take the round bonus, the losers take a streak-scaled consolation
  // so a bad start is recoverable rather than a lost match.
  const winnerGain = ECONOMY.WIN;
  const loserStreak = state.lossStreak[1 - team];
  const loserGain = ECONOMY.LOSS_BASE + Math.min(ECONOMY.LOSS_STEPS_MAX, loserStreak) * ECONOMY.LOSS_STEP;
  state.lossStreak[team] = 0;
  state.lossStreak[1 - team] = loserStreak + 1;
  if (team === ATTACKERS) {
    state.money = Math.min(ECONOMY.CAP, state.money + winnerGain);
    state.roundPayout = winnerGain;
  } else {
    state.money = Math.min(ECONOMY.CAP, state.money + loserGain);
    state.roundPayout = loserGain;
  }
  pushFeed(reason, team);

  if (state.score[team] >= ROUND.ROUNDS_TO_WIN || state.round >= ROUND.MAX_ROUNDS) {
    state.matchOver = true;
  }
}

export function resetMatch(world) {
  state.round = 0;
  state.score = [0, 0];
  state.lossStreak = [0, 0];
  state.matchOver = false;
  state.money = ECONOMY.START;
  state.kills = 0;
  state.deaths = 0;
  state.damageDealt = 0;
  for (const actor of state.actors) {
    actor.kills = 0;
    actor.deaths = 0;
    actor.damage = 0;
    equip(actor, 'pistol');
    actor.armor = 0;
  }
  startRound(world);
}

// Charge custody: when the carrier falls, the nearest living attacker picks it up. The
// charge is an object on the map, not a flag on a player, which is what lets a round be
// won by a teammate after the carrier dies.
function updateCarrier() {
  const charge = state.charge;
  if (charge.planted) return;
  if (charge.carrier >= 0 && state.actors[charge.carrier]?.alive) return;
  let best = null;
  let bestDistance = 3.6 * 3.6;
  for (const actor of state.actors) {
    if (!actor.alive || actor.team !== ATTACKERS) continue;
    const squared = distance2(actor, charge);
    if (squared < bestDistance) { bestDistance = squared; best = actor; }
  }
  if (best) {
    charge.carrier = best.id;
    pushFeed(`${best.name} HAS THE CHARGE`, ATTACKERS);
  }
}

// The player arms by holding E on a site; a bot arms by standing still on one. Both feed
// the same progress value, so the HUD bar is honest either way.
function updatePlanting(world, input, dt, audio) {
  const charge = state.charge;
  if (charge.planted) return;
  updateCarrier();
  const carrier = state.actors[charge.carrier];
  if (!carrier || !carrier.alive) {
    state.objective.text = 'Recover the charge';
    state.objective.sub = 'It is on the floor where the carrier fell';
    charge.plant = Math.max(0, charge.plant - dt);
    return;
  }
  if (carrier !== state.player) charge.x = carrier.x;
  if (carrier !== state.player) charge.z = carrier.z;

  const site = world.sites.find((s) => distance2(carrier, s) < s.radius * s.radius);
  if (!site) {
    charge.plant = Math.max(0, charge.plant - dt * 2);
    state.objective.text = carrier === state.player ? 'Take the charge to A or B' : 'Escort the carrier to a site';
    state.objective.sub = carrier === state.player ? 'Hold E on the pad to arm' : 'Slackwater is moving on a site';
    return;
  }

  const holding = carrier === state.player ? input.keys.has('KeyE') : botPlantProgress(carrier, world);
  const still = Math.hypot(carrier.vx, carrier.vz) < 1.2;
  if (holding && still) {
    charge.plant += dt;
    state.objective.text = `Arming the charge at ${site.name} · ${site.label}`;
    state.objective.sub = carrier === state.player ? 'Keep holding E · stay still' : 'Cover the carrier';
    if (charge.plant >= ROUND.PLANT_SECONDS) {
      charge.planted = true;
      charge.x = carrier.x;
      charge.z = carrier.z;
      charge.site = site.name;
      charge.fuse = ROUND.FUSE_SECONDS;
      charge.plant = ROUND.PLANT_SECONDS;
      state.phase = PHASE.ARMED;
      state.timer = ROUND.FUSE_SECONDS;
      state.money = Math.min(ECONOMY.CAP, state.money + ECONOMY.PLANT);
      pushFeed(`CHARGE ARMED AT ${site.name}`, ATTACKERS);
      audio.armed();
    }
  } else {
    charge.plant = Math.max(0, charge.plant - dt);
    state.objective.text = carrier === state.player ? `Hold E to arm at ${site.name}` : `Cover the carrier at ${site.name}`;
    state.objective.sub = carrier === state.player ? 'You are the carrier' : 'The carrier is arming';
  }
}

// Defenders retake: the nearest living Tidewatch bot on the charge starts a defuse, and
// the clock on the HUD becomes the fuse. This is the phase the whole map is shaped around.
function updateDefusal(world, dt, audio) {
  const charge = state.charge;
  charge.fuse = Math.max(0, charge.fuse - dt);
  let defuser = null;
  for (const bot of state.bots) {
    if (defenderOnCharge(bot, world)) { defuser = bot; break; }
  }
  if (defuser) {
    charge.defuse += dt;
    state.objective.text = `Tidewatch is disarming at ${charge.site}`;
    state.objective.sub = `${defuser.name} on the charge · contest it`;
    if (charge.defuse >= ROUND.DEFUSE_SECONDS) {
      pushFeed('CHARGE DEFUSED', DEFENDERS);
      finishRound(DEFENDERS, 'TIDEWATCH · CHARGE DEFUSED');
      audio.beep();
      return;
    }
  } else {
    charge.defuse = Math.max(0, charge.defuse - dt * 1.5);
    state.objective.text = `Defend the charge at ${charge.site}`;
    state.objective.sub = `${Math.ceil(charge.fuse)}s on the fuse · hold the site`;
  }
  if (charge.fuse <= 0) {
    audio.explode();
    pushFeed('CHARGE DETONATED', ATTACKERS);
    finishRound(ATTACKERS, 'SLACKWATER · CHARGE DETONATED');
  }
}

export function updateRounds(world, input, dt, audio) {
  state.timer = Math.max(0, state.timer - dt);

  if (state.phase === PHASE.PREP) {
    state.objective.kicker = 'MISSION / PREPARATION';
    state.objective.text = 'Buy, then take a lane';
    state.objective.sub = `${Math.ceil(state.timer)}s · B opens the armory`;
    if (state.timer <= 0) {
      state.phase = PHASE.BREACH;
      state.timer = ROUND.BREACH_SECONDS;
      state.buyOpen = false;
      state.objective.kicker = 'MISSION / BREACH';
      pushFeed('BREACH · SITES ARE LIVE', ATTACKERS);
      audio.horn();
    }
    return;
  }

  if (state.phase === PHASE.OVER) {
    if (state.timer <= 0) {
      if (state.matchOver) {
        state.phase = PHASE.MATCH;
        state.timer = ROUND.MATCH_SECONDS;
      } else {
        startRound(world);
      }
    }
    return;
  }

  if (state.phase === PHASE.MATCH) {
    if (state.timer <= 0) resetMatch(world);
    return;
  }

  if (state.phase === PHASE.BREACH) {
    state.objective.kicker = 'MISSION / BREACH';
    updatePlanting(world, input, dt, audio);
    const attackers = aliveCount(ATTACKERS);
    const defenders = aliveCount(DEFENDERS);
    if (attackers === 0) finishRound(DEFENDERS, 'TIDEWATCH · SLACKWATER ELIMINATED');
    else if (defenders === 0) finishRound(ATTACKERS, 'SLACKWATER · SITE OVERRUN');
    else if (state.timer <= 0) finishRound(DEFENDERS, 'TIDEWATCH · TIME EXPIRED');
    return;
  }

  if (state.phase === PHASE.ARMED) {
    state.objective.kicker = 'MISSION / DEFEND';
    state.timer = state.charge.fuse;
    updateDefusal(world, dt, audio);
    if (state.phase !== PHASE.ARMED) return;
    if (aliveCount(DEFENDERS) === 0) finishRound(ATTACKERS, 'SLACKWATER · SITE HELD');
  }
}

// The debrief numbers the board shows: who is on which side, what they did this match,
// and what the round paid. Kept beside the machine that pays it.
export function roundSummary() {
  return {
    round: state.round,
    winner: state.roundWinner,
    reason: state.roundReason,
    payout: state.roundPayout,
    score: state.score,
    matchOver: state.matchOver,
    defuse: state.charge.defuse,
    plant: state.charge.plant,
    fuse: state.charge.fuse,
    phase: state.phase,
  };
}
