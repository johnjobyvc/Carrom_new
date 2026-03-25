const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

const modeButtons = document.querySelectorAll('[data-mode]');
const practiceBtn = document.getElementById('practiceBtn');
const modeLabel = document.getElementById('modeLabel');
const turnLabel = document.getElementById('turnLabel');
const timerLabel = document.getElementById('timerLabel');
const statsList = document.getElementById('stats');
const achievementsList = document.getElementById('achievements');
const scoreboardList = document.getElementById('scoreboard');
const usernameInput = document.getElementById('username');
const saveProfileBtn = document.getElementById('saveProfile');
const themeSelect = document.getElementById('themeSelect');

const BOARD = { w: 760, h: 760, margin: 60 };
const POCKET_R = 26;
const COIN_R = 14;
const STRIKER_R = 16;
const FRICTION = 0.991;
const STOP_EPS = 0.08;

const state = {
  mode: null,
  turn: 0,
  turnTime: 25,
  timerRef: null,
  moving: false,
  aiming: false,
  aimStart: null,
  players: [
    { name: 'Player 1', score: 0, wins: 0, losses: 0, assigned: 'black' },
    { name: 'Player 2', score: 0, wins: 0, losses: 0, assigned: 'white' },
  ],
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

const leaderboards = {
  global: [
    { name: 'Alex', points: 1990 },
    { name: 'Mina', points: 1760 },
    { name: 'You', points: 900 },
  ],
  weekly: [
    { name: 'You', points: 120 },
    { name: 'Sam', points: 100 },
    { name: 'Ivy', points: 80 },
  ],
  friends: [
    { name: 'Ravi', points: 300 },
    { name: 'You', points: 240 },
    { name: 'Dee', points: 160 },
  ],
};

function saveStats() {
  Object.entries(state.stats).forEach(([k, v]) => localStorage.setItem(k, String(v)));
}

function resetBoard() {
  state.objects = [];

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
    y: BOARD.h - 110,
    vx: 0,
    vy: 0,
    r: STRIKER_R,
    active: true,
  });
}

function initMode(mode) {
  state.mode = mode;
  state.turn = 0;
  state.players[0].score = 0;
  state.players[1].score = 0;
  state.players[0].name = usernameInput.value || 'Player 1';
  state.players[1].name = mode === 'ai' ? 'AI Bot' : mode === 'online' ? 'Online Rival' : 'Player 2';
  modeLabel.textContent = `Mode: ${mode}`;
  resetBoard();
  startTurnTimer();
  renderPanels();
}

function startTurnTimer() {
  clearInterval(state.timerRef);
  state.turnTime = 25;
  timerLabel.textContent = `Turn Timer: ${state.turnTime}s`;
  state.timerRef = setInterval(() => {
    if (state.moving) return;
    state.turnTime -= 1;
    timerLabel.textContent = `Turn Timer: ${state.turnTime}s`;
    if (state.turnTime <= 0) {
      switchTurn();
    }
  }, 1000);
}

function switchTurn() {
  state.turn = (state.turn + 1) % 2;
  state.turnTime = 25;
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

  pockets().forEach((p) => {
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(p.x, p.y, POCKET_R, 0, Math.PI * 2);
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

  if (state.aiming && state.aimStart) {
    const striker = state.objects.find((o) => o.type === 'striker');
    ctx.strokeStyle = '#0ef';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(striker.x, striker.y);
    ctx.lineTo(state.aimStart.x, state.aimStart.y);
    ctx.stroke();
  }
}

function physicsStep() {
  let moving = false;
  for (const o of state.objects) {
    if (!o.active) continue;
    o.x += o.vx;
    o.y += o.vy;
    o.vx *= FRICTION;
    o.vy *= FRICTION;
    if (Math.abs(o.vx) < STOP_EPS) o.vx = 0;
    if (Math.abs(o.vy) < STOP_EPS) o.vy = 0;
    moving ||= o.vx !== 0 || o.vy !== 0;

    if (o.x - o.r < 24 || o.x + o.r > BOARD.w - 24) o.vx *= -1;
    if (o.y - o.r < 24 || o.y + o.r > BOARD.h - 24) o.vy *= -1;
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
      }
    }
  }

  handlePocketing();
  state.moving = moving;
  if (!moving) {
    const striker = state.objects.find((o) => o.type === 'striker');
    striker.x = BOARD.w / 2;
    striker.y = state.turn === 0 ? BOARD.h - 110 : 110;
    if ((state.mode === 'ai' || state.mode === 'online') && state.turn === 1) {
      aiShoot();
    }
  }
}

function handlePocketing() {
  const pks = pockets();
  let pocketedThisTurn = 0;

  for (const o of state.objects) {
    if (!o.active || o.type === 'striker') continue;
    for (const p of pks) {
      if (Math.hypot(o.x - p.x, o.y - p.y) < POCKET_R) {
        o.active = false;
        pocketedThisTurn += 1;
        const current = state.players[state.turn];
        if (o.type === 'queen') current.score += 2;
        else current.score += 1;
      }
    }
  }

  if (pocketedThisTurn >= 3) state.stats.precisionTurns += 1;

  if (!state.moving && pocketedThisTurn === 0) switchTurn();

  evaluateWin();
}

function evaluateWin() {
  const remainBlack = state.objects.some((o) => o.active && o.type === 'black');
  const remainWhite = state.objects.some((o) => o.active && o.type === 'white');
  if (remainBlack || remainWhite) return;

  clearInterval(state.timerRef);
  const p1 = state.players[0];
  const p2 = state.players[1];
  const winner = p1.score >= p2.score ? p1 : p2;
  const loser = winner === p1 ? p2 : p1;

  alert(`${winner.name} wins! +5 bonus points.`);
  winner.score += 5;
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
}

function aiShoot() {
  const striker = state.objects.find((o) => o.type === 'striker');
  const targets = state.objects.filter((o) => o.active && o.type !== 'striker');
  if (!targets.length) return;
  const t = targets[Math.floor(Math.random() * targets.length)];
  const dx = t.x - striker.x;
  const dy = t.y - striker.y;
  const d = Math.max(1, Math.hypot(dx, dy));
  const pwr = Math.min(18, 9 + Math.random() * 6);
  striker.vx = (dx / d) * pwr;
  striker.vy = (dy / d) * pwr;
  state.moving = true;
}

function renderPanels() {
  turnLabel.textContent = `Turn: ${state.players[state.turn]?.name || '-'}`;
  scoreboardList.innerHTML = state.players
    .map((p) => `<li>${p.name}: ${p.score} pts (W:${p.wins} L:${p.losses})</li>`)
    .join('');

  statsList.innerHTML = [
    `Matches: ${state.stats.matchesPlayed}`,
    `Wins/Losses: ${state.stats.wins}/${state.stats.losses}`,
    `Level: ${state.stats.level}`,
    `Reward Coins: ${state.stats.coins}`,
  ]
    .map((s) => `<li>${s}</li>`)
    .join('');

  updateAchievements();
  renderLeaderboards();
}

function updateAchievements() {
  const unlocked = [];
  if (state.stats.wins >= 1) unlocked.push('First Win');
  if (state.stats.wins >= 50) unlocked.push('Carrom Master');
  if (state.stats.precisionTurns >= 1) unlocked.push('Precision Shot');
  achievementsList.innerHTML = unlocked.length
    ? unlocked.map((a) => `<li>${a}</li>`).join('')
    : '<li>No achievements yet.</li>';
}

function renderLeaderboards() {
  const paint = (id, arr) => {
    const node = document.getElementById(id);
    node.innerHTML = arr.map((r) => `<li>${r.name} - ${r.points}</li>`).join('');
  };
  paint('globalLeaderboard', leaderboards.global);
  paint('weeklyLeaderboard', leaderboards.weekly);
  paint('friendLeaderboard', leaderboards.friends);
}

function loop() {
  drawBoard();
  physicsStep();
  drawObjects();
  renderPanels();
  requestAnimationFrame(loop);
}

canvas.addEventListener('mousedown', (e) => {
  if (state.moving || !state.mode) return;
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) * BOARD.w) / rect.width;
  const y = ((e.clientY - rect.top) * BOARD.h) / rect.height;
  const striker = state.objects.find((o) => o.type === 'striker');
  if (Math.hypot(x - striker.x, y - striker.y) <= striker.r + 8) {
    state.aiming = true;
    state.aimStart = { x, y };
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (!state.aiming) return;
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) * BOARD.w) / rect.width;
  const y = ((e.clientY - rect.top) * BOARD.h) / rect.height;
  state.aimStart = { x, y };
});

canvas.addEventListener('mouseup', () => {
  if (!state.aiming || state.moving) return;
  const striker = state.objects.find((o) => o.type === 'striker');
  const dx = striker.x - state.aimStart.x;
  const dy = striker.y - state.aimStart.y;
  const d = Math.max(1, Math.hypot(dx, dy));
  const pwr = Math.min(22, d / 8);
  striker.vx = (dx / d) * pwr;
  striker.vy = (dy / d) * pwr;
  state.aiming = false;
  state.aimStart = null;
  state.moving = true;
});

modeButtons.forEach((b) => b.addEventListener('click', () => initMode(b.dataset.mode)));
practiceBtn.addEventListener('click', () => initMode('practice'));
saveProfileBtn.addEventListener('click', () => {
  alert('Profile saved locally.');
  renderPanels();
});

themeSelect.addEventListener('change', () => {
  document.body.classList.remove('theme-night', 'theme-mint');
  if (themeSelect.value === 'night') document.body.classList.add('theme-night');
  if (themeSelect.value === 'mint') document.body.classList.add('theme-mint');
});

resetBoard();
renderPanels();
loop();
