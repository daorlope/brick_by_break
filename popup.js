// --- STATE VARIABLES ---
let timerSeconds = 25 * 60;
let timeLeft = timerSeconds;
let timerInterval = null;
let timerRunning = false;
let endTime = null;
let lastXpSecond = null;
let xp = 0;
let awardedTaskIds = new Set();

// --- UI ELEMENTS ---
const display = document.getElementById("timer-display");
const startBtn = document.getElementById("start-btn");
const xpFill = document.getElementById("xp-fill");
const taskList = document.getElementById("task-list");
const tokenInput = document.getElementById("token-input");
const saveBtn = document.getElementById("save-token");
const timerHoursInput = document.getElementById("timer-hours-input");
const timerMinutesInput = document.getElementById("timer-minutes-input");
const timerSecondsInput = document.getElementById("timer-seconds-input");
const saveTimerBtn = document.getElementById("save-timer");
const xpPreview = document.getElementById("xp-preview");
const xpFloatContainer = document.getElementById("xp-float-container");
const totalWorkedEl = document.getElementById("total-worked");

const settingsBtn = document.getElementById("settings-btn");
const settings = document.getElementById("settings-page");
const backBtn = document.getElementById("back-btn");
const mainSections = document.querySelectorAll(".main-section");

// --- INITIALIZATION ---
function initializeApp() {
  chrome.storage.local.get(
    [
      "canvasToken",
      "timerSeconds",
      "timerMinutes",
      "timerRunning",
      "endTime",
      "remainingSeconds",
      "totalWorkedSeconds",
      "xp",
      "awardedTaskIds",
    ],
    (result) => {
      if (result.timerSeconds) {
        timerSeconds = result.timerSeconds;
      } else if (result.timerMinutes) {
        timerSeconds = result.timerMinutes * 60;
      }

      timeLeft = timerSeconds;
      setTimerInputs(timerSeconds);
      updateXpPreview();
      if (typeof result.xp === "number") {
        xp = result.xp;
      }
      xpFill.style.width = `${xp}%`;
      if (Array.isArray(result.awardedTaskIds)) {
        awardedTaskIds = new Set(result.awardedTaskIds);
      }
      if (typeof result.totalWorkedSeconds === "number") {
        totalWorkedEl.textContent = formatDuration(result.totalWorkedSeconds);
      }

      if (result.timerRunning && result.endTime) {
        timerRunning = true;
        endTime = result.endTime;
        syncTimerDisplay();
        startDisplayLoop();
        startBtn.textContent = "Pause";
      } else if (result.remainingSeconds > 0) {
        timeLeft = result.remainingSeconds;
        renderTimerDisplay();
        startBtn.textContent = "Resume";
      } else {
        renderTimerDisplay();
        startBtn.textContent = "Start Session";
      }

      if (result.canvasToken) {
        // If we have a token, fetch real data
        tokenInput.value = result.canvasToken;
        showMain();
        fetchCanvasTasks(result.canvasToken);
      } else {
        // If no token, show error message or settings
        showSettings();
        taskList.innerHTML = `<p style="color:#94a3b8; font-size:11px; text-align:center;">Please enter your token in Settings.</p>`;
      }
    },
  );
}

// Start the app immediately
initializeApp();

// --- CANVAS API LOGIC ---
async function fetchCanvasTasks(token) {
  const BASE_URL = "https://canvas.ucsc.edu";

  try {
    const response = await fetch(`${BASE_URL}/api/v1/users/self/todo`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) throw new Error("Invalid Token or Network Error");

    const data = await response.json();

    const now = Date.now();
    const tasks = [];
    let awardedUpdated = false;

    data.forEach((item) => {
      const assignment = item.assignment;
      const quiz = item.quiz;
      const dueAt = assignment?.due_at;
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
          gainXP(Math.max(1, Math.floor(points)));
          awardedTaskIds.add(taskId);
          awardedUpdated = true;
        }
        return;
      }

      tasks.push({
        name: assignment?.name || quiz?.title || "Unnamed Task",
        due: dueAt ? new Date(dueAt).toLocaleDateString() : "No Date",
        points,
        course: item.context_name,
      });
    });

    if (awardedUpdated) {
      chrome.storage.local.set({ awardedTaskIds: Array.from(awardedTaskIds) });
    }

    renderTasks(tasks);
  } catch (error) {
    console.error("Canvas Fetch Error:", error);
    taskList.innerHTML = `<p style="color:#fb7185; font-size:11px; text-align:center;">Token expired or wrong school URL.</p>`;
  }
}

function renderTasks(tasks) {
  if (tasks.length === 0) {
    taskList.innerHTML = `<p style="color:#94a3b8; font-size:11px; text-align:center;">No tasks due! Your spirit is happy.</p>`;
    return;
  }

  taskList.innerHTML = tasks
    .slice(0, 3) // Show top 3 tasks
    .map(
      (task) => `
        <div class="task-item" style="background:#334155; padding:8px; border-radius:8px; margin-bottom:6px; font-size:0.8rem;">
            <div style="display:flex; justify-content:space-between">
                <strong>${task.name}</strong>
                <span style="color:#4ade80">+${task.points} XP</span>
            </div>
            <div style="font-size: 0.7rem; opacity: 0.7">${task.course} • Due: ${task.due}</div>
        </div>
    `,
    )
    .join("");
}

// --- TOKEN MANAGEMENT ---
function showSettings() {
  settings.classList.remove("hidden");
  mainSections.forEach((section) => section.classList.add("hidden"));
}

function showMain() {
  settings.classList.add("hidden");
  mainSections.forEach((section) => section.classList.remove("hidden"));
}

settingsBtn.addEventListener("click", () => {
  showSettings();
});

backBtn.addEventListener("click", () => {
  showMain();
});

saveBtn.addEventListener("click", () => {
  const userToken = tokenInput.value.trim();

  if (userToken) {
    chrome.storage.local.set({ canvasToken: userToken }, () => {
      alert("Token saved! Refreshing...");
      location.reload();
    });
  }
});

saveTimerBtn.addEventListener("click", () => {
  const hours = Number.parseInt(timerHoursInput.value, 10);
  const minutes = Number.parseInt(timerMinutesInput.value, 10);
  const seconds = Number.parseInt(timerSecondsInput.value, 10);
  const safeHours = Number.isNaN(hours) ? 0 : clamp(hours, 0, 99);
  const safeMinutes = Number.isNaN(minutes) ? 0 : clamp(minutes, 0, 59);
  const safeSeconds = Number.isNaN(seconds) ? 0 : clamp(seconds, 0, 59);
  const totalSeconds = safeHours * 3600 + safeMinutes * 60 + safeSeconds;

  if (totalSeconds > 0) {
    timerSeconds = totalSeconds;
    timeLeft = timerSeconds;
    setTimerInputs(timerSeconds);
    stopDisplayLoop();
    timerRunning = false;
    endTime = null;
    lastXpSecond = null;
    renderTimerDisplay();
    chrome.storage.local.set(
      { timerSeconds, timerRunning: false, endTime: null, remainingSeconds: null },
      () => {
        chrome.runtime.sendMessage({ type: "resetTimer" }, () => {
          alert("Timer saved!");
          showMain();
        });
      },
    );
  } else {
    alert("Enter a valid number of hours/minutes/seconds.");
  }
});

// --- TIMER & XP LOGIC ---
function syncTimerDisplay() {
  if (timerRunning && endTime) {
    timeLeft = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
  }

  renderTimerDisplay();

  const elapsedSeconds = timerSeconds - timeLeft;

  if (timerRunning && timeLeft > 0 && elapsedSeconds > 0 && timeLeft % 10 === 0) {
    if (timeLeft !== lastXpSecond) {
      lastXpSecond = timeLeft;
      gainXP(1); // Gain 1 XP every 10 seconds while open
    }
  }

  if (timerRunning && timeLeft <= 0) {
    timerRunning = false;
    endTime = null;
    stopDisplayLoop();
    startBtn.textContent = "Start Session";
    alert("Focus Complete! Your Spirit is stronger.");
  }
}

function startDisplayLoop() {
  if (timerInterval) return;
  timerInterval = setInterval(syncTimerDisplay, 1000);
}

function stopDisplayLoop() {
  if (!timerInterval) return;
  clearInterval(timerInterval);
  timerInterval = null;
}

function renderTimerDisplay() {
  const hours = Math.floor(timeLeft / 3600);
  const mins = Math.floor((timeLeft % 3600) / 60);
  const secs = timeLeft % 60;
  display.textContent = `${hours
    .toString()
    .padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
}

function setTimerInputs(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  timerHoursInput.value = hours.toString().padStart(2, "0");
  timerMinutesInput.value = mins.toString().padStart(2, "0");
  timerSecondsInput.value = secs.toString().padStart(2, "0");
}

function updateXpPreview() {
  const hours = Number.parseInt(timerHoursInput.value, 10);
  const minutes = Number.parseInt(timerMinutesInput.value, 10);
  const seconds = Number.parseInt(timerSecondsInput.value, 10);
  const safeHours = Number.isNaN(hours) ? 0 : clamp(hours, 0, 99);
  const safeMinutes = Number.isNaN(minutes) ? 0 : clamp(minutes, 0, 59);
  const safeSeconds = Number.isNaN(seconds) ? 0 : clamp(seconds, 0, 59);
  const totalSeconds = safeHours * 3600 + safeMinutes * 60 + safeSeconds;
  const xpGain = Math.floor(totalSeconds / 10) * 1;
  xpPreview.textContent = `Potential XP: ${xpGain}`;
}

function sanitizeTwoDigitsInput(input) {
  const digits = input.value.replace(/\D/g, "").slice(0, 2);
  input.value = digits;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function finalizeTwoDigitsInput(input, maxValue) {
  if (input.value === "") {
    input.value = "00";
    return;
  }

  const value = clamp(Number.parseInt(input.value, 10), 0, maxValue);
  input.value = value.toString().padStart(2, "0");
}

timerHoursInput.addEventListener("input", () => {
  sanitizeTwoDigitsInput(timerHoursInput);
  updateXpPreview();
});

timerMinutesInput.addEventListener("input", () => {
  sanitizeTwoDigitsInput(timerMinutesInput);
  updateXpPreview();
});

timerSecondsInput.addEventListener("input", () => {
  sanitizeTwoDigitsInput(timerSecondsInput);
  updateXpPreview();
});

timerHoursInput.addEventListener("blur", () => {
  finalizeTwoDigitsInput(timerHoursInput, 99);
  updateXpPreview();
});

timerMinutesInput.addEventListener("blur", () => {
  finalizeTwoDigitsInput(timerMinutesInput, 59);
  updateXpPreview();
});

timerSecondsInput.addEventListener("blur", () => {
  finalizeTwoDigitsInput(timerSecondsInput, 59);
  updateXpPreview();
});

function gainXP(amount) {
  xp += amount;
  if (xp >= 100) {
    xp = 0;
    // Trigger a simple level up visual here
    document.getElementById("spirit").style.transform = "scale(1.2)";
    setTimeout(
      () => (document.getElementById("spirit").style.transform = "scale(1)"),
      500,
    );
  }
  xpFill.style.width = `${xp}%`;
  chrome.storage.local.set({ xp });
  showXpFloat(amount);
}

function showXpFloat(amount) {
  if (!xpFloatContainer) return;
  const bubble = document.createElement("div");
  bubble.className = "xp-float";
  bubble.textContent = `+${amount} XP`;
  xpFloatContainer.appendChild(bubble);
  setTimeout(() => bubble.remove(), 1100);
}

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return `${hours.toString().padStart(2, "0")}:${mins
    .toString()
    .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.totalWorkedSeconds && totalWorkedEl) {
    totalWorkedEl.textContent = formatDuration(
      changes.totalWorkedSeconds.newValue || 0,
    );
  }
});

startBtn.addEventListener("click", () => {
  if (timerRunning) {
    chrome.runtime.sendMessage({ type: "pauseTimer" }, (response) => {
      timerRunning = false;
      endTime = null;
      timeLeft = response?.remainingSeconds ?? timeLeft;
      renderTimerDisplay();
      stopDisplayLoop();
      startBtn.textContent = "Resume";
    });
    return;
  }

  if (timeLeft <= 0) {
    timeLeft = timerSeconds;
  }

  const shouldResume = timeLeft > 0 && timeLeft < timerSeconds;
  const message = shouldResume
    ? { type: "resumeTimer", remainingSeconds: timeLeft }
    : { type: "startTimer", durationSeconds: timerSeconds };

  chrome.runtime.sendMessage(message, (response) => {
    if (!response) return;
    timerRunning = true;
    endTime = response.endTime || null;
    lastXpSecond = null;
    startDisplayLoop();
    syncTimerDisplay();
    startBtn.textContent = "Pause";
  });
});

// --- BUTTON MANGEMENT ---
