const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

const modeButtons = document.querySelectorAll('[data-mode]');
const practiceBtn = document.getElementById('practiceBtn');
const modeLabel = document.getElementById('modeLabel');
const levelLabel = document.getElementById('levelLabel');
const turnLabel = document.getElementById('turnLabel');
const timerLabel = document.getElementById('timerLabel');
const achievementsList = document.getElementById('achievements');
const scoreboardList = document.getElementById('scoreboard');
const usernameInput = document.getElementById('username');
const saveProfileBtn = document.getElementById('saveProfile');
const themeSelect = document.getElementById('themeSelect');
const levelSelect = document.getElementById('levelSelect');
const coinColorSelect = document.getElementById('coinColorSelect');
const boardElement = document.getElementById('board');
const MODE_NAMES_JA = {
  ai: 'AI対戦',
  local: 'ローカル対戦',
  online: 'オンライン対戦（シミュレーション）',
  practice: '練習',
};
const COLOR_NAMES_JA = {
  black: '黒',
  white: '白',
};

const BOARD = { w: 760, h: 760, margin: 60 };
const BASE_POCKET_R = 26;
const COIN_R = 14;
const STRIKER_R = 16;
const STRIKER_LINE_TOP = 110;
const STRIKER_LINE_BOTTOM = BOARD.h - 110;
const STRIKER_LINE_MIN_X = 150;
const STRIKER_LINE_MAX_X = BOARD.w - 150;
const BASE_FRICTION = 0.991;
const STOP_EPS = 0.08;
const BASE_ASSIST_POWER_THRESHOLD = 6.5;
const MAX_SHOT_POWER_PERCENT = 100;
const MAX_STRIKER_SHOT_SPEED = 22;
const PLAYFIELD_MIN = 24;
const PLAYFIELD_MAX_X = BOARD.w - PLAYFIELD_MIN;
const PLAYFIELD_MAX_Y = BOARD.h - PLAYFIELD_MIN;
const LEVEL_SETTINGS = {
  1: {
    turnTime: 25,
    pocketRadius: BASE_POCKET_R,
    friction: BASE_FRICTION,
    assistThreshold: BASE_ASSIST_POWER_THRESHOLD,
    assistMultiplier: 0.12,
    aiRandomness: 0.38,
    aiPowerBoost: 0,
  },
  2: {
    turnTime: 18,
    pocketRadius: 22,
    friction: 0.987,
    assistThreshold: 9,
    assistMultiplier: 0.08,
    aiRandomness: 0.14,
    aiPowerBoost: 1.5,
  },
};

const state = {
  mode: null,
  level: 1,
  turn: 0,
  turnTime: 25,
  timerRef: null,
  moving: false,
  aiming: false,
  aimPoint: null,
  shotPower: 0,
  lastShotPower: 0,
  pendingTurnSwitch: false,
  players: [
    { name: 'プレイヤー1', score: 0, wins: 0, losses: 0, assigned: 'black', colorPocketed: 0, queenPocketed: 0 },
    { name: 'プレイヤー2', score: 0, wins: 0, losses: 0, assigned: 'white', colorPocketed: 0, queenPocketed: 0 },
  ],
  lastWinnerName: localStorage.getItem('lastWinnerName') || '',
  stats: {
    matchesPlayed: Number(localStorage.getItem('matchesPlayed') || 0),
    wins: Number(localStorage.getItem('wins') || 0),
    losses: Number(localStorage.getItem('losses') || 0),
    level: Number(localStorage.getItem('level') || 1),
    coins: Number(localStorage.getItem('coins') || 0),
    precisionTurns: Number(localStorage.getItem('precisionTurns') || 0),
  },
  objects: [],
};

function levelConfig() {
  return LEVEL_SETTINGS[state.level] || LEVEL_SETTINGS[1];
}

function saveStats() {
  Object.entries(state.stats).forEach(([k, v]) => localStorage.setItem(k, String(v)));
}

function resetBoard() {
  state.objects = [];
  state.pendingTurnSwitch = false;

  const centerX = BOARD.w / 2;
  const centerY = BOARD.h / 2;

  const coins = [];
  for (let i = 0; i < 9; i++) {
    coins.push({ type: 'black', color: '#262626' });
    coins.push({ type: 'white', color: '#f5f5f5' });
  }
  coins.push({ type: 'queen', color: '#cc2936' });

  coins.forEach((coin, i) => {
    const angle = (Math.PI * 2 * i) / coins.length;
    const radius = i === coins.length - 1 ? 0 : 48 + (i % 3) * 17;
    state.objects.push({
      ...coin,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      r: COIN_R,
      active: true,
    });
  });

  state.objects.push({
    type: 'striker',
    color: '#f4bf5b',
    x: centerX,
    y: STRIKER_LINE_BOTTOM,
    vx: 0,
    vy: 0,
    r: STRIKER_R,
    active: true,
  });
}

function currentStrikerLineY() {
  return state.turn === 0 ? STRIKER_LINE_BOTTOM : STRIKER_LINE_TOP;
}

function clampStrikerX(x) {
  return Math.min(STRIKER_LINE_MAX_X, Math.max(STRIKER_LINE_MIN_X, x));
}

function initMode(mode) {
  state.mode = mode;
  state.level = Number(levelSelect.value) || 1;
  state.turn = 0;
  state.pendingTurnSwitch = false;
  const selectedColor = coinColorSelect.value === 'white' ? 'white' : 'black';
  const oppositeColor = selectedColor === 'black' ? 'white' : 'black';
  state.players[0].assigned = selectedColor;
  state.players[1].assigned = oppositeColor;
  state.players[0].score = 0;
  state.players[1].score = 0;
  state.players[0].colorPocketed = 0;
  state.players[1].colorPocketed = 0;
  state.players[0].queenPocketed = 0;
  state.players[1].queenPocketed = 0;
  state.players[0].name = usernameInput.value || 'プレイヤー1';
  state.players[1].name = mode === 'ai' ? 'AIボット' : mode === 'online' ? 'オンライン対戦相手' : 'プレイヤー2';
  modeLabel.textContent = `モード: ${MODE_NAMES_JA[mode] || mode}`;
  levelLabel.textContent = `ゲームレベル: ${state.level}`;
  resetBoard();
  startTurnTimer();
  renderPanels();
}

function startTurnTimer() {
  clearInterval(state.timerRef);
  state.turnTime = levelConfig().turnTime;
  timerLabel.textContent = `ターンタイマー: ${state.turnTime}秒`;
  state.timerRef = setInterval(() => {
    if (state.moving) return;
    state.turnTime -= 1;
    timerLabel.textContent = `ターンタイマー: ${state.turnTime}秒`;
    if (state.turnTime <= 0) {
      advanceTurnAndHandleAutomation();
    }
  }, 1000);
}

function placeStrikerForCurrentTurn(center = true) {
  const striker = state.objects.find((o) => o.type === 'striker');
  if (!striker) return;
  if (center) striker.x = BOARD.w / 2;
  striker.y = currentStrikerLineY();
  striker.vx = 0;
  striker.vy = 0;
}

function switchTurn() {
  state.turn = (state.turn + 1) % 2;
  state.turnTime = levelConfig().turnTime;
  state.aiming = false;
  state.aimPoint = null;
  state.shotPower = 0;
  placeStrikerForCurrentTurn(true);
}

function advanceTurnAndHandleAutomation() {
  switchTurn();
  if ((state.mode === 'ai' || state.mode === 'online') && state.turn === 1 && !state.moving) {
    setTimeout(() => {
      if (!state.moving && state.turn === 1) aiShoot();
    }, 120);
  }
}

function pockets() {
  return [
    { x: BOARD.margin, y: BOARD.margin },
    { x: BOARD.w - BOARD.margin, y: BOARD.margin },
    { x: BOARD.margin, y: BOARD.h - BOARD.margin },
    { x: BOARD.w - BOARD.margin, y: BOARD.h - BOARD.margin },
  ];
}

function drawBoard() {
  ctx.clearRect(0, 0, BOARD.w, BOARD.h);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--board');
  ctx.fillRect(0, 0, BOARD.w, BOARD.h);

  ctx.strokeStyle = '#6e4d2a';
  ctx.lineWidth = 5;
  ctx.strokeRect(24, 24, BOARD.w - 48, BOARD.h - 48);

  ctx.beginPath();
  ctx.arc(BOARD.w / 2, BOARD.h / 2, 68, 0, Math.PI * 2);
  ctx.stroke();

  ctx.setLineDash([8, 7]);
  ctx.strokeStyle = '#3a2b18';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(STRIKER_LINE_MIN_X, STRIKER_LINE_TOP);
  ctx.lineTo(STRIKER_LINE_MAX_X, STRIKER_LINE_TOP);
  ctx.moveTo(STRIKER_LINE_MIN_X, STRIKER_LINE_BOTTOM);
  ctx.lineTo(STRIKER_LINE_MAX_X, STRIKER_LINE_BOTTOM);
  ctx.stroke();
  ctx.setLineDash([]);

  pockets().forEach((p) => {
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(p.x, p.y, levelConfig().pocketRadius, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawObjects() {
  for (const o of state.objects) {
    if (!o.active) continue;
    ctx.fillStyle = o.color;
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
    ctx.fill();
    if (o.type === 'queen') {
      ctx.strokeStyle = '#fff0';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  if (state.aiming && state.aimPoint) {
    const striker = state.objects.find((o) => o.type === 'striker');
    drawAimPrediction(striker, state.aimPoint);
    ctx.strokeStyle = '#0ef';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(striker.x, striker.y);
    ctx.lineTo(state.aimPoint.x, state.aimPoint.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#0f1722dd';
    const boxX = Math.max(8, Math.min(BOARD.w - 104, striker.x - 48));
    const boxY = Math.max(8, Math.min(BOARD.h - 34, striker.y - 56));
    ctx.fillRect(boxX, boxY, 96, 26);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px Inter, system-ui, Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`パワー: ${state.shotPower.toFixed(1)}%`, boxX + 48, boxY + 18);
  }
}

function normalize(vx, vy) {
  const mag = Math.hypot(vx, vy);
  if (mag < 0.0001) return null;
  return { x: vx / mag, y: vy / mag };
}

function timeToBoundary(point, dir) {
  const hits = [];
  if (Math.abs(dir.x) > 0.0001) {
    hits.push({
      t: (PLAYFIELD_MIN + STRIKER_R - point.x) / dir.x,
      normal: { x: 1, y: 0 },
    });
    hits.push({
      t: (PLAYFIELD_MAX_X - STRIKER_R - point.x) / dir.x,
      normal: { x: -1, y: 0 },
    });
  }
  if (Math.abs(dir.y) > 0.0001) {
    hits.push({
      t: (PLAYFIELD_MIN + STRIKER_R - point.y) / dir.y,
      normal: { x: 0, y: 1 },
    });
    hits.push({
      t: (PLAYFIELD_MAX_Y - STRIKER_R - point.y) / dir.y,
      normal: { x: 0, y: -1 },
    });
  }
  return hits.filter((h) => h.t > 0.001).sort((a, b) => a.t - b.t)[0] || null;
}

function firstCoinContact(point, dir) {
  let best = null;
  for (const coin of state.objects) {
    if (!coin.active || coin.type === 'striker') continue;
    const rx = point.x - coin.x;
    const ry = point.y - coin.y;
    const radius = STRIKER_R + coin.r;
    const b = 2 * (dir.x * rx + dir.y * ry);
    const c = rx * rx + ry * ry - radius * radius;
    const discriminant = b * b - 4 * c;
    if (discriminant < 0) continue;
    const root = Math.sqrt(discriminant);
    const t1 = (-b - root) / 2;
    const t2 = (-b + root) / 2;
    const t = [t1, t2].filter((value) => value > 0.001).sort((a, b) => a - b)[0];
    if (!t) continue;
    if (!best || t < best.t) best = { t, coin };
  }
  return best;
}

function drawDashedSegment(from, to, color, dash = [7, 6], width = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawAimPrediction(striker, aimPoint) {
  const dir = normalize(striker.x - aimPoint.x, striker.y - aimPoint.y);
  if (!dir) return;
  const wallHit = timeToBoundary(striker, dir);
  const coinHit = firstCoinContact(striker, dir);
  const firstEvent = !coinHit || (wallHit && wallHit.t < coinHit.t) ? wallHit : coinHit;
  if (!firstEvent) return;

  const contact = {
    x: striker.x + dir.x * firstEvent.t,
    y: striker.y + dir.y * firstEvent.t,
  };
  drawDashedSegment(striker, contact, '#1e90ff', [6, 6], 2.2);

  if ('coin' in firstEvent) {
    const n = normalize(contact.x - firstEvent.coin.x, contact.y - firstEvent.coin.y);
    if (!n) return;
    const impact = Math.max(0, dir.x * n.x + dir.y * n.y);
    const coinDir = { x: n.x * impact, y: n.y * impact };
    const strikerDir = { x: dir.x - impact * n.x, y: dir.y - impact * n.y };
    drawDashedSegment(contact, { x: contact.x + coinDir.x * 170, y: contact.y + coinDir.y * 170 }, '#ff5252');
    drawDashedSegment(contact, { x: contact.x + strikerDir.x * 140, y: contact.y + strikerDir.y * 140 }, '#ffae42');
    return;
  }

  const reflected = {
    x: dir.x - 2 * (dir.x * firstEvent.normal.x + dir.y * firstEvent.normal.y) * firstEvent.normal.x,
    y: dir.y - 2 * (dir.x * firstEvent.normal.x + dir.y * firstEvent.normal.y) * firstEvent.normal.y,
  };
  drawDashedSegment(contact, { x: contact.x + reflected.x * 140, y: contact.y + reflected.y * 140 }, '#1e90ff');
}

function physicsStep() {
  let moving = false;
  for (const o of state.objects) {
    if (!o.active) continue;
    o.x += o.vx;
    o.y += o.vy;
    o.vx *= levelConfig().friction;
    o.vy *= levelConfig().friction;
    if (Math.abs(o.vx) < STOP_EPS) o.vx = 0;
    if (Math.abs(o.vy) < STOP_EPS) o.vy = 0;
    moving ||= o.vx !== 0 || o.vy !== 0;

    if (o.x - o.r < PLAYFIELD_MIN || o.x + o.r > PLAYFIELD_MAX_X) o.vx *= -1;
    if (o.y - o.r < PLAYFIELD_MIN || o.y + o.r > PLAYFIELD_MAX_Y) o.vy *= -1;
  }

  for (let i = 0; i < state.objects.length; i++) {
    for (let j = i + 1; j < state.objects.length; j++) {
      const a = state.objects[i];
      const b = state.objects[j];
      if (!a.active || !b.active) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const minD = a.r + b.r;
      if (d > 0 && d < minD) {
        const nx = dx / d;
        const ny = dy / d;
        const overlap = minD - d;
        a.x -= (overlap * nx) / 2;
        a.y -= (overlap * ny) / 2;
        b.x += (overlap * nx) / 2;
        b.y += (overlap * ny) / 2;

        const p = (2 * (a.vx * nx + a.vy * ny - b.vx * nx - b.vy * ny)) / 2;
        a.vx -= p * nx;
        a.vy -= p * ny;
        b.vx += p * nx;
        b.vy += p * ny;

        const striker = a.type === 'striker' ? a : b.type === 'striker' ? b : null;
        const coin = striker && striker === a ? b : striker && striker === b ? a : null;
        if (striker && coin && coin.type !== 'striker' && state.lastShotPower >= levelConfig().assistThreshold) {
          const nearestPocket = pockets().reduce((best, pocket) => {
            const dist = Math.hypot(coin.x - pocket.x, coin.y - pocket.y);
            return !best || dist < best.dist ? { ...pocket, dist } : best;
          }, null);
          const toCoinX = coin.x - striker.x;
          const toCoinY = coin.y - striker.y;
          const toPocketX = nearestPocket.x - coin.x;
          const toPocketY = nearestPocket.y - coin.y;
          const toCoinD = Math.max(1, Math.hypot(toCoinX, toCoinY));
          const toPocketD = Math.max(1, Math.hypot(toPocketX, toPocketY));
          const alignment = (toCoinX * toPocketX + toCoinY * toPocketY) / (toCoinD * toPocketD);
          if (alignment > 0.87) {
            const assistSpeed = levelConfig().assistMultiplier * state.lastShotPower;
            coin.vx += (toPocketX / toPocketD) * assistSpeed;
            coin.vy += (toPocketY / toPocketD) * assistSpeed;
          }
        }
      }
    }
  }

  handlePocketing();
  state.moving = moving;
  if (!moving) {
    if (state.pendingTurnSwitch) {
      advanceTurnAndHandleAutomation();
      state.pendingTurnSwitch = false;
      state.lastShotPower = 0;
    }
  }
}

function handlePocketing() {
  const pks = pockets();
  let pocketedThisTurn = 0;
  let pocketEvents = 0;

  for (const o of state.objects) {
    if (!o.active || o.type === 'striker') continue;
    for (const p of pks) {
      if (Math.hypot(o.x - p.x, o.y - p.y) < levelConfig().pocketRadius) {
        pocketEvents += 1;
        const current = state.players[state.turn];
        const isOwnColor = o.type === current.assigned;
        const isQueen = o.type === 'queen';
        if (isOwnColor || isQueen) {
          o.active = false;
          pocketedThisTurn += 1;
          if (isQueen) {
            current.score += 2;
            current.queenPocketed += 1;
          } else {
            current.score += 1;
            current.colorPocketed += 1;
          }
        } else {
          respotCoin(o);
        }
        break;
      }
    }
  }

  if (pocketEvents > 0) triggerPocketFeedback(pocketEvents);
  if (pocketedThisTurn >= 3) state.stats.precisionTurns += 1;

  evaluateWin();
}

function triggerPocketFeedback(pocketEvents) {
  if (boardElement) {
    boardElement.classList.remove('pocket-shake');
    void boardElement.offsetWidth;
    boardElement.classList.add('pocket-shake');
  }

  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    const burstCount = Math.min(3, pocketEvents);
    const pattern = [];
    for (let i = 0; i < burstCount; i++) {
      pattern.push(18, 25);
    }
    navigator.vibrate(pattern);
  }
}

function respotCoin(coin) {
  coin.vx = 0;
  coin.vy = 0;
  const centerX = BOARD.w / 2;
  const centerY = BOARD.h / 2;
  const maxAttempts = 30;

  for (let i = 0; i < maxAttempts; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 24 + Math.random() * 54;
    const testX = centerX + Math.cos(angle) * radius;
    const testY = centerY + Math.sin(angle) * radius;
    const collides = state.objects.some(
      (obj) => obj !== coin && obj.active && Math.hypot(obj.x - testX, obj.y - testY) < obj.r + coin.r + 3,
    );
    if (!collides) {
      coin.x = testX;
      coin.y = testY;
      return;
    }
  }

  coin.x = centerX;
  coin.y = centerY;
}

function evaluateWin() {
  const remainingAssignedByPlayer = state.players.map((player) =>
    state.objects.filter((o) => o.active && o.type === player.assigned).length,
  );
  const queenRemaining = state.objects.some((o) => o.active && o.type === 'queen');
  const currentPlayer = state.players[state.turn];
  const currentPlayerIndex = state.turn;
  const currentPlayerCanStillPocket =
    remainingAssignedByPlayer[currentPlayerIndex] + (queenRemaining ? 1 : 0);
  if (currentPlayerCanStillPocket > 0) return;

  const winner = currentPlayer;

  clearInterval(state.timerRef);
  const p1 = state.players[0];
  const loser = winner === p1 ? state.players[1] : p1;

  alert(`${winner.name} の勝利！+5ボーナスポイント。`);
  winner.score += 5;
  state.lastWinnerName = winner.name;
  localStorage.setItem('lastWinnerName', winner.name);
  state.stats.matchesPlayed += 1;
  if (winner === p1) state.stats.wins += 1;
  else state.stats.losses += 1;
  state.stats.coins += winner.score;
  state.stats.level = 1 + Math.floor(state.stats.wins / 3);
  winner.wins += 1;
  loser.losses += 1;
  saveStats();
  updateAchievements();
  renderPanels();
  resetMatchAfterWin();
}

function resetMatchAfterWin() {
  setTimeout(() => {
    state.turn = 0;
    state.pendingTurnSwitch = false;
    state.moving = false;
    state.aiming = false;
    state.aimPoint = null;
    state.shotPower = 0;
    state.lastShotPower = 0;
    state.players.forEach((player) => {
      player.score = 0;
      player.colorPocketed = 0;
      player.queenPocketed = 0;
    });
    resetBoard();
    startTurnTimer();
    renderPanels();
  }, 150);
}

function aiShoot() {
  const striker = state.objects.find((o) => o.type === 'striker');
  const aiPlayer = state.players[1];
  const targets = state.objects.filter(
    (o) => o.active && (o.type === aiPlayer.assigned || o.type === 'queen'),
  );
  if (!targets.length) return;
  const pks = pockets();
  const bestTarget = targets
    .map((coin) => {
      const nearestPocketDist = pks.reduce((best, pocket) => {
        const dist = Math.hypot(coin.x - pocket.x, coin.y - pocket.y);
        return Math.min(best, dist);
      }, Number.POSITIVE_INFINITY);
      return { coin, nearestPocketDist };
    })
    .sort((a, b) => a.nearestPocketDist - b.nearestPocketDist)[0].coin;
  const randomTarget = targets[Math.floor(Math.random() * targets.length)];
  const target = Math.random() < levelConfig().aiRandomness ? randomTarget : bestTarget;
  const dx = target.x - striker.x;
  const dy = target.y - striker.y;
  const d = Math.max(1, Math.hypot(dx, dy));
  const pwr = Math.min(19, 9 + Math.random() * 6 + levelConfig().aiPowerBoost);
  striker.vx = (dx / d) * pwr;
  striker.vy = (dy / d) * pwr;
  state.lastShotPower = pwr;
  state.pendingTurnSwitch = true;
  state.moving = true;
}

function renderPanels() {
  turnLabel.textContent = `ターン: ${state.players[state.turn]?.name || '-'}`;
  scoreboardList.innerHTML = state.players
    .map(
      (p) =>
        `<li>${p.name}: ${p.score} 点 | 色: ${COLOR_NAMES_JA[p.assigned] || p.assigned} (${p.colorPocketed}/9) | 赤: ${p.queenPocketed}/1 (勝:${p.wins} 負:${p.losses})</li>`,
    )
    .join('');

  updateAchievements();
}

function updateAchievements() {
  const unlocked = [];
  if (state.stats.wins >= 1) unlocked.push('初勝利');
  if (state.stats.wins >= 50) unlocked.push('カロムマスター');
  if (state.stats.precisionTurns >= 1) unlocked.push('精密ショット');
  if (state.lastWinnerName) unlocked.push(`前回の勝者: ${state.lastWinnerName}`);
  achievementsList.innerHTML = unlocked.length
    ? unlocked.map((a) => `<li>${a}</li>`).join('')
    : '<li>まだ実績はありません。</li>';
}

function loop() {
  drawBoard();
  physicsStep();
  drawObjects();
  renderPanels();
  requestAnimationFrame(loop);
}

function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) * BOARD.w) / rect.width,
    y: ((e.clientY - rect.top) * BOARD.h) / rect.height,
  };
}

function getMaxDragDistanceToBorder(striker, aimPoint) {
  const dx = aimPoint.x - striker.x;
  const dy = aimPoint.y - striker.y;
  const dragDistance = Math.hypot(dx, dy);
  if (dragDistance < 0.0001) return 1;

  const dirX = dx / dragDistance;
  const dirY = dy / dragDistance;
  const hits = [];

  if (Math.abs(dirX) > 0.0001) {
    hits.push((PLAYFIELD_MIN - striker.x) / dirX);
    hits.push((PLAYFIELD_MAX_X - striker.x) / dirX);
  }

  if (Math.abs(dirY) > 0.0001) {
    hits.push((PLAYFIELD_MIN - striker.y) / dirY);
    hits.push((PLAYFIELD_MAX_Y - striker.y) / dirY);
  }

  const forwardHits = hits.filter((t) => t > 0.0001);
  if (!forwardHits.length) return dragDistance;
  return Math.min(...forwardHits);
}

function calculateShotPowerPercent(striker, aimPoint) {
  const dragDistance = Math.hypot(striker.x - aimPoint.x, striker.y - aimPoint.y);
  const maxDragDistance = getMaxDragDistanceToBorder(striker, aimPoint);
  return Math.min(MAX_SHOT_POWER_PERCENT, (dragDistance / Math.max(1, maxDragDistance)) * MAX_SHOT_POWER_PERCENT);
}

function releaseShot() {
  if (!state.aiming || state.moving) return;
  const striker = state.objects.find((o) => o.type === 'striker');
  const dx = striker.x - state.aimPoint.x;
  const dy = striker.y - state.aimPoint.y;
  const d = Math.max(1, Math.hypot(dx, dy));
  const shotPowerPercent = calculateShotPowerPercent(striker, state.aimPoint);
  const pwr = (shotPowerPercent / MAX_SHOT_POWER_PERCENT) * MAX_STRIKER_SHOT_SPEED;
  striker.vx = (dx / d) * pwr;
  striker.vy = (dy / d) * pwr;
  state.lastShotPower = pwr;
  state.pendingTurnSwitch = true;
  state.aiming = false;
  state.aimPoint = null;
  state.shotPower = 0;
  state.moving = true;
}

canvas.addEventListener('mousedown', (e) => {
  if (state.moving || !state.mode) return;
  if ((state.mode === 'ai' || state.mode === 'online') && state.turn === 1) return;
  if (e.button !== 0 && e.button !== 2) return;
  const { x, y } = getCanvasCoords(e);
  const striker = state.objects.find((o) => o.type === 'striker');
  const lineY = currentStrikerLineY();

  if (Math.hypot(x - striker.x, y - striker.y) <= striker.r + 8) {
    state.aiming = true;
    state.aimPoint = { x, y };
    state.shotPower = 0;
    return;
  }

  if (Math.abs(y - lineY) <= 18) {
    striker.x = clampStrikerX(x);
    striker.y = lineY;
    return;
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (!state.aiming) return;
  const { x, y } = getCanvasCoords(e);
  state.aimPoint = { x, y };
  const striker = state.objects.find((o) => o.type === 'striker');
  state.shotPower = calculateShotPowerPercent(striker, state.aimPoint);
});

canvas.addEventListener('mouseup', releaseShot);
window.addEventListener('mouseup', releaseShot);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());


canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
}, { passive: false });

modeButtons.forEach((b) => b.addEventListener('click', () => initMode(b.dataset.mode)));
practiceBtn.addEventListener('click', () => initMode('practice'));
saveProfileBtn.addEventListener('click', () => {
  state.players[0].name = usernameInput.value.trim() || 'プレイヤー1';
  alert('プロフィールをローカルに保存しました。');
  renderPanels();
});

themeSelect.addEventListener('change', () => {
  document.body.classList.remove('theme-night', 'theme-mint');
  if (themeSelect.value === 'night') document.body.classList.add('theme-night');
  if (themeSelect.value === 'mint') document.body.classList.add('theme-mint');
});

levelSelect.addEventListener('change', () => {
  levelLabel.textContent = `ゲームレベル: ${Number(levelSelect.value) || 1}`;
});

resetBoard();
levelLabel.textContent = `ゲームレベル: ${state.level}`;
renderPanels();
loop();
