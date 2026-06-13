const VIEW = {
  width: 720,
  height: 420,
};

// Change this one value to recolor the whole game.
const GAME_BACKGROUND = "#111214";
const LEADERBOARD_API = {
  proxyBase: "https://nightskydino-dreamlo-proxy.hellocomedu.workers.dev",
  leaderboardSize: 10,
};
const GROUND_Y = 320;
const BASE_SPEED = 420;
const MAX_SPEED = 1120;
const SCORE_PER_SECOND = 10;
const SPEED_PER_SCORE = 2.05;
const MAX_JUMPS = Infinity;
const STORAGE_KEY = "dino-run-best";
const PLAYER_NAME_KEY = "dino-run-player-name";
const SPRITE_SHEET_SRC = "assets/chrome-dino-sprites.png";
const SPRITES = {
  dinoJump: { x: 1338, y: 0, w: 88, h: 94 },
  dinoRunA: { x: 1514, y: 0, w: 88, h: 94 },
  dinoRunB: { x: 1602, y: 0, w: 88, h: 94 },
  cactusSmallA: { x: 446, y: 2, w: 34, h: 70 },
  cactusSmallB: { x: 548, y: 2, w: 34, h: 70 },
  cactusBigA: { x: 652, y: 2, w: 49, h: 100 },
  cactusBigB: { x: 802, y: 2, w: 49, h: 100 },
};

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlayTitle");
const overlayText = document.getElementById("overlayText");
const leaderboardPanel = document.getElementById("leaderboard");
const leaderboardList = document.getElementById("leaderboardList");
const nameForm = document.getElementById("nameForm");
const playerNameInput = document.getElementById("playerName");
const restartButton = document.getElementById("restart");
const spriteSheet = new Image();

let spriteSheetReady = false;

ctx.imageSmoothingEnabled = false;

spriteSheet.onload = () => {
  spriteSheetReady = true;
};

spriteSheet.onerror = () => {
  spriteSheetReady = false;
};

spriteSheet.src = SPRITE_SHEET_SRC;
applyGameTheme();

let renderScale = 1;
let renderOffsetX = 0;
let renderOffsetY = 0;
let lastTime = 0;

const state = {
  running: false,
  gameOver: false,
  score: 0,
  best: loadBest(),
  speed: BASE_SPEED,
  spawnTimer: 0.5,
  groundOffset: 0,
  clouds: createClouds(),
  obstacles: [],
  leaderboard: {
    finalScore: 0,
    entries: [],
    loading: false,
    submitting: false,
    qualifies: false,
    saved: false,
    error: "",
    requestToken: 0,
  },
  dino: {
    x: 86,
    y: GROUND_Y - 94,
    w: 89,
    h: 94,
    vy: 0,
    onGround: true,
    jumpCount: 0,
    frame: 0,
    anim: 0,
  },
  flash: 0,
};

function random(min, max) {
  return min + Math.random() * (max - min);
}

function hexToRgba(hex, alpha) {
  const normalized = hex.replace("#", "");
  const expanded = normalized.length === 3
    ? normalized
        .split("")
        .map((part) => part + part)
        .join("")
    : normalized;
  const value = Number.parseInt(expanded, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function applyGameTheme() {
  document.documentElement.style.setProperty("--game-bg", GAME_BACKGROUND);
  document.documentElement.style.setProperty("--game-bg-soft", hexToRgba(GAME_BACKGROUND, 0.78));
}

function loadBest() {
  try {
    return Number(localStorage.getItem(STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Ignore storage failures in private or restricted contexts.
  }
}

function loadPlayerName() {
  try {
    return localStorage.getItem(PLAYER_NAME_KEY) || "";
  } catch {
    return "";
  }
}

function savePlayerName(name) {
  try {
    localStorage.setItem(PLAYER_NAME_KEY, name);
  } catch {
    // Ignore storage failures in private or restricted contexts.
  }
}

function sanitizePlayerName(name) {
  return name.replace(/\*/g, "_").trim().replace(/\s+/g, " ").slice(0, 16);
}

function buildLeaderboardApiUrl(path) {
  return `${LEADERBOARD_API.proxyBase}${path}`;
}

async function readLeaderboardApi(path) {
  const response = await fetch(buildLeaderboardApiUrl(path), { cache: "no-store" });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Leaderboard request failed: ${response.status} ${response.statusText}`);
  }

  if (body.startsWith("ERROR:")) {
    throw new Error(body);
  }

  return body;
}

function parseLeaderboardEntries(payload) {
  const leaderboard = payload?.dreamlo?.leaderboard;
  if (!leaderboard || !leaderboard.entry) {
    return [];
  }

  const entries = Array.isArray(leaderboard.entry) ? leaderboard.entry : [leaderboard.entry];
  return entries.map((entry, index) => ({
    rank: index + 1,
    name: String(entry.name ?? ""),
    score: Number(entry.score ?? 0),
    seconds: Number(entry.seconds ?? 0),
    text: String(entry.text ?? ""),
    date: String(entry.date ?? ""),
  }));
}

function formatScore(value) {
  return Number.isFinite(value) ? String(Math.max(0, Math.floor(value))) : "0";
}

function getVisibleLeaderboardEntries(entries) {
  return entries.slice(0, LEADERBOARD_API.leaderboardSize);
}

function qualifiesForTopTen(entries, finalScore) {
  if (entries.length < LEADERBOARD_API.leaderboardSize) {
    return true;
  }

  const threshold = entries[LEADERBOARD_API.leaderboardSize - 1]?.score ?? -Infinity;
  return finalScore >= threshold;
}

async function fetchLeaderboard(limit = LEADERBOARD_API.leaderboardSize) {
  const body = await readLeaderboardApi(`/leaderboard?limit=${limit}`);
  return parseLeaderboardEntries(JSON.parse(body));
}

async function submitLeaderboardScore(name, score) {
  const safeName = sanitizePlayerName(name);
  const value = Math.max(0, Math.floor(score));
  const body = await readLeaderboardApi(`/submit?name=${encodeURIComponent(safeName)}&score=${value}`);

  if (body !== "OK") {
    throw new Error(body || "Leaderboard write failed.");
  }
}

function renderLeaderboard(entries) {
  leaderboardList.replaceChildren();
  const visibleEntries = getVisibleLeaderboardEntries(entries);

  if (!visibleEntries.length) {
    const empty = document.createElement("li");
    empty.className = "leaderboard__empty";
    if (state.leaderboard.loading) {
      empty.textContent = "Loading leaderboard...";
    } else if (state.leaderboard.error) {
      empty.textContent = state.leaderboard.error;
    } else {
      empty.textContent = "No scores yet.";
    }
    leaderboardList.append(empty);
    return;
  }

  for (const entry of visibleEntries) {
    const item = document.createElement("li");
    item.className = "leaderboard__row";

    const rank = document.createElement("span");
    rank.className = "leaderboard__rank";
    rank.textContent = `#${entry.rank}`;

    const name = document.createElement("span");
    name.className = "leaderboard__name";
    name.textContent = entry.name || "Anonymous";

    const score = document.createElement("span");
    score.className = "leaderboard__score";
    score.textContent = formatScore(entry.score);

    item.append(rank, name, score);
    leaderboardList.append(item);
  }
}

function setLeaderboardFormVisible(visible) {
  nameForm.hidden = !visible;
}

function setLeaderboardSubmitting(submitting) {
  state.leaderboard.submitting = submitting;
  playerNameInput.disabled = submitting;
  restartButton.disabled = submitting;

  const submitButton = nameForm.querySelector("button[type='submit']");
  if (submitButton) {
    submitButton.disabled = submitting;
    submitButton.textContent = submitting ? "Saving..." : "Save Score";
  }
}

function setGameOverUi(title, text) {
  setOverlay(true, title, text);
}

async function showStartLeaderboard() {
  const requestToken = ++state.leaderboard.requestToken;
  state.leaderboard.loading = true;
  state.leaderboard.submitting = false;
  state.leaderboard.qualifies = false;
  state.leaderboard.saved = false;
  state.leaderboard.error = "";

  leaderboardPanel.hidden = false;
  setLeaderboardFormVisible(false);
  renderLeaderboard([]);

  try {
    const entries = await fetchLeaderboard();
    if (requestToken !== state.leaderboard.requestToken) {
      return;
    }

    state.leaderboard.loading = false;
    const visibleEntries = getVisibleLeaderboardEntries(entries);
    state.leaderboard.entries = visibleEntries;
    renderLeaderboard(visibleEntries);
  } catch (error) {
    if (requestToken !== state.leaderboard.requestToken) {
      return;
    }

    state.leaderboard.loading = false;
    state.leaderboard.error = error instanceof Error ? error.message : String(error);
    renderLeaderboard([]);
  } finally {
    if (requestToken !== state.leaderboard.requestToken) {
      return;
    }

    state.leaderboard.loading = false;
  }
}

async function handleLeaderboardSubmit(event) {
  event.preventDefault();

  if (!state.leaderboard.qualifies || state.leaderboard.loading || state.leaderboard.submitting) {
    return;
  }

  const requestToken = state.leaderboard.requestToken;
  const name = sanitizePlayerName(playerNameInput.value);
  if (!name) {
    setGameOverUi("Game Over", "Enter a name before saving the score.");
    playerNameInput.focus({ preventScroll: true });
    return;
  }

  setLeaderboardSubmitting(true);
  setGameOverUi("Game Over", `Saving ${name}'s score...`);

  try {
    await submitLeaderboardScore(name, state.leaderboard.finalScore);
    if (requestToken !== state.leaderboard.requestToken) {
      return;
    }

    savePlayerName(name);
    state.leaderboard.saved = true;
    const entries = await fetchLeaderboard();
    if (requestToken !== state.leaderboard.requestToken) {
      return;
    }

    state.leaderboard.loading = false;
    const visibleEntries = getVisibleLeaderboardEntries(entries);
    state.leaderboard.entries = visibleEntries;
    renderLeaderboard(visibleEntries);
    setLeaderboardFormVisible(false);
    setGameOverUi("Game Over", "Score saved. The updated top 10 is shown below.");
  } catch (error) {
    if (requestToken !== state.leaderboard.requestToken) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    state.leaderboard.error = message;
    setGameOverUi("Game Over", `Could not save the score. ${message}`);
  } finally {
    if (requestToken !== state.leaderboard.requestToken) {
      return;
    }

    setLeaderboardSubmitting(false);
    restartButton.hidden = false;
  }
}

async function showLeaderboardAfterGame(finalScore) {
  const requestToken = ++state.leaderboard.requestToken;
  state.leaderboard.finalScore = finalScore;
  state.leaderboard.loading = true;
  state.leaderboard.submitting = false;
  state.leaderboard.saved = false;
  state.leaderboard.qualifies = false;
  state.leaderboard.error = "";

  restartButton.hidden = true;
  setLeaderboardFormVisible(false);
  leaderboardPanel.hidden = false;
  setGameOverUi("Game Over", `Your score: ${finalScore}. Loading leaderboard...`);
  renderLeaderboard([]);

  try {
    const entries = await fetchLeaderboard();
    if (requestToken !== state.leaderboard.requestToken) {
      return;
    }

    state.leaderboard.loading = false;
    const visibleEntries = getVisibleLeaderboardEntries(entries);
    state.leaderboard.entries = visibleEntries;
    renderLeaderboard(visibleEntries);

    const qualifies = qualifiesForTopTen(visibleEntries, finalScore);

    state.leaderboard.qualifies = qualifies;
    restartButton.hidden = false;

    if (qualifies) {
      setGameOverUi("Game Over", `Your score: ${finalScore}. Enter a name to save a top 10 score.`);
      setLeaderboardFormVisible(true);
      playerNameInput.value = loadPlayerName();
      playerNameInput.focus({ preventScroll: true });
      playerNameInput.select();
    } else {
      setGameOverUi("Game Over", `Your score: ${finalScore}. Top 10 leaderboard shown below.`);
    }
  } catch (error) {
    if (requestToken !== state.leaderboard.requestToken) {
      return;
    }

    state.leaderboard.loading = false;
    state.leaderboard.error = error instanceof Error ? error.message : String(error);
    restartButton.hidden = false;
    setGameOverUi("Game Over", `Your score: ${finalScore}. Leaderboard is unavailable right now.`);
    renderLeaderboard([]);
  } finally {
    if (requestToken !== state.leaderboard.requestToken) {
      return;
    }

    state.leaderboard.loading = false;
  }
}

function createClouds() {
  return [];
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));

  renderScale = Math.min(canvas.width / VIEW.width, canvas.height / VIEW.height);
  renderOffsetX = (canvas.width - VIEW.width * renderScale) / 2;
  renderOffsetY = (canvas.height - VIEW.height * renderScale) / 2;
}

function resetGame() {
  state.running = false;
  state.gameOver = false;
  state.score = 0;
  state.speed = BASE_SPEED;
  state.spawnTimer = 0.5;
  state.groundOffset = 0;
  state.flash = 0;
  state.obstacles = [];
  state.clouds = createClouds();
  state.leaderboard.finalScore = 0;
  state.leaderboard.entries = [];
  state.leaderboard.loading = false;
  state.leaderboard.submitting = false;
  state.leaderboard.qualifies = false;
  state.leaderboard.saved = false;
  state.leaderboard.error = "";
  state.leaderboard.requestToken += 1;
  state.dino.y = GROUND_Y - state.dino.h;
  state.dino.vy = 0;
  state.dino.onGround = true;
  state.dino.jumpCount = 0;
  state.dino.frame = 0;
  state.dino.anim = 0;
  leaderboardPanel.hidden = true;
  setLeaderboardFormVisible(false);
  restartButton.hidden = true;
  setOverlay(true, "Press Space to Start", "Space, Arrow Up, click, or tap to jump. You can keep jumping in the air.");
  updateHud();
}

function startGame() {
  state.running = true;
  state.gameOver = false;
  setOverlay(false);
}

function restartGame() {
  resetGame();
  startGame();
}

function setOverlay(visible, title = "", text = "") {
  overlay.classList.toggle("visible", visible);

  if (title) {
    overlayTitle.textContent = title;
  }

  if (text) {
    overlayText.textContent = text;
  }
}

function updateHud() {
  scoreEl.textContent = String(Math.floor(state.score));
  bestEl.textContent = String(state.best);
}

function jump() {
  state.dino.vy = -900;
  state.dino.onGround = false;
  state.dino.jumpCount += 1;
  state.dino.frame = 0;

  if (!state.running && !state.gameOver) {
    startGame();
  }
}

function spawnObstacle() {
  const difficulty = Math.min(1, state.score / 450);
  const isBig = Math.random() < Math.min(0.6, 0.35 + difficulty * 0.18);
  const maxScale = state.score < 120 ? 2 : 3;
  const scale = 1 + Math.floor(Math.random() * maxScale);
  const variant = Math.random() > 0.5 ? 1 : 0;
  const base = isBig
    ? (variant ? SPRITES.cactusBigB : SPRITES.cactusBigA)
    : (variant ? SPRITES.cactusSmallB : SPRITES.cactusSmallA);
  const width = base.w * scale;
  const height = base.h;

  state.obstacles.push({
    x: VIEW.width + random(20, 56),
    y: GROUND_Y - height,
    w: width,
    h: height,
    scale,
    variant,
    base,
    isBig,
    passed: false,
  });

  state.spawnTimer = random(0.35, 0.75);
}

function hitTest(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function getDinoHitbox() {
  return {
    x: state.dino.x + 9,
    y: state.dino.y + 12,
    w: 70,
    h: 75,
  };
}

function getObstacleHitbox(obstacle) {
  return {
    x: obstacle.x + 2,
    y: obstacle.y + 2,
    w: obstacle.w - 4,
    h: obstacle.h - 4,
  };
}

function endGame() {
  state.running = false;
  state.gameOver = true;
  state.flash = 0.18;

  const finalScore = Math.floor(state.score);
  if (finalScore > state.best) {
    state.best = finalScore;
    saveBest(state.best);
  }

  updateHud();
  void showLeaderboardAfterGame(finalScore);
}

function update(dt) {
  state.flash = Math.max(0, state.flash - dt);

  if (state.running) {
    state.score += dt * SCORE_PER_SECOND;
    state.speed = Math.min(MAX_SPEED, BASE_SPEED + state.score * SPEED_PER_SCORE);

    if (state.obstacles.length === 0) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) {
        spawnObstacle();
      }
    }

    state.groundOffset = (state.groundOffset + state.speed * dt) % 36;

    for (const obstacle of state.obstacles) {
      obstacle.x -= state.speed * dt;
    }

    state.obstacles = state.obstacles.filter((obstacle) => obstacle.x + obstacle.w > -40);

    state.dino.anim += dt * 10;
    state.dino.frame = Math.floor(state.dino.anim) % 2;

    state.dino.vy += 2400 * dt;
    state.dino.y += state.dino.vy * dt;

    const floorY = GROUND_Y - state.dino.h;
    if (state.dino.y >= floorY) {
      state.dino.y = floorY;
      state.dino.vy = 0;
      state.dino.onGround = true;
      state.dino.jumpCount = 0;
    } else {
      state.dino.onGround = false;
    }

    const dinoBox = getDinoHitbox();
    for (const obstacle of state.obstacles) {
      if (hitTest(dinoBox, getObstacleHitbox(obstacle))) {
        endGame();
        break;
      }
    }
  } else {
    state.groundOffset = (state.groundOffset + 40 * dt) % 36;
    state.dino.anim += dt * 4;
    state.dino.frame = Math.floor(state.dino.anim) % 2;
    state.dino.y = GROUND_Y - state.dino.h + Math.sin(state.dino.anim * 2.1) * 1.2;
  }

  const currentScore = Math.floor(state.score);
  if (currentScore > state.best) {
    state.best = currentScore;
    saveBest(state.best);
  }

  updateHud();
}

function drawCloud(cloud) {
  ctx.save();
  ctx.translate(cloud.x, cloud.y);
  ctx.scale(cloud.w / 54, cloud.w / 54);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 6);
  ctx.quadraticCurveTo(3, 0, 8, 2);
  ctx.quadraticCurveTo(11, -4, 17, -2);
  ctx.quadraticCurveTo(22, -6, 27, 0);
  ctx.quadraticCurveTo(31, -1, 34, 5);
  ctx.quadraticCurveTo(30, 9, 18, 8);
  ctx.quadraticCurveTo(11, 11, 5, 8);
  ctx.quadraticCurveTo(2, 8, 0, 6);
  ctx.stroke();

  ctx.restore();
}

function drawBackground() {
  ctx.fillStyle = GAME_BACKGROUND;
  ctx.fillRect(0, 0, VIEW.width, VIEW.height);

  for (const cloud of state.clouds) {
    drawCloud(cloud);
  }
}

function drawGround() {
  ctx.strokeStyle = "rgba(255, 255, 255, 0.34)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y + 0.5);
  ctx.lineTo(VIEW.width, GROUND_Y + 0.5);
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
  for (let x = -state.groundOffset; x < VIEW.width + 24; x += 22) {
    ctx.fillRect(x, GROUND_Y + 2, 1, 1);
    ctx.fillRect(x + 9, GROUND_Y + 1, 1, 1);
    ctx.fillRect(x + 16, GROUND_Y + 3, 1, 1);
  }

  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.beginPath();
  ctx.moveTo(VIEW.width * 0.44, GROUND_Y + 0.5);
  ctx.quadraticCurveTo(VIEW.width * 0.46, GROUND_Y - 2, VIEW.width * 0.48, GROUND_Y + 0.5);
  ctx.quadraticCurveTo(VIEW.width * 0.50, GROUND_Y + 2, VIEW.width * 0.52, GROUND_Y + 0.5);
  ctx.stroke();
}

function drawCactus(obstacle) {
  const { x, y, w, h, base } = obstacle;

  if (spriteSheetReady) {
    ctx.drawImage(spriteSheet, base.x, base.y, base.w, base.h, x, y, w, h);
    return;
  }

  // Fallback to a simplified cactus if the sprite sheet fails to load.
  ctx.fillStyle = "#909090";
  ctx.fillRect(x + w * 0.42, y, w * 0.16, h);
  ctx.fillRect(x + w * 0.18, y + h * 0.18, w * 0.12, h * 0.38);
  ctx.fillRect(x + w * 0.70, y + h * 0.30, w * 0.12, h * 0.30);
  ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
  ctx.fillRect(x + w * 0.48, y + 2, w * 0.04, h - 4);
}

function drawDino() {
  const x = Math.round(state.dino.x);
  const y = Math.round(state.dino.y);
  const source = state.dino.onGround
    ? (state.dino.frame === 1 ? SPRITES.dinoRunB : SPRITES.dinoRunA)
    : SPRITES.dinoJump;

  if (spriteSheetReady) {
    ctx.drawImage(spriteSheet, source.x, source.y, source.w, source.h, x, y, state.dino.w, state.dino.h);
    return;
  }

  // Fallback to a simplified, blocky dinosaur if the sprite sheet fails to load.
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#d6d6d6";
  ctx.fillRect(18, 10, 28, 18);
  ctx.fillRect(36, 4, 22, 16);
  ctx.fillRect(54, 0, 12, 18);
  ctx.fillRect(10, 22, 12, 10);
  ctx.fillRect(26, 28, 10, 12);
  ctx.fillRect(38, 32, 10, 28);
  ctx.fillRect(20, 40, 10, 20);
  ctx.fillStyle = "#f7f7f7";
  ctx.fillRect(58, 6, 3, 3);
  ctx.restore();
}

function drawScore() {
  ctx.save();
  ctx.fillStyle = "#f1f1f1";
  ctx.font = "700 18px monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  const scoreText = String(Math.floor(state.score)).padStart(5, "0");
  ctx.fillText(scoreText, VIEW.width - 24, 24);
  ctx.restore();
}

function drawFlash() {
  if (state.flash <= 0) {
    return;
  }

  ctx.fillStyle = `rgba(255, 100, 90, ${state.flash})`;
  ctx.fillRect(0, 0, VIEW.width, VIEW.height);
}

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = GAME_BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.setTransform(renderScale, 0, 0, renderScale, renderOffsetX, renderOffsetY);

  drawBackground();
  drawGround();

  for (const obstacle of state.obstacles) {
    drawCactus(obstacle);
  }

  drawDino();
  drawFlash();
  drawScore();
}

function loop(timestamp) {
  if (!lastTime) {
    lastTime = timestamp;
  }

  const delta = Math.min(0.033, (timestamp - lastTime) / 1000);
  lastTime = timestamp;

  update(delta);
  draw();

  requestAnimationFrame(loop);
}

function isTypingInInput() {
  const active = document.activeElement;
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active?.isContentEditable;
}

function handleKeydown(event) {
  if (event.repeat) {
    return;
  }

  if (isTypingInInput()) {
    return;
  }

  if (event.code === "Space" || event.code === "ArrowUp" || event.code === "KeyW") {
    event.preventDefault();

    if (state.gameOver) {
      if (
        state.leaderboard.loading ||
        (state.leaderboard.qualifies && !state.leaderboard.saved && !state.leaderboard.error)
      ) {
        return;
      }

      if (!state.leaderboard.qualifies || state.leaderboard.saved || state.leaderboard.error) {
        restartGame();
      }
      return;
    }

    if (!state.running) {
      startGame();
    }

    jump();
  }
}

overlay.addEventListener("pointerdown", (event) => {
  const target = event.target;
  if (target instanceof Element && target.closest("button, input, textarea, select, option, form, a")) {
    return;
  }

  if (state.gameOver) {
    return;
  }

  if (!state.running) {
    startGame();
    jump();
  }
});

canvas.addEventListener("pointerdown", () => {
  if (state.gameOver) {
    restartGame();
    return;
  }

  if (!state.running) {
    startGame();
  }

  jump();
});

restartButton.addEventListener("click", () => {
  if (state.leaderboard.submitting) {
    return;
  }

  restartGame();
});

nameForm.addEventListener("submit", handleLeaderboardSubmit);

window.addEventListener("keydown", handleKeydown);
window.addEventListener("resize", resizeCanvas);
document.addEventListener("visibilitychange", () => {
  lastTime = 0;
});

resizeCanvas();
resetGame();
void showStartLeaderboard();
requestAnimationFrame(loop);
