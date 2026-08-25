// ============================================================
// Brick By Break — popup controller
//
// The service worker (background.js) is the single source of
// truth for timer state and XP. This file renders that state
// and sends intents; it never awards XP on its own, so nothing
// is lost or double counted when the popup closes.
// ============================================================

// --- CONSTANTS ---
const SHORT_BREAK_SECONDS = 5 * 60;
const LONG_BREAK_SECONDS = 15 * 60;
const SECONDS_PER_XP = 10; // must match background.js
const BREAK_ACTION_XP = 5;
const SESSIONS_PER_LONG_BREAK = 4;
const DEFAULT_CANVAS_URL = "https://canvas.ucsc.edu";
const MAX_TASKS = 6;

const SESSION_LABELS = {
  focus: "Focus",
  "short-break": "Short break",
  "long-break": "Long break",
};

// City tile colors — kept in sync with cit.js
const TILE_COLORS = {
  1: "#6b7280", // road
  2: "#22c55e", // residential
  3: "#60a5fa", // commercial
  4: "#f59e0b", // industrial
  5: "#16a34a", // park
  6: "#a855f7", // plaza
  7: "#f97316", // school
};

// --- STATE ---
let timerSeconds = 25 * 60;
let timeLeft = timerSeconds;
let timerInterval = null;
let timerRunning = false;
let endTime = null;
let segmentStart = null;
let xp = 0;
let level = 1;
let buildTokens = 0;
let focusSessionsToday = 0;
let awardedTaskIds = new Set();
let sessionType = "focus";
let sessionId = null;
let breakActionsBySession = {};
let canvasBaseUrl = DEFAULT_CANVAS_URL;
let canvasToken = "";
let geminiKey = "";
let chatHistory = [];
let currentTopic = "";
let chatBusy = false;

// --- UI ELEMENTS ---
const display = document.getElementById("timer-display");
const timerRing = document.getElementById("timer-ring");
const timerCaption = document.getElementById("timer-caption");
const pendingXpEl = document.getElementById("pending-xp");
const startBtn = document.getElementById("start-btn");
const restartBtn = document.getElementById("restart-btn");
const xpFill = document.getElementById("xp-fill");
const levelEl = document.getElementById("level");
const xpText = document.getElementById("xp-text");
const buildTokensEl = document.getElementById("build-tokens");
const brandSub = document.getElementById("brand-sub");
const cityCanvas = document.getElementById("city-grid");
const cycleDots = document.querySelectorAll(".cycle-dot");
const cycleLabel = document.getElementById("cycle-label");

const taskList = document.getElementById("task-list");
const taskStatus = document.getElementById("task-status");
const refreshTasksBtn = document.getElementById("refresh-tasks");

const tokenInput = document.getElementById("token-input");
const saveBtn = document.getElementById("save-token");
const canvasUrlInput = document.getElementById("canvas-url-input");
const saveCanvasUrlBtn = document.getElementById("save-canvas-url");

const timerHoursInput = document.getElementById("timer-hours-input");
const timerMinutesInput = document.getElementById("timer-minutes-input");
const timerSecondsInput = document.getElementById("timer-seconds-input");
const saveTimerBtn = document.getElementById("save-timer");
const presetButtons = document.querySelectorAll(".preset-btn");
const xpPreview = document.getElementById("xp-preview");
const xpFloatContainer = document.getElementById("xp-float-container");
const totalWorkedEl = document.getElementById("total-worked");
const totalSessionsEl = document.getElementById("total-sessions");

const sessionButtons = document.querySelectorAll(".session-btn");
const breakPrompt = document.getElementById("break-prompt");
const breakSuccess = document.querySelector(".break-success");
const breakButtons = document.querySelectorAll(".break-btn");
const spiritZone = document.querySelector(".spirit-zone");

const chatLog = document.getElementById("chat-log");
const chatInput = document.getElementById("chat-input");
const chatSend = document.getElementById("chat-send");
const chatClearBtn = document.getElementById("chat-clear");

const geminiKeyInput = document.getElementById("gemini-key-input");
const saveGeminiKeyBtn = document.getElementById("save-gemini-key");
const cityNameInput = document.getElementById("city-name-input");
const saveCityNameBtn = document.getElementById("save-city-name");
const resetProgressBtn = document.getElementById("reset-progress");

const tabs = document.querySelectorAll(".tab");
const toastStack = document.getElementById("toast-stack");

const SYSTEM_PROMPT =
  "You are a friendly study coach. Ask short active-recall questions, keep replies concise, and always end with a single question.";

// ============================================================
// Small helpers
// ============================================================

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toast(message, kind = "") {
  if (!toastStack) return;
  const el = document.createElement("div");
  el.className = `toast${kind ? ` is-${kind}` : ""}`;
  el.textContent = message;
  toastStack.appendChild(el);
  setTimeout(() => {
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 260);
  }, 2200);
}

function formatDuration(totalSeconds) {
  const safe = Math.max(0, Math.round(totalSeconds || 0));
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return `${hours.toString().padStart(2, "0")}:${mins
    .toString()
    .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function sendToBackground(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        void chrome.runtime.lastError; // popup may close mid-flight
        resolve(response || null);
      });
    } catch (error) {
      resolve(null);
    }
  });
}

function normalizeCanvasUrl(raw) {
  const value = (raw || "").trim().replace(/\/+$/, "");
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

// ============================================================
// Tabs
// ============================================================

function activateTab(name) {
  tabs.forEach((tab) => {
    const isActive = tab.dataset.tab === name;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
    const panel = document.getElementById(`panel-${tab.dataset.tab}`);
    if (panel) panel.hidden = !isActive;
  });
  chrome.storage.local.set({ lastTab: name });
  if (name === "recall") {
    ensureChatGreeting();
    chatInput?.focus();
  }
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab));
});

// ============================================================
// City preview (skyline drawn from the saved city state)
// ============================================================

function drawCityPreview(state) {
  if (!cityCanvas || !cityCanvas.getContext) return;
  const ctx = cityCanvas.getContext("2d");
  const w = cityCanvas.width;
  const h = cityCanvas.height;

  ctx.clearRect(0, 0, w, h);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "rgba(8,16,42,0.95)");
  sky.addColorStop(1, "rgba(20,30,66,0.95)");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const grid = state?.grid;
  const dev = state?.dev;
  const ground = h - 7;

  // ground line
  ctx.fillStyle = "rgba(129,140,248,0.35)";
  ctx.fillRect(0, ground, w, 1);

  if (!Array.isArray(grid) || !grid.length) {
    drawPreviewMessage(ctx, w, h, "Open the city builder to start building");
    return;
  }

  const n = grid.length;
  const colW = w / n;
  let built = 0;

  for (let x = 0; x < n; x += 1) {
    let mass = 0;
    let bestTile = 0;
    let bestScore = -1;

    for (let y = 0; y < n; y += 1) {
      const tile = grid[y]?.[x] || 0;
      if (!tile) continue;
      built += 1;
      const lvl = dev?.[y]?.[x] || 0;
      mass += 1 + lvl * 1.6;
      const score = tile === 1 ? 0.5 : 1 + lvl * 2;
      if (score > bestScore) {
        bestScore = score;
        bestTile = tile;
      }
    }

    if (!mass) continue;

    const barH = clamp(mass * 2.6, 3, ground - 6);
    const bx = x * colW + 0.6;
    const bw = Math.max(1.4, colW - 1.2);
    ctx.fillStyle = TILE_COLORS[bestTile] || "#6b7280";
    ctx.fillRect(bx, ground - barH, bw, barH);

    // lit windows on taller towers
    if (barH > 16 && bestTile !== 1) {
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      for (let wy = ground - barH + 5; wy < ground - 4; wy += 6) {
        ctx.fillRect(bx + bw * 0.3, wy, Math.max(1, bw * 0.35), 1.6);
      }
    }
  }

  if (!built) {
    drawPreviewMessage(ctx, w, h, "Open the city builder to start building");
  }
}

function drawPreviewMessage(ctx, w, h, text) {
  ctx.fillStyle = "rgba(167,177,216,0.75)";
  ctx.font =
    "600 11px 'Segoe UI', system-ui, -apple-system, Roboto, Helvetica, Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2);
}

cityCanvas?.addEventListener("click", () => {
  window.location.href = "cit.html";
});

// ============================================================
// Rendering
// ============================================================

function getSessionDuration(type) {
  if (type === "short-break") return SHORT_BREAK_SECONDS;
  if (type === "long-break") return LONG_BREAK_SECONDS;
  return timerSeconds;
}

function renderTimerDisplay() {
  display.textContent = formatDuration(timeLeft);
  const duration = getSessionDuration(sessionType);
  const progress = duration > 0 ? ((duration - timeLeft) / duration) * 100 : 0;
  timerRing?.style.setProperty("--progress", clamp(progress, 0, 100).toFixed(1));
  if (timerCaption) {
    timerCaption.textContent = timerRunning
      ? SESSION_LABELS[sessionType]
      : `${SESSION_LABELS[sessionType]} · paused`;
  }
  renderPendingXp();
}

function renderPendingXp() {
  if (!pendingXpEl) return;
  if (!timerRunning || sessionType !== "focus" || !segmentStart) {
    pendingXpEl.textContent = "";
    return;
  }
  const elapsed = Math.max(0, Math.floor((Date.now() - segmentStart) / 1000));
  const pending = Math.floor(elapsed / SECONDS_PER_XP);
  pendingXpEl.textContent = pending > 0 ? `+${pending} XP banked` : "";
}

function renderProgress() {
  if (levelEl) levelEl.textContent = `Level ${level} City`;
  if (xpText) xpText.textContent = `${xp}/100 XP`;
  if (xpFill) xpFill.style.width = `${clamp(xp, 0, 100)}%`;
  if (buildTokensEl) {
    buildTokensEl.textContent = `${buildTokens} brick${
      buildTokens === 1 ? "" : "s"
    }`;
  }
}

function renderCycles() {
  const done = focusSessionsToday % SESSIONS_PER_LONG_BREAK;
  const filled = focusSessionsToday > 0 && done === 0 ? 4 : done;
  cycleDots.forEach((dot, index) => {
    dot.classList.toggle("is-done", index < filled);
  });
  if (cycleLabel) {
    cycleLabel.textContent = `${focusSessionsToday} today`;
  }
}

function updateSessionButtons() {
  sessionButtons.forEach((button) => {
    button.classList.toggle(
      "is-active",
      button.dataset.session === sessionType,
    );
    button.disabled = timerRunning;
  });
}

function applyMood() {
  if (!spiritZone) return;
  spiritZone.classList.remove(
    "mood-focus",
    "mood-short-break",
    "mood-long-break",
  );
  spiritZone.classList.add(`mood-${sessionType}`);
}

function updateBreakPrompt() {
  if (!breakPrompt) return;
  const onBreak =
    timerRunning &&
    (sessionType === "short-break" || sessionType === "long-break");
  breakPrompt.classList.toggle("hidden", !onBreak);
  const actions = (sessionId && breakActionsBySession[sessionId]) || {};
  const completed = ["stretch", "water", "breathe"].filter(
    (action) => actions[action],
  ).length;
  const allComplete = completed === 3;
  breakPrompt.classList.toggle("is-complete", allComplete);
  breakSuccess?.classList.toggle("hidden", !allComplete);
  breakButtons.forEach((button) => {
    const done = Boolean(actions[button.dataset.action]);
    button.classList.toggle("is-complete", done);
    button.disabled = !onBreak || done;
  });
}

function updateStartButtonLabel() {
  if (timerRunning) {
    startBtn.textContent = "Pause";
    return;
  }
  if (timeLeft > 0 && timeLeft < getSessionDuration(sessionType)) {
    startBtn.textContent = "Resume";
    return;
  }
  startBtn.textContent =
    sessionType === "focus" ? "Start Focus" : "Start Break";
}

function renderAll() {
  renderTimerDisplay();
  renderProgress();
  renderCycles();
  updateSessionButtons();
  updateStartButtonLabel();
  updateBreakPrompt();
  applyMood();
}

// ============================================================
// Timer loop
// ============================================================

function tick() {
  if (timerRunning && endTime) {
    timeLeft = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
  }
  renderTimerDisplay();

  if (timerRunning && timeLeft <= 0) {
    // The service worker owns completion; just stop animating and
    // let the storage listener deliver the new state.
    stopDisplayLoop();
  }
}

function startDisplayLoop() {
  if (timerInterval) return;
  timerInterval = setInterval(tick, 500);
}

function stopDisplayLoop() {
  if (!timerInterval) return;
  clearInterval(timerInterval);
  timerInterval = null;
}

// ============================================================
// Initialization
// ============================================================

const STORAGE_KEYS = [
  "canvasToken",
  "canvasBaseUrl",
  "timerSeconds",
  "timerMinutes",
  "timerRunning",
  "endTime",
  "startTime",
  "remainingSeconds",
  "totalWorkedSeconds",
  "totalSessions",
  "focusSessionsToday",
  "xp",
  "level",
  "buildTokens",
  "awardedTaskIds",
  "sessionType",
  "sessionId",
  "breakActionsBySession",
  "geminiKey",
  "cityName",
  "cityState",
  "chatHistory",
  "chatTopic",
  "lastTab",
];

function initializeApp() {
  chrome.storage.local.get(STORAGE_KEYS, (result) => {
    if (result.timerSeconds) {
      timerSeconds = result.timerSeconds;
    } else if (result.timerMinutes) {
      timerSeconds = result.timerMinutes * 60;
    }

    if (typeof result.sessionType === "string") sessionType = result.sessionType;
    if (typeof result.sessionId === "string") sessionId = result.sessionId;
    if (result.breakActionsBySession) {
      breakActionsBySession = result.breakActionsBySession;
    }

    xp = typeof result.xp === "number" ? result.xp : 0;
    level = typeof result.level === "number" ? result.level : 1;
    buildTokens = typeof result.buildTokens === "number" ? result.buildTokens : 0;
    focusSessionsToday =
      typeof result.focusSessionsToday === "number"
        ? result.focusSessionsToday
        : 0;
    if (Array.isArray(result.awardedTaskIds)) {
      awardedTaskIds = new Set(result.awardedTaskIds);
    }

    canvasBaseUrl = result.canvasBaseUrl || DEFAULT_CANVAS_URL;
    canvasToken = result.canvasToken || "";
    geminiKey = typeof result.geminiKey === "string" ? result.geminiKey : "";
    chatHistory = Array.isArray(result.chatHistory) ? result.chatHistory : [];
    currentTopic = typeof result.chatTopic === "string" ? result.chatTopic : "";

    if (canvasUrlInput) canvasUrlInput.value = canvasBaseUrl;
    if (tokenInput) tokenInput.value = canvasToken;
    if (geminiKeyInput) geminiKeyInput.value = geminiKey;
    if (cityNameInput) cityNameInput.value = result.cityName || "";
    if (brandSub && result.cityName) brandSub.textContent = result.cityName;

    totalWorkedEl.textContent = formatDuration(result.totalWorkedSeconds || 0);
    if (totalSessionsEl) {
      totalSessionsEl.textContent = String(result.totalSessions || 0);
    }

    setTimerInputs(timerSeconds);
    updateXpPreview();

    if (result.timerRunning && result.endTime) {
      timerRunning = true;
      endTime = result.endTime;
      segmentStart = result.startTime || null;
      timeLeft = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      startDisplayLoop();
    } else if (result.remainingSeconds > 0) {
      timeLeft = result.remainingSeconds;
    } else {
      timeLeft = getSessionDuration(sessionType);
    }

    renderAll();
    renderChatLog();
    drawCityPreview(result.cityState);
    const validTabs = Array.from(tabs).map((tab) => tab.dataset.tab);
    activateTab(
      validTabs.includes(result.lastTab) ? result.lastTab : "timer",
    );

    if (canvasToken) {
      fetchCanvasTasks();
    } else {
      showTaskMessage(
        "Add your Canvas access token in Settings to see what is due.",
      );
    }
  });
}

initializeApp();

// ============================================================
// React to state written by the service worker / city page
// ============================================================

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if (changes.totalWorkedSeconds && totalWorkedEl) {
    totalWorkedEl.textContent = formatDuration(
      changes.totalWorkedSeconds.newValue || 0,
    );
  }
  if (changes.totalSessions && totalSessionsEl) {
    totalSessionsEl.textContent = String(changes.totalSessions.newValue || 0);
  }
  if (changes.xp) xp = changes.xp.newValue || 0;
  if (changes.level) level = changes.level.newValue || 1;
  if (changes.buildTokens) buildTokens = changes.buildTokens.newValue || 0;
  if (changes.focusSessionsToday) {
    focusSessionsToday = changes.focusSessionsToday.newValue || 0;
  }
  if (changes.sessionType) sessionType = changes.sessionType.newValue || "focus";
  if (changes.sessionId) sessionId = changes.sessionId.newValue || null;
  if (changes.breakActionsBySession) {
    breakActionsBySession = changes.breakActionsBySession.newValue || {};
  }
  if (changes.cityState) drawCityPreview(changes.cityState.newValue);
  if (changes.cityName && brandSub) {
    brandSub.textContent =
      changes.cityName.newValue || "Focus. Earn bricks. Build.";
  }

  if (changes.timerRunning || changes.endTime || changes.startTime) {
    timerRunning = Boolean(changes.timerRunning?.newValue ?? timerRunning);
    if (changes.endTime) endTime = changes.endTime.newValue || null;
    if (changes.startTime) segmentStart = changes.startTime.newValue || null;

    if (timerRunning && endTime) {
      timeLeft = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      startDisplayLoop();
    } else {
      stopDisplayLoop();
      if (changes.remainingSeconds?.newValue) {
        timeLeft = changes.remainingSeconds.newValue;
      } else if (!timerRunning) {
        timeLeft = getSessionDuration(sessionType);
      }
    }
  }

  renderAll();
});

// ============================================================
// XP (always awarded by the service worker)
// ============================================================

async function requestXp(amount) {
  if (!amount) return;
  showXpFloat(amount);
  const response = await sendToBackground({ type: "awardXp", amount });
  if (!response) return;
  xp = response.xp;
  level = response.level;
  buildTokens = response.buildTokens;
  renderProgress();
  if (response.leveledUp) {
    toast(`Level ${response.level}! +${response.bricksEarned} bricks`, "good");
    cityCanvas?.animate?.(
      [{ transform: "scale(1)" }, { transform: "scale(1.03)" }, { transform: "scale(1)" }],
      { duration: 450, easing: "ease-out" },
    );
  }
}

function showXpFloat(amount) {
  if (!xpFloatContainer) return;
  const bubble = document.createElement("div");
  bubble.className = "xp-float";
  bubble.textContent = `+${amount} XP`;
  xpFloatContainer.appendChild(bubble);
  setTimeout(() => bubble.remove(), 1200);
}

// ============================================================
// Canvas assignments
// ============================================================

function showTaskMessage(text, isError = false) {
  taskList.textContent = "";
  const p = document.createElement("p");
  p.className = `empty-state${isError ? " is-error" : ""}`;
  p.textContent = text;
  taskList.appendChild(p);
}

function describeDue(dueTime) {
  if (!dueTime) return { label: "No due date", urgency: "later", soon: false };
  const diffMs = dueTime - Date.now();
  const hours = diffMs / 3600000;
  const days = Math.floor(hours / 24);
  if (hours < 1) {
    return { label: "Due in under an hour", urgency: "soon", soon: true };
  }
  if (hours < 24) {
    return {
      label: `Due in ${Math.round(hours)}h`,
      urgency: "soon",
      soon: true,
    };
  }
  if (days === 1) return { label: "Due tomorrow", urgency: "near", soon: true };
  if (days <= 3) {
    return { label: `Due in ${days} days`, urgency: "near", soon: false };
  }
  return {
    label: `Due ${new Date(dueTime).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    })}`,
    urgency: "later",
    soon: false,
  };
}

async function fetchCanvasTasks() {
  if (!canvasToken) {
    showTaskMessage(
      "Add your Canvas access token in Settings to see what is due.",
    );
    return;
  }

  const base = normalizeCanvasUrl(canvasBaseUrl) || DEFAULT_CANVAS_URL;
  refreshTasksBtn?.setAttribute("disabled", "true");
  if (taskStatus) taskStatus.textContent = "Refreshing…";

  try {
    const response = await fetch(`${base}/api/v1/users/self/todo`, {
      headers: {
        Authorization: `Bearer ${canvasToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        response.status === 401
          ? "Canvas rejected the token. Generate a new one in Settings."
          : `Canvas returned ${response.status}.`,
      );
    }

    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("Unexpected response from Canvas.");

    const now = Date.now();
    const tasks = [];
    let earnedXp = 0;
    let awardedUpdated = false;

    data.forEach((item) => {
      const assignment = item.assignment;
      const quiz = item.quiz;
      const dueAt = assignment?.due_at || quiz?.due_at;
      const dueTime = dueAt ? new Date(dueAt).getTime() : null;
      const isPastDue = dueTime ? dueTime < now : false;
      const submittedAt =
        assignment?.submission?.submitted_at ||
        item.submission?.submitted_at ||
        assignment?.submitted_at;
      const isCompleted = Boolean(submittedAt);
      const points = assignment?.points_possible || 0;

      const taskId = assignment?.id
        ? `assignment-${assignment.id}`
        : quiz?.id
          ? `quiz-${quiz.id}`
          : `todo-${item.id}`;

      if (isCompleted || isPastDue) {
        if (isCompleted && !awardedTaskIds.has(taskId)) {
          earnedXp += Math.max(1, Math.floor(points));
          awardedTaskIds.add(taskId);
          awardedUpdated = true;
        }
        return;
      }

      tasks.push({
        name: assignment?.name || quiz?.title || "Unnamed Task",
        dueTime,
        points,
        course: item.context_name || "Canvas",
        url: assignment?.html_url || item.html_url || null,
      });
    });

    if (awardedUpdated) {
      chrome.storage.local.set({ awardedTaskIds: Array.from(awardedTaskIds) });
    }
    if (earnedXp > 0) {
      requestXp(earnedXp);
      toast(`+${earnedXp} XP for submitted work`, "good");
    }

    tasks.sort((a, b) => (a.dueTime || Infinity) - (b.dueTime || Infinity));
    renderTasks(tasks);
    if (taskStatus) {
      taskStatus.textContent = `Updated ${new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })}`;
    }
  } catch (error) {
    console.error("Canvas Fetch Error:", error);
    showTaskMessage(
      error?.message || "Could not reach Canvas. Check the URL and token.",
      true,
    );
    if (taskStatus) taskStatus.textContent = "";
  } finally {
    refreshTasksBtn?.removeAttribute("disabled");
  }
}

// Built with DOM nodes rather than innerHTML: assignment titles come
// from Canvas and must never be parsed as markup.
function renderTasks(tasks) {
  if (!tasks.length) {
    showTaskMessage("Nothing due. Your city is safe for now.");
    return;
  }

  taskList.textContent = "";
  tasks.slice(0, MAX_TASKS).forEach((task) => {
    const due = describeDue(task.dueTime);
    const node = document.createElement(task.url ? "a" : "div");
    node.className = `task-item urgency-${due.urgency}`;
    if (task.url) {
      node.href = task.url;
      node.target = "_blank";
      node.rel = "noreferrer noopener";
    }

    const top = document.createElement("div");
    top.className = "task-top";

    const name = document.createElement("span");
    name.className = "task-name";
    name.textContent = task.name;
    name.title = task.name;
    top.appendChild(name);

    if (task.points) {
      const points = document.createElement("span");
      points.className = "task-xp";
      points.textContent = `+${Math.floor(task.points)} XP`;
      top.appendChild(points);
    }

    const meta = document.createElement("div");
    meta.className = "task-meta";
    const course = document.createElement("span");
    course.textContent = `${task.course} · `;
    const dueEl = document.createElement("span");
    dueEl.textContent = due.label;
    if (due.soon) dueEl.className = "task-due-soon";
    meta.append(course, dueEl);

    node.append(top, meta);
    taskList.appendChild(node);
  });
}

refreshTasksBtn?.addEventListener("click", () => fetchCanvasTasks());

// ============================================================
// Settings
// ============================================================

document.querySelectorAll(".reveal-btn").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.reveals);
    if (!input) return;
    const revealed = input.type === "text";
    input.type = revealed ? "password" : "text";
    button.textContent = revealed ? "Show" : "Hide";
  });
});

saveBtn.addEventListener("click", () => {
  const userToken = tokenInput.value.trim();
  if (!userToken) {
    toast("Paste a Canvas token first.", "bad");
    return;
  }
  canvasToken = userToken;
  chrome.storage.local.set({ canvasToken: userToken }, () => {
    toast("Token saved", "good");
    fetchCanvasTasks();
  });
});

saveCanvasUrlBtn?.addEventListener("click", () => {
  const url = normalizeCanvasUrl(canvasUrlInput.value);
  if (!url) {
    toast("Enter your Canvas URL.", "bad");
    return;
  }
  canvasBaseUrl = url;
  canvasUrlInput.value = url;
  chrome.storage.local.set({ canvasBaseUrl: url }, () => {
    toast("Canvas URL saved", "good");
    fetchCanvasTasks();
  });
});

saveGeminiKeyBtn?.addEventListener("click", () => {
  const key = geminiKeyInput?.value.trim();
  if (!key) {
    toast("Enter a Gemini API key.", "bad");
    return;
  }
  geminiKey = key;
  chrome.storage.local.set({ geminiKey }, () => toast("Gemini key saved", "good"));
});

saveCityNameBtn?.addEventListener("click", () => {
  const name = cityNameInput?.value.trim();
  chrome.storage.local.set({ cityName: name }, () =>
    toast("City name saved", "good"),
  );
});

cityNameInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveCityNameBtn?.click();
});

resetProgressBtn?.addEventListener("click", () => {
  const ok = window.confirm(
    "Reset your level, XP, bricks and saved city? This cannot be undone.",
  );
  if (!ok) return;
  chrome.storage.local.set(
    {
      xp: 0,
      level: 1,
      buildTokens: 0,
      cityState: null,
      awardedTaskIds: [],
      focusSessionsToday: 0,
    },
    () => {
      xp = 0;
      level = 1;
      buildTokens = 0;
      focusSessionsToday = 0;
      awardedTaskIds = new Set();
      renderProgress();
      renderCycles();
      drawCityPreview(null);
      toast("Progress reset");
    },
  );
});

// --- timer length ---
function setTimerInputs(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  timerHoursInput.value = hours.toString().padStart(2, "0");
  timerMinutesInput.value = mins.toString().padStart(2, "0");
  timerSecondsInput.value = secs.toString().padStart(2, "0");
}

function readTimerInputs() {
  const hours = Number.parseInt(timerHoursInput.value, 10);
  const minutes = Number.parseInt(timerMinutesInput.value, 10);
  const seconds = Number.parseInt(timerSecondsInput.value, 10);
  const safeHours = Number.isNaN(hours) ? 0 : clamp(hours, 0, 99);
  const safeMinutes = Number.isNaN(minutes) ? 0 : clamp(minutes, 0, 59);
  const safeSeconds = Number.isNaN(seconds) ? 0 : clamp(seconds, 0, 59);
  return safeHours * 3600 + safeMinutes * 60 + safeSeconds;
}

function updateXpPreview() {
  const totalSeconds = readTimerInputs();
  xpPreview.textContent = `Earns up to ${Math.floor(
    totalSeconds / SECONDS_PER_XP,
  )} XP per session`;
}

function sanitizeTwoDigitsInput(input) {
  input.value = input.value.replace(/\D/g, "").slice(0, 2);
}

function finalizeTwoDigitsInput(input, maxValue) {
  if (input.value === "") {
    input.value = "00";
    return;
  }
  const value = clamp(Number.parseInt(input.value, 10), 0, maxValue);
  input.value = value.toString().padStart(2, "0");
}

[
  [timerHoursInput, 99],
  [timerMinutesInput, 59],
  [timerSecondsInput, 59],
].forEach(([input, max]) => {
  input.addEventListener("input", () => {
    sanitizeTwoDigitsInput(input);
    updateXpPreview();
  });
  input.addEventListener("blur", () => {
    finalizeTwoDigitsInput(input, max);
    updateXpPreview();
  });
});

presetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setTimerInputs(Number(button.dataset.minutes) * 60);
    updateXpPreview();
  });
});

saveTimerBtn.addEventListener("click", () => {
  const totalSeconds = readTimerInputs();
  if (totalSeconds <= 0) {
    toast("Enter a length longer than zero.", "bad");
    return;
  }

  timerSeconds = totalSeconds;
  setTimerInputs(timerSeconds);
  stopDisplayLoop();
  timerRunning = false;
  endTime = null;
  segmentStart = null;
  timeLeft = getSessionDuration(sessionType);

  chrome.storage.local.set(
    { timerSeconds, timerRunning: false, endTime: null, remainingSeconds: null },
    () => {
      sendToBackground({ type: "resetTimer" }).then(() => {
        renderAll();
        toast("Timer saved", "good");
        activateTab("timer");
      });
    },
  );
});

// ============================================================
// Timer controls
// ============================================================

sessionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (timerRunning) return;
    sessionType = button.dataset.session;
    timeLeft = getSessionDuration(sessionType);
    endTime = null;
    segmentStart = null;
    chrome.storage.local.set({ sessionType, remainingSeconds: null });
    renderAll();
  });
});

startBtn.addEventListener("click", async () => {
  if (timerRunning) {
    const response = await sendToBackground({ type: "pauseTimer" });
    timerRunning = false;
    endTime = null;
    segmentStart = null;
    timeLeft = response?.remainingSeconds ?? timeLeft;
    stopDisplayLoop();
    renderAll();
    if (response?.xpAwarded) toast(`+${response.xpAwarded} XP banked`, "good");
    return;
  }

  if (timeLeft <= 0) timeLeft = getSessionDuration(sessionType);

  const sessionDuration = getSessionDuration(sessionType);
  const shouldResume = timeLeft > 0 && timeLeft < sessionDuration;
  const nextSessionId = sessionId || Date.now().toString();
  sessionId = nextSessionId;

  if (!shouldResume && sessionType !== "focus") {
    breakActionsBySession[sessionId] = {};
    chrome.storage.local.set({ breakActionsBySession });
  }

  const message = shouldResume
    ? {
        type: "resumeTimer",
        remainingSeconds: timeLeft,
        sessionType,
        sessionId: nextSessionId,
      }
    : {
        type: "startTimer",
        durationSeconds: sessionDuration,
        sessionType,
        sessionId: nextSessionId,
      };

  const response = await sendToBackground(message);
  if (!response) {
    toast("Could not start the timer.", "bad");
    return;
  }
  timerRunning = true;
  endTime = response.endTime || null;
  segmentStart = response.startTime || Date.now();
  startDisplayLoop();
  tick();
  renderAll();
});

restartBtn?.addEventListener("click", async () => {
  const response = await sendToBackground({ type: "resetTimer" });
  stopDisplayLoop();
  timerRunning = false;
  endTime = null;
  segmentStart = null;
  sessionId = null;
  timeLeft = getSessionDuration(sessionType);
  renderAll();
  if (response?.xpAwarded) toast(`+${response.xpAwarded} XP banked`, "good");
});

breakButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (!sessionId) return;
    if (sessionType !== "short-break" && sessionType !== "long-break") return;
    const action = button.dataset.action;
    const actions = breakActionsBySession[sessionId] || {};
    if (actions[action]) return;

    actions[action] = true;
    breakActionsBySession[sessionId] = actions;
    chrome.storage.local.set({ breakActionsBySession });
    requestXp(BREAK_ACTION_XP);
    updateBreakPrompt();
  });
});

// ============================================================
// Active recall chat
// ============================================================

function appendChatMessage(role, text, pending = false) {
  if (!chatLog) return null;
  const msg = document.createElement("div");
  msg.className = `chat-msg ${role}${pending ? " is-pending" : ""}`;
  msg.textContent = text;
  chatLog.appendChild(msg);
  chatLog.scrollTop = chatLog.scrollHeight;
  return msg;
}

function renderChatLog() {
  if (!chatLog) return;
  chatLog.textContent = "";
  chatHistory.forEach((item) => {
    appendChatMessage(item.role === "model" ? "bot" : "user", item.text);
  });
  ensureChatGreeting();
}

function ensureChatGreeting() {
  if (!chatLog || chatLog.children.length > 0) return;
  appendChatMessage("bot", "What are you studying right now?");
}

function persistChat() {
  chrome.storage.local.set({
    chatHistory: chatHistory.slice(-20),
    chatTopic: currentTopic,
  });
}

chatClearBtn?.addEventListener("click", () => {
  chatHistory = [];
  currentTopic = "";
  persistChat();
  renderChatLog();
});

async function sendChat() {
  const text = chatInput?.value.trim();
  if (!text || chatBusy) return;

  if (!geminiKey) {
    appendChatMessage("bot", "Add your Gemini API key in Settings first.");
    return;
  }

  appendChatMessage("user", text);
  chatInput.value = "";
  if (!currentTopic) currentTopic = text;

  const contents = [
    {
      role: "user",
      parts: [{ text: `${SYSTEM_PROMPT}\nTopic: ${currentTopic}\nKeep it short.` }],
    },
    ...chatHistory.slice(-6).map((item) => ({
      role: item.role,
      parts: [{ text: item.text }],
    })),
    { role: "user", parts: [{ text }] },
  ];

  chatBusy = true;
  chatSend.disabled = true;
  const thinking = appendChatMessage("bot", "Thinking…", true);

  try {
    const reply = await fetchGeminiReply(contents);
    thinking?.remove();
    chatHistory.push({ role: "user", text });
    chatHistory.push({ role: "model", text: reply });
    persistChat();
    appendChatMessage("bot", reply);
  } catch (error) {
    thinking?.remove();
    const message =
      typeof error?.message === "string" && error.message.trim()
        ? error.message.slice(0, 200)
        : "Something went wrong. Try again.";
    appendChatMessage("bot", `AI error: ${message}`);
  } finally {
    chatBusy = false;
    chatSend.disabled = false;
    chatInput?.focus();
  }
}

async function fetchGeminiReply(contents) {
  const model = "gemini-3-flash-preview";
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents }),
      },
    );
    if (response.ok) {
      const data = await response.json();
      return (
        data.candidates?.[0]?.content?.parts?.[0]?.text ||
        "I could not generate a response."
      );
    }

    const errorBody = await response.text();
    const isOverloaded =
      response.status === 503 || errorBody.includes("UNAVAILABLE");
    if (!isOverloaded || attempt === maxAttempts) {
      throw new Error(errorBody || "Gemini request failed");
    }
    await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
  }
  throw new Error("Gemini request failed");
}

chatSend?.addEventListener("click", sendChat);
chatInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") sendChat();
});

// ============================================================
// Keyboard shortcuts
// ============================================================

// Space starts/pauses, but only when nothing focusable would swallow it.
document.addEventListener("keydown", (event) => {
  if (event.code !== "Space") return;
  const target = event.target;
  const busy =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLButtonElement ||
    target instanceof HTMLAnchorElement ||
    target instanceof HTMLSelectElement;
  if (busy) return;

  event.preventDefault();
  startBtn.click();
});
