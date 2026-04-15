const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

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
const boardElement = document.getElementById('board');
const onlineStatus = document.getElementById('onlineStatus');
const copyInviteBtn = document.getElementById('copyInviteBtn');
const startGameBtn = document.getElementById('startGameBtn');
const MODE_NAMES_JA = {
  online: 'オンライン対戦（リアルプレイヤー）',
};
const COLOR_NAMES_JA = {
  black: '黒',
  white: '白',
};

const BOARD = { w: 860, h: 860, margin: 68 };
const BASE_POCKET_R = 26;
const COIN_R = 14;
const STRIKER_R = 16;
const STRIKER_GUIDE_DISTANCE = 190;
const STRIKER_LINE_TOP = STRIKER_GUIDE_DISTANCE;
const STRIKER_LINE_BOTTOM = BOARD.h - STRIKER_GUIDE_DISTANCE;
const STRIKER_LINE_MIN_X = BOARD.w / 2 - STRIKER_GUIDE_DISTANCE;
const STRIKER_LINE_MAX_X = BOARD.w / 2 + STRIKER_GUIDE_DISTANCE;
const BASE_FRICTION = 0.991;
const STOP_EPS = 0.08;
const BASE_ASSIST_POWER_THRESHOLD = 6.5;
const MAX_SHOT_POWER_PERCENT = 200;
const MAX_STRIKER_SHOT_SPEED = 22;
const MAX_SHOT_DRAG_DISTANCE = 260;
const EXTRA_AIM_DRAG_SPACE = 220;
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
  wasMoving: false,
  aiming: false,
  draggingStriker: false,
  aimPoint: null,
  shotPower: 0,
  lastShotPower: 0,
  pendingTurnSwitch: false,
  pendingRespots: [],
  scoredThisTurn: false,
  currentShot: {
    ownColorPocketed: 0,
    opponentColorPocketed: 0,
  },
  queenCoverPending: null,
  shotPromptShownThisTurn: false,
  aiShotQueued: false,
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
  gameStarted: false,
};

const online = {
  peer: null,
  conn: null,
  roomId: null,
  isHost: true,
  connected: false,
  roleSelected: null,
  retryCount: 0,
  retryTimer: null,
};

function updateStartButtonState() {
  if (!startGameBtn) return;
  const canStart = state.mode === 'online' && online.connected;
  startGameBtn.disabled = !canStart;
  startGameBtn.textContent = state.gameStarted ? 'RESTART GAME' : 'START GAME';
}

function setOnlineStatus(text) {
  if (onlineStatus) onlineStatus.textContent = `オンライン: ${text}`;
  updateStartButtonState();
}

function buildShareUrl() {
  const inviteUrl = new URL(window.location.href);
  inviteUrl.search = '';
  inviteUrl.searchParams.set('room', getAutoRoomId());
  return inviteUrl.toString();
}

function sanitizeRoomId(value) {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '')
    .slice(0, 24);
}

function getAutoRoomId() {
  const fromQuery = sanitizeRoomId(new URLSearchParams(window.location.search).get('room'));
  if (fromQuery) return fromQuery;
  const base = sanitizeRoomId(`${location.host || 'local'}-${location.pathname.replace(/\//g, '-')}`) || 'default-room';
  return base.slice(0, 24);
}

function isMyOnlineTurn() {
  if (state.mode !== 'online') return true;
  if (!online.connected || !state.gameStarted) return false;
  return online.isHost ? state.turn === 0 : state.turn === 1;
}

function getLocalPlayerIndex() {
  return online.isHost ? 0 : 1;
}

function sendOnline(message) {
  if (state.mode !== 'online' || !online.conn || !online.connected) return;
  online.conn.send(message);
}

function serializeSnapshot() {
  return {
    turn: state.turn,
    turnTime: state.turnTime,
    players: state.players,
    objects: state.objects,
    moving: state.moving,
    pendingTurnSwitch: state.pendingTurnSwitch,
    scoredThisTurn: state.scoredThisTurn,
    currentShot: state.currentShot,
    queenCoverPending: state.queenCoverPending,
    lastShotPower: state.lastShotPower,
    gameStarted: state.gameStarted,
  };
}

function applySnapshot(snapshot) {
  if (!snapshot) return;
  state.turn = snapshot.turn;
  state.turnTime = snapshot.turnTime;
  state.players = snapshot.players;
  state.objects = snapshot.objects;
  state.moving = snapshot.moving;
  state.pendingTurnSwitch = snapshot.pendingTurnSwitch;
  state.scoredThisTurn = snapshot.scoredThisTurn;
  state.currentShot = snapshot.currentShot || { ownColorPocketed: 0, opponentColorPocketed: 0 };
  state.queenCoverPending = snapshot.queenCoverPending || null;
  state.lastShotPower = snapshot.lastShotPower;
  state.gameStarted = Boolean(snapshot.gameStarted);
  state.aiming = false;
  state.draggingStriker = false;
  state.aimPoint = null;
  state.shotPower = 0;
}

function broadcastSnapshot(reason='sync') {
  sendOnline({ type: 'snapshot', reason, snapshot: serializeSnapshot() });
}

function attachOnlineConnection(conn) {
  online.conn = conn;
  conn.on('open', () => {
    online.connected = true;
    setOnlineStatus(`接続済み（ルーム: ${online.roomId}）`);
    sendOnline({ type: 'hello', name: state.players[getLocalPlayerIndex()].name });
    if (online.isHost && state.gameStarted) {
      broadcastSnapshot('initial');
    }
    updateStartButtonState();
  });
  conn.on('data', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    if (payload.type === 'hello' && typeof payload.name === 'string' && payload.name.trim()) {
      const remoteIndex = online.isHost ? 1 : 0;
      state.players[remoteIndex].name = payload.name.trim();
      renderPanels();
      return;
    }
    if (payload.type === 'snapshot') {
      applySnapshot(payload.snapshot);
      renderPanels();
      return;
    }
    if (payload.type === 'start-game') {
      startCurrentGame(false);
      return;
    }
    if (payload.type === 'start-request' && online.isHost) {
      startCurrentGame(true);
    }
  });
  conn.on('close', () => {
    online.connected = false;
    setOnlineStatus('相手が切断しました');
    updateStartButtonState();
  });
}

function shutdownOnline() {
  if (online.retryTimer) {
    clearTimeout(online.retryTimer);
    online.retryTimer = null;
  }
  if (online.conn) { try { online.conn.close(); } catch (e) {} }
  if (online.peer) { try { online.peer.destroy(); } catch (e) {} }
  online.conn = null;
  online.peer = null;
  online.connected = false;
  online.roleSelected = null;
  online.retryCount = 0;
  updateStartButtonState();
}

function beginHostSession(hostId) {
  online.isHost = true;
  setOnlineStatus(`マッチング準備中（ルーム: ${online.roomId}）`);
  const hostPeer = new Peer(hostId);
  online.peer = hostPeer;
  hostPeer.on('open', () => {
    online.retryCount = 0;
    setOnlineStatus(`待機中（ルーム: ${online.roomId}）`);
  });
  hostPeer.on('connection', (conn) => {
    if (online.conn && online.conn.open) { conn.close(); return; }
    online.isHost = true;
    attachOnlineConnection(conn);
  });
  hostPeer.on('error', (err) => {
    if (err.type === 'unavailable-id' || err.type === 'invalid-id') {
      try { hostPeer.destroy(); } catch (e) {}
      connectAsGuest(hostId);
      return;
    }
    setOnlineStatus(`接続エラー: ${err.type}`);
  });
}

function scheduleGuestRetry(hostId) {
  if (online.retryCount >= 4) {
    setOnlineStatus('接続エラー: peer-unavailable（再接続上限）');
    return;
  }
  online.retryCount += 1;
  const delay = 800 * online.retryCount;
  setOnlineStatus(`再接続中... (${online.retryCount}/4)`);
  online.retryTimer = setTimeout(() => connectAsGuest(hostId), delay);
}

function connectAsGuest(hostId) {
  online.isHost = false;
  setOnlineStatus(`接続中（ルーム: ${online.roomId}）`);
  const guestPeer = new Peer();
  online.peer = guestPeer;
  guestPeer.on('open', () => {
    const conn = guestPeer.connect(hostId, { reliable: true });
    attachOnlineConnection(conn);
  });
  guestPeer.on('error', (guestErr) => {
    if (guestErr.type === 'peer-unavailable') {
      try { guestPeer.destroy(); } catch (e) {}
      scheduleGuestRetry(hostId);
      return;
    }
    setOnlineStatus(`接続エラー: ${guestErr.type}`);
  });
}

function initOnlineSession(requestedRoomId = '') {
  shutdownOnline();
  if (!window.Peer) {
    setOnlineStatus('PeerJSを読み込めませんでした');
    return;
  }

  const normalizedRoomId = sanitizeRoomId(requestedRoomId || getAutoRoomId());
  online.roleSelected = 'auto';
  online.roomId = normalizedRoomId;

  const hostId = `carrom-room-${online.roomId}`;
  beginHostSession(hostId);
}


function levelConfig() {
  return LEVEL_SETTINGS[state.level] || LEVEL_SETTINGS[1];
}

function saveStats() {
  Object.entries(state.stats).forEach(([k, v]) => localStorage.setItem(k, String(v)));
}

function resetBoard() {
  state.objects = [];
  state.pendingTurnSwitch = false;
  state.pendingRespots = [];
  state.queenCoverPending = null;
  state.currentShot = { ownColorPocketed: 0, opponentColorPocketed: 0 };

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
  state.pendingRespots = [];
  state.scoredThisTurn = false;
  state.queenCoverPending = null;
  state.currentShot = { ownColorPocketed: 0, opponentColorPocketed: 0 };
  state.shotPromptShownThisTurn = false;
  state.draggingStriker = false;
  state.aiShotQueued = false;
  state.gameStarted = false;
  const selectedColor = 'black';
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
  state.players[1].name = 'オンライン接続中...';
  modeLabel.textContent = `モード: ${MODE_NAMES_JA[mode] || mode}`;
  levelLabel.textContent = `ゲームレベル: ${state.level}`;
  resetBoard();
  clearInterval(state.timerRef);
  timerLabel.textContent = `ターンタイマー: ${levelConfig().turnTime}秒`;
  renderPanels();
  updateStartButtonState();

  setOnlineStatus('接続中...');
  initOnlineSession();
}

function startCurrentGame(shouldBroadcast = true) {
  if (!state.mode) return;
  if (state.mode === 'online' && !online.connected) {
    setOnlineStatus('接続が完了してから START GAME を押してください');
    return;
  }
  if (!online.isHost && shouldBroadcast) {
    sendOnline({ type: 'start-request' });
    setOnlineStatus('ホストに開始リクエストを送信しました');
    return;
  }
  state.gameStarted = true;
  state.turn = 0;
  state.pendingTurnSwitch = false;
  state.pendingRespots = [];
  state.scoredThisTurn = false;
  state.queenCoverPending = null;
  state.currentShot = { ownColorPocketed: 0, opponentColorPocketed: 0 };
  state.shotPromptShownThisTurn = false;
  state.aiShotQueued = false;
  resetBoard();
  startTurnTimer();
  renderPanels();
  setOnlineStatus(`対戦開始（あなた: ${online.isHost ? '下側プレイヤー' : '上側プレイヤー'}）`);
  if (shouldBroadcast && online.isHost) sendOnline({ type: 'start-game' });
  broadcastSnapshot('start-game');
  updateStartButtonState();
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
  state.draggingStriker = false;
  state.aimPoint = null;
  state.shotPower = 0;
  state.scoredThisTurn = false;
  state.currentShot = { ownColorPocketed: 0, opponentColorPocketed: 0 };
  state.shotPromptShownThisTurn = false;
  state.aiShotQueued = false;
  placeStrikerForCurrentTurn(true);
}

function getCenterRespotPosition() {
  const centerX = BOARD.w / 2;
  const centerY = BOARD.h / 2;
  const candidates = [
    { x: centerX, y: centerY },
    { x: centerX + COIN_R * 2, y: centerY },
    { x: centerX - COIN_R * 2, y: centerY },
    { x: centerX, y: centerY + COIN_R * 2 },
    { x: centerX, y: centerY - COIN_R * 2 },
  ];

  for (const candidate of candidates) {
    const overlaps = state.objects.some(
      (o) => o.active && Math.hypot(candidate.x - o.x, candidate.y - o.y) < o.r + COIN_R + 1,
    );
    if (!overlaps) return candidate;
  }

  return { x: centerX, y: centerY };
}

function applyPendingRespots() {
  if (!state.pendingRespots.length) return;
  for (const coin of state.pendingRespots) {
    respotCoinAtCenter(coin);
  }
  state.pendingRespots = [];
}

function respotCoinAtCenter(coin) {
  const pos = getCenterRespotPosition();
  coin.vx = 0;
  coin.vy = 0;
  coin.x = pos.x;
  coin.y = pos.y;
  coin.active = true;
}

function advanceTurnAndHandleAutomation() {
  switchTurn();
  broadcastSnapshot('turn');
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
    drawGhostBallGuide(striker, state.aimPoint);
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

    const meterHeight = 90;
    const meterWidth = 12;
    const meterX = boxX + 106;
    const meterY = boxY - 4;
    ctx.fillStyle = '#132437cc';
    ctx.fillRect(meterX, meterY, meterWidth, meterHeight);
    const fillHeight =
      (Math.max(0, Math.min(MAX_SHOT_POWER_PERCENT, state.shotPower)) / MAX_SHOT_POWER_PERCENT) * meterHeight;
    ctx.fillStyle = '#22d3ee';
    ctx.fillRect(meterX, meterY + meterHeight - fillHeight, meterWidth, fillHeight);
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

function drawArrow(from, to, color, width = 2.4) {
  const headLength = 14;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return;
  const ux = dx / distance;
  const uy = dy / distance;
  const baseX = to.x - ux * headLength;
  const baseY = to.y - uy * headLength;

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(baseX, baseY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(baseX - uy * (headLength * 0.45), baseY + ux * (headLength * 0.45));
  ctx.lineTo(baseX + uy * (headLength * 0.45), baseY - ux * (headLength * 0.45));
  ctx.closePath();
  ctx.fill();
}

function drawGuideLabel(text, x, y, color) {
  ctx.font = 'bold 16px Inter, system-ui, Arial';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(x - 5, y - 15, ctx.measureText(text).width + 10, 20);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawGhostBallGuide(striker, aimPoint) {
  const dir = normalize(striker.x - aimPoint.x, striker.y - aimPoint.y);
  if (!dir) return;
  const coinHit = firstCoinContact(striker, dir);
  const wallHit = timeToBoundary(striker, dir);
  if (!coinHit) return;
  if (wallHit && wallHit.t < coinHit.t) return;

  const ghostCenter = {
    x: striker.x + dir.x * coinHit.t,
    y: striker.y + dir.y * coinHit.t,
  };
  const targetCoin = coinHit.coin;
  const lineCentersDir = normalize(targetCoin.x - ghostCenter.x, targetCoin.y - ghostCenter.y);
  if (!lineCentersDir) return;

  const contactPoint = {
    x: targetCoin.x - lineCentersDir.x * targetCoin.r,
    y: targetCoin.y - lineCentersDir.y * targetCoin.r,
  };
  const lineCentersStart = {
    x: ghostCenter.x - lineCentersDir.x * 32,
    y: ghostCenter.y - lineCentersDir.y * 32,
  };
  const targetDirectionEnd = {
    x: targetCoin.x + lineCentersDir.x * 150,
    y: targetCoin.y + lineCentersDir.y * 150,
  };
  const lineAimEnd = {
    x: ghostCenter.x + dir.x * 210,
    y: ghostCenter.y + dir.y * 210,
  };
  const lineAimStart = {
    x: ghostCenter.x - dir.x * 55,
    y: ghostCenter.y - dir.y * 55,
  };

  ctx.save();
  ctx.strokeStyle = 'rgba(120, 120, 120, 0.6)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.arc(ghostCenter.x, ghostCenter.y, striker.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  drawDashedSegment(lineCentersStart, targetCoin, '#00bf6f', [5, 5], 2.1);
  drawDashedSegment(lineAimStart, lineAimEnd, '#249dff', [7, 5], 2.4);
  drawArrow(targetCoin, targetDirectionEnd, '#2d2d2d', 2.8);

  ctx.fillStyle = '#e53935';
  ctx.beginPath();
  ctx.arc(contactPoint.x, contactPoint.y, 4.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#00bf6f';
  ctx.beginPath();
  ctx.arc(ghostCenter.x, ghostCenter.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(targetCoin.x, targetCoin.y, 4, 0, Math.PI * 2);
  ctx.fill();

  drawGuideLabel('line of centers', ghostCenter.x - 120, ghostCenter.y - 72, '#00bf6f');
  drawGuideLabel('imaginary ball (GB)', ghostCenter.x - 60, ghostCenter.y - striker.r - 16, '#444');
  drawGuideLabel('contact point', contactPoint.x + 8, contactPoint.y - 8, '#ff4a4a');
  drawGuideLabel('line of aim', lineAimEnd.x + 8, lineAimEnd.y + 4, '#249dff');
  drawGuideLabel('target direction', targetDirectionEnd.x + 8, targetDirectionEnd.y + 3, '#2d2d2d');
  ctx.restore();
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

    // Keep every object inside the board border at all times (including around pockets).
    o.x = Math.max(PLAYFIELD_MIN + o.r, Math.min(PLAYFIELD_MAX_X - o.r, o.x));
    o.y = Math.max(PLAYFIELD_MIN + o.r, Math.min(PLAYFIELD_MAX_Y - o.r, o.y));
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
    applyPendingRespots();
    if (state.pendingTurnSwitch) {
      if (state.scoredThisTurn) {
        resolveQueenCoverAfterShot();
        state.turnTime = levelConfig().turnTime;
        state.aiming = false;
        state.draggingStriker = false;
        state.aimPoint = null;
        state.shotPower = 0;
        state.scoredThisTurn = false;
        state.shotPromptShownThisTurn = false;
        placeStrikerForCurrentTurn(true);
      } else {
        advanceTurnAndHandleAutomation();
      }
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
        if (isQueen) {
          const canPocketQueen = current.score >= 1;
          if (!canPocketQueen) {
            queueRespotCoin(o);
            break;
          }
          o.active = false;
          pocketedThisTurn += 1;
          state.scoredThisTurn = true;
          state.queenCoverPending = { playerIndex: state.turn, coverAttemptStarted: false };
        } else if (isOwnColor) {
          o.active = false;
          pocketedThisTurn += 1;
          state.scoredThisTurn = true;
          state.currentShot.ownColorPocketed += 1;
          current.score += 1;
          current.colorPocketed += 1;
        } else {
          state.currentShot.opponentColorPocketed += 1;
          queueRespotCoin(o);
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

function queueRespotCoin(coin) {
  respotCoinAtCenter(coin);
}

function respotQueenAtCenter() {
  const queen = state.objects.find((o) => o.type === 'queen');
  if (!queen) return;
  respotCoinAtCenter(queen);
}

function resolveQueenCoverAfterShot() {
  const queenCover = state.queenCoverPending;
  if (!queenCover) return;
  if (queenCover.playerIndex !== state.turn) return;
  if (!queenCover.coverAttemptStarted) return;

  const currentPlayer = state.players[state.turn];
  const coveredWithOwnColor = state.currentShot.ownColorPocketed > 0;
  const pocketedOpponentColor = state.currentShot.opponentColorPocketed > 0;

  if (coveredWithOwnColor && !pocketedOpponentColor) {
    currentPlayer.score += 5;
    currentPlayer.queenPocketed += 1;
  } else {
    respotQueenAtCenter();
  }
  state.queenCoverPending = null;
  evaluateWin();
}

function evaluateWin() {
  if (state.queenCoverPending && state.queenCoverPending.playerIndex === state.turn) return;

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
    state.draggingStriker = false;
    state.aimPoint = null;
    state.shotPower = 0;
    state.lastShotPower = 0;
    state.scoredThisTurn = false;
    state.shotPromptShownThisTurn = false;
    state.players.forEach((player) => {
      player.score = 0;
      player.colorPocketed = 0;
      player.queenPocketed = 0;
    });
    resetBoard();
    startTurnTimer();
    renderPanels();
    broadcastSnapshot('reset');
  }, 150);
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
  updateStartButtonState();
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
  if (state.wasMoving && !state.moving) broadcastSnapshot('settled');
  state.wasMoving = state.moving;
  renderPanels();
  requestAnimationFrame(loop);
}

function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const rawX = ((e.clientX - rect.left) * BOARD.w) / rect.width;
  const rawY = ((e.clientY - rect.top) * BOARD.h) / rect.height;
  return {
    x: Math.min(BOARD.w + EXTRA_AIM_DRAG_SPACE, Math.max(-EXTRA_AIM_DRAG_SPACE, rawX)),
    y: Math.min(BOARD.h + EXTRA_AIM_DRAG_SPACE, Math.max(-EXTRA_AIM_DRAG_SPACE, rawY)),
  };
}

function calculateShotPowerPercent(striker, aimPoint) {
  const dragDistance = Math.hypot(striker.x - aimPoint.x, striker.y - aimPoint.y);
  return Math.min(MAX_SHOT_POWER_PERCENT, (dragDistance / MAX_SHOT_DRAG_DISTANCE) * MAX_SHOT_POWER_PERCENT);
}

function releaseShot() {
  if (state.draggingStriker && !state.aiming) {
    state.draggingStriker = false;
    return;
  }
  if (!state.aiming || state.moving || !state.gameStarted) return;
  const striker = state.objects.find((o) => o.type === 'striker');
  const dx = striker.x - state.aimPoint.x;
  const dy = striker.y - state.aimPoint.y;
  const d = Math.max(1, Math.hypot(dx, dy));
  const shotPowerPercent = calculateShotPowerPercent(striker, state.aimPoint);
  const pwr = (shotPowerPercent / MAX_SHOT_POWER_PERCENT) * MAX_STRIKER_SHOT_SPEED;
  striker.vx = (dx / d) * pwr;
  striker.vy = (dy / d) * pwr;
  state.lastShotPower = pwr;
  state.currentShot = {
    ownColorPocketed: 0,
    opponentColorPocketed: 0,
  };
  if (state.queenCoverPending && state.queenCoverPending.playerIndex === state.turn) {
    state.queenCoverPending.coverAttemptStarted = true;
  }
  state.pendingTurnSwitch = true;
  state.scoredThisTurn = false;
  state.aiming = false;
  state.aimPoint = null;
  state.shotPower = 0;
  state.moving = true;
  if (state.mode === 'online') broadcastSnapshot('shot');
}

function startInteraction(pointer) {
  if (state.moving || !state.mode || !state.gameStarted) return;
  if (!isMyOnlineTurn()) return;
  const { x, y } = getCanvasCoords(pointer);
  const striker = state.objects.find((o) => o.type === 'striker');
  const lineY = currentStrikerLineY();

  if (Math.hypot(x - striker.x, y - striker.y) <= striker.r + 8) {
    if (Math.abs(striker.y - lineY) <= 1 && Math.abs(y - lineY) <= 24) {
      state.draggingStriker = true;
    } else {
      state.aiming = true;
      state.aimPoint = { x, y };
      state.shotPower = calculateShotPowerPercent(striker, state.aimPoint);
    }
    return;
  }

  if (Math.abs(y - lineY) <= 18) {
    striker.x = clampStrikerX(x);
    striker.y = lineY;
    state.draggingStriker = true;
    return;
  }
}

function updateAimFromPointer(e) {
  const { x, y } = getCanvasCoords(e);
  const striker = state.objects.find((o) => o.type === 'striker');
  if (state.draggingStriker && !state.aiming) {
    striker.x = clampStrikerX(x);
    striker.y = currentStrikerLineY();
    return;
  }
  if (!state.aiming) return;
  state.aimPoint = { x, y };
  state.shotPower = calculateShotPowerPercent(striker, state.aimPoint);
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  startInteraction(e);
});
canvas.addEventListener('pointermove', updateAimFromPointer);
window.addEventListener('pointermove', updateAimFromPointer);
canvas.addEventListener('pointerup', releaseShot);
window.addEventListener('pointerup', releaseShot);
window.addEventListener('pointercancel', releaseShot);
window.addEventListener('blur', () => {
  state.draggingStriker = false;
  state.aiming = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());


canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
}, { passive: false });

saveProfileBtn.addEventListener('click', () => {
  state.players[0].name = usernameInput.value.trim() || 'プレイヤー1';
  localStorage.setItem('carromDeviceName', state.players[0].name);
  alert('プロフィールをローカルに保存しました。');
  renderPanels();
  sendOnline({ type: 'hello', name: state.players[getLocalPlayerIndex()].name });
});

themeSelect.addEventListener('change', () => {
  document.body.classList.remove('theme-night', 'theme-mint');
  if (themeSelect.value === 'night') document.body.classList.add('theme-night');
  if (themeSelect.value === 'mint') document.body.classList.add('theme-mint');
});

levelSelect.addEventListener('change', () => {
  levelLabel.textContent = `ゲームレベル: ${Number(levelSelect.value) || 1}`;
});

copyInviteBtn?.addEventListener('click', async () => {
  const inviteUrl = buildShareUrl();
  try {
    await navigator.clipboard.writeText(inviteUrl);
    setOnlineStatus('このURLをコピーしました');
  } catch (e) {
    setOnlineStatus(`URL: ${inviteUrl}`);
  }
});

startGameBtn?.addEventListener('click', () => {
  startCurrentGame(true);
});

usernameInput.value = localStorage.getItem('carromDeviceName') || `${(navigator.userAgentData?.platform || navigator.platform || 'PC')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
localStorage.setItem('carromDeviceName', usernameInput.value);

resetBoard();
levelLabel.textContent = `ゲームレベル: ${state.level}`;
renderPanels();
loop();

const params = new URLSearchParams(window.location.search);
if (!params.get('room')) params.set('room', getAutoRoomId());
const nextUrl = `${window.location.pathname}?${params.toString()}`;
window.history.replaceState({}, '', nextUrl);
initMode('online');
