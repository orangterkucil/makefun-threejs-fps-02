// hud.js — the readout: score, clock, objective, vitals, ammo, radar and the board.
//
// The HUD never computes gameplay; it formats what the simulation already decided. Text
// nodes are written only when their string changes (a text write is a layout cost), and the
// radar redraws at 12 Hz instead of every frame, which is invisible and much cheaper.
import { PHASE, ROUND, UI } from './config.js';
import { aliveCount, distance2, state } from './state.js';
import { WEAPONS } from './weapons.js';
import { zoneAt } from './world.js';

const PHASE_LABEL = {
  [PHASE.PREP]: 'PREPARATION',
  [PHASE.BREACH]: 'SECTOR LIVE',
  [PHASE.ARMED]: 'CHARGE ARMED',
  [PHASE.OVER]: 'ROUND COMPLETE',
  [PHASE.MATCH]: 'MATCH COMPLETE',
};

const TRACE_ROWS = 3;
const RADAR_HZ = 12;

export function createHud(world) {
  const byId = (id) => document.getElementById(id);
  const textCache = new Map();
  const radar = byId('radar');
  const radarPaint = radar.getContext('2d');
  const els = {
    scoreAlly: byId('score-ally'),
    scoreEnemy: byId('score-enemy'),
    roundLabel: byId('round-label'),
    timer: byId('timer'),
    phaseLabel: byId('phase-label'),
    zone: byId('zone'),
    kicker: byId('objective-kicker'),
    objective: byId('objective-text'),
    objectiveSub: byId('objective-sub'),
    killfeed: byId('killfeed'),
    crosshair: byId('crosshair'),
    hitmarker: byId('hitmarker'),
    progress: byId('progress'),
    progressLabel: byId('progress-label'),
    progressFill: byId('progress-fill'),
    health: byId('health'),
    armor: byId('armor'),
    healthBar: byId('health-bar'),
    money: byId('money'),
    weapon: byId('weapon-name'),
    mag: byId('mag'),
    reserve: byId('reserve'),
    utility: byId('utility'),
    status: byId('status'),
    stance: byId('stance'),
    damage: byId('damage'),
    buy: byId('buy'),
    buyFunds: byId('buy-funds'),
    start: byId('start'),
    pause: byId('pause'),
    result: byId('result'),
    resultKicker: byId('result-kicker'),
    resultScore: byId('result-score'),
    resultTitle: byId('result-title'),
    resultReason: byId('result-reason'),
    resultNext: byId('result-next'),
    resultEconomy: byId('result-economy'),
    board: byId('board-body'),
    trace: byId('trace-list'),
    traceNote: byId('trace-note'),
    hud: byId('hud'),
  };

  // Trace rows are built once and re-used: the list is a fixed three enemies.
  const traceRows = [];
  for (let i = 0; i < TRACE_ROWS; i++) {
    const row = document.createElement('li');
    const name = document.createElement('b');
    const intent = document.createElement('span');
    const where = document.createElement('em');
    row.append(name, intent, where);
    els.trace.append(row);
    traceRows.push({ row, name, intent, where });
  }

  function setText(key, value) {
    if (textCache.get(key) === value) return;
    textCache.set(key, value);
    const node = els[key];
    if (node) node.textContent = value;
  }

  function clockText(seconds) {
    const whole = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }

  // --- Radar ---------------------------------------------------------------------
  // North is up; the plan comes from the world so the minimap is the map, not a drawing.
  function drawRadar() {
    const width = radar.width;
    const height = radar.height;
    const scale = UI.RADAR_SCALE;
    const cx = width / 2;
    const cy = height / 2;
    radarPaint.clearRect(0, 0, width, height);
    radarPaint.fillStyle = '#16211f';
    radarPaint.fillRect(0, 0, width, height);
    radarPaint.strokeStyle = '#3f5350';
    radarPaint.lineWidth = 1;
    radarPaint.strokeRect(4.5, 4.5, width - 9, height - 9);

    radarPaint.strokeStyle = '#2c3c3a';
    radarPaint.lineWidth = 3;
    for (const lane of world.plan.lanes) {
      radarPaint.beginPath();
      radarPaint.moveTo(cx + lane.x * scale, cy + lane.z * scale);
      radarPaint.lineTo(cx + lane.x2 * scale, cy + lane.z2 * scale);
      radarPaint.stroke();
    }
    radarPaint.fillStyle = '#33453f';
    for (const block of world.plan.blocks) {
      radarPaint.fillRect(
        cx + (block.x - block.w / 2) * scale,
        cy + (block.z - block.d / 2) * scale,
        block.w * scale,
        block.d * scale,
      );
    }
    radarPaint.beginPath();
    for (const tank of world.plan.tanks) {
      radarPaint.moveTo(cx + (tank.x + tank.r) * scale, cy + tank.z * scale);
      radarPaint.arc(cx + tank.x * scale, cy + tank.z * scale, tank.r * scale, 0, Math.PI * 2);
    }
    radarPaint.fill();

    for (const site of world.sites) {
      radarPaint.fillStyle = site.name === 'A' ? '#f0a63c' : '#4fb3bd';
      radarPaint.font = 'bold 13px monospace';
      radarPaint.textAlign = 'center';
      radarPaint.fillText(site.name, cx + site.x * scale, cy + site.z * scale + 4);
    }

    // Bodies: allies always, enemies only when seen recently (or in a capture pose).
    for (const actor of state.actors) {
      if (!actor.alive) continue;
      const seen = actor === state.player || actor.team === 0 || state.shot || state.time - actor.lastSeen < 1.2;
      if (!seen) continue;
      radarPaint.fillStyle = actor === state.player ? '#efe6d0' : actor.team === 0 ? '#4fb3bd' : '#d0743c';
      radarPaint.beginPath();
      radarPaint.arc(cx + actor.x * scale, cy + actor.z * scale, actor === state.player ? 3.6 : 3, 0, Math.PI * 2);
      radarPaint.fill();
    }
    if (state.charge.planted) {
      radarPaint.strokeStyle = '#f0a63c';
      radarPaint.lineWidth = 2;
      radarPaint.strokeRect(cx + state.charge.x * scale - 5, cy + state.charge.z * scale - 5, 10, 10);
    }
    radarPaint.fillStyle = '#8d9d99';
    radarPaint.font = '9px monospace';
    radarPaint.textAlign = 'left';
    radarPaint.fillText('N', width / 2 - 3, 14);
  }

  // --- Board ---------------------------------------------------------------------
  // Rebuilt only when the round ends: the debrief is the one place with a real table, and it
  // is grouped by side so the reader can compare the two squads rather than read one list.
  function renderBoard() {
    els.board.replaceChildren();
    const sides = [
      [0, 'SLACKWATER', 'ally'],
      [1, 'TIDEWATCH', 'enemy'],
    ];
    for (const [team, label, tone] of sides) {
      const head = document.createElement('tr');
      head.className = `team ${tone}`;
      const title = document.createElement('td');
      title.colSpan = 6;
      title.textContent = label;
      head.append(title);
      els.board.append(head);
      for (const actor of [state.player, ...state.bots]) {
        if (actor.team !== team) continue;
        const row = document.createElement('tr');
        if (actor === state.player) row.className = 'me';
        if (!actor.alive) row.classList.add('down');
        const cells = [
          actor.name,
          String(actor.kills),
          String(actor.deaths),
          String(Math.round(actor.damage)),
          String(Math.round(actor.armor)),
          actor.alive ? 'ACTIVE' : 'DOWN',
        ];
        for (const value of cells) {
          const cell = document.createElement('td');
          cell.textContent = value;
          row.append(cell);
        }
        els.board.append(row);
      }
    }
  }

  let lastRadar = -1;
  let lastFeed = '';
  let lastPhase = '';
  let lastBoardPhase = '';

  return function update(input) {
    const player = state.player;
    const weapon = WEAPONS[player.weapon];
    const charge = state.charge;

    setText('scoreAlly', String(state.score[0]).padStart(2, '0'));
    setText('scoreEnemy', String(state.score[1]).padStart(2, '0'));
    setText('roundLabel', `ROUND ${String(state.round).padStart(2, '0')}`);
    setText('phaseLabel', PHASE_LABEL[state.phase] || 'SECTOR LIVE');
    const shown = state.phase === PHASE.ARMED ? charge.fuse : state.timer;
    setText('timer', clockText(shown));
    setText('kicker', state.objective.kicker);
    setText('objective', state.objective.text);
    setText('objectiveSub', state.objective.sub);
    setText('zone', zoneAt(player.x, player.z));

    setText('health', String(Math.ceil(player.hp)).padStart(3, '0'));
    setText('armor', String(Math.ceil(player.armor)).padStart(2, '0'));
    setText('money', `$ ${state.money.toLocaleString('en-US')}`);
    setText('weapon', `${weapon.name} / ${weapon.code}`);
    setText('mag', String(player.mag).padStart(2, '0'));
    setText('reserve', `/ ${player.reserve}`);
    setText('utility', `${player.frags} × BRINE · ${player.veils} × VEIL`);
    setText('stance', state.aiming ? 'ADS 1.54×' : 'HIP');
    els.healthBar.style.width = `${Math.max(0, Math.min(100, player.hp))}%`;
    els.healthBar.style.background = player.hp > 50 ? '#8fd6b0' : player.hp > 22 ? '#f0a63c' : '#d0743c';

    // Movement accuracy is stated in words, because that is the rule the player must learn.
    const speed = Math.hypot(player.vx, player.vz);
    const status = !player.alive
      ? 'DOWN · WAITING FOR THE NEXT ROUND'
      : player.reload > 0
        ? 'RELOADING'
        : player.crouch
          ? 'CROUCHED · TIGHTEST CONE'
          : state.aiming
            ? 'AIMED · STEADY'
            : speed > 2.6
              ? 'SPRINTING · CONE WIDE'
              : speed > 0.6
                ? 'MOVING · CONE OPEN'
                : 'STANDING · CONE TIGHT';
    setText('status', status);

    els.crosshair.style.setProperty('--gap', `${4 + player.spread * 900}px`);
    els.crosshair.style.opacity = state.aiming ? '0' : '1';
    els.hitmarker.style.opacity = state.hitFlash > 0 ? '1' : '0';
    els.damage.style.opacity = String(state.damageFlash * 0.75);

    const progress = charge.planted ? charge.defuse / 7 : charge.plant / 3.2;
    const showProgress = charge.plant > 0.02 || charge.defuse > 0.02;
    els.progress.hidden = !showProgress;
    if (showProgress) {
      els.progressLabel.textContent = charge.planted ? 'DISARMING' : 'ARMING CHARGE';
      els.progressFill.style.width = `${Math.min(100, Math.max(0, progress * 100))}%`;
    }

    // Killfeed: one text node, rewritten only when a line expires or arrives.
    const feedText = state.feed
      .filter((line) => line.until > state.time)
      .map((line) => line.text)
      .join('\n');
    if (feedText !== lastFeed) {
      lastFeed = feedText;
      els.killfeed.textContent = feedText;
    }

    // Signal trace: the enemy's intent, named. This is the AI made legible in play.
    const enemies = state.actors.filter((actor) => actor.team === 1);
    for (let i = 0; i < TRACE_ROWS; i++) {
      const enemy = enemies[i];
      const row = traceRows[i];
      if (!enemy) {
        row.row.hidden = true;
        continue;
      }
      row.row.hidden = false;
      row.row.className = enemy.alive ? '' : 'down';
      row.name.textContent = enemy.name;
      row.intent.textContent = enemy.alive ? enemy.intent : 'ELIMINATED';
      const metres = Math.round(Math.sqrt(distance2(player, enemy)));
      row.where.textContent = enemy.alive ? `${zoneAt(enemy.x, enemy.z)} · ${metres}m` : '—';
    }
    const alive = aliveCount(1);
    setText('traceNote', `${alive} TIDEWATCH ACTIVE · ${aliveCount(0)} SLACKWATER`);

    // Overlays.
    els.buy.hidden = !state.buyOpen;
    if (state.buyOpen) setText('buyFunds', `FUNDS $ ${state.money.toLocaleString('en-US')}`);
    els.start.hidden = state.started || Boolean(state.shot);
    els.pause.hidden = !state.started || input.locked || Boolean(state.shot);

    const over = state.phase === PHASE.OVER || state.phase === PHASE.MATCH;
    els.result.hidden = !over;
    els.hud.classList.toggle('veiled', over);
    if (over) {
      const won = state.roundWinner === 0;
      setText('resultKicker', state.phase === PHASE.MATCH ? 'MATCH COMPLETE' : `ROUND ${String(state.round).padStart(2, '0')} · ${won ? 'SLACKWATER' : 'TIDEWATCH'}`);
      setText('resultScore', `SLACKWATER ${state.score[0]} — ${state.score[1]} TIDEWATCH`);
      setText('resultTitle', state.phase === PHASE.MATCH
        ? (state.score[0] > state.score[1] ? 'MATCH WON' : 'MATCH LOST')
        : won ? 'ROUND WON' : 'ROUND LOST');
      setText('resultReason', state.roundReason);
      setText('resultNext', state.phase === PHASE.MATCH
        ? 'NEW MATCH IN A MOMENT'
        : `NEXT ROUND IN ${Math.ceil(state.timer)}`);
      setText('resultEconomy', `${won ? 'WIN' : 'LOSS'} PAYOUT $ ${state.roundPayout.toLocaleString('en-US')} · FUNDS $ ${state.money.toLocaleString('en-US')} · WIN AT ${ROUND.ROUNDS_TO_WIN}`);
      if (lastBoardPhase !== state.phase + state.round) {
        lastBoardPhase = state.phase + state.round;
        renderBoard();
      }
    }

    if (lastPhase !== state.phase) {
      lastPhase = state.phase;
      textCache.delete('phaseLabel');
    }
    if (lastRadar !== Math.floor(state.time * RADAR_HZ)) {
      lastRadar = Math.floor(state.time * RADAR_HZ);
      drawRadar();
    }
  };
}
