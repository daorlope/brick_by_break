// --- STATE VARIABLES ---
let timeLeft = 25 * 60;
let timerId = null;
let xp = 0;

// --- UI ELEMENTS ---
const display = document.getElementById("timer-display");
const startBtn = document.getElementById("start-btn");
const xpFill = document.getElementById("xp-fill");
const taskList = document.getElementById("task-list");
const tokenInput = document.getElementById("token-input");
const saveBtn = document.getElementById("save-token");

const settingsBtn = document.getElementById("settings-btn");
const settings = document.getElementById("settings-page");

// --- INITIALIZATION ---
function initializeApp() {
  chrome.storage.local.get(["canvasToken"], (result) => {
    if (result.canvasToken) {
      // If we have a token, fetch real data
      fetchCanvasTasks(result.canvasToken);
    } else {
      // If no token, show error message or settings
      taskList.innerHTML = `<p style="color:#94a3b8; font-size:11px; text-align:center;">Please enter your token in Settings.</p>`;
    }
  });
}

// Start the app immediately
initializeApp();

// --- CANVAS API LOGIC ---
async function fetchCanvasTasks(token) {
  const BASE_URL = "https://canvas.ucsc.edu";

  try {
    const response = await fetch(`${BASE_URL}/api/v1/todo`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) throw new Error("Invalid Token or Network Error");

    const data = await response.json();

    // Map the API response to our UI format
    const tasks = data.map((item) => ({
      name: item.assignment?.name || item.quiz?.title || "Unnamed Task",
      due: item.assignment?.due_at
        ? new Date(item.assignment.due_at).toLocaleDateString()
        : "No Date",
      points: item.assignment?.points_possible || 0,
      course: item.context_name,
    }));

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
saveBtn.addEventListener("click", () => {
  const userToken = tokenInput.value.trim();

  if (userToken) {
    chrome.storage.local.set({ canvasToken: userToken }, () => {
      alert("Token saved! Refreshing...");
      location.reload();
    });
  }
});

// --- TIMER & XP LOGIC ---
function updateTimer() {
  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  display.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;

  if (timeLeft > 0) {
    timeLeft--;
    if (timeLeft % 60 === 0) gainXP(2); // Gain 2 XP every minute
  } else {
    clearInterval(timerId);
    timerId = null;
    startBtn.textContent = "Start Session";
    alert("Focus Complete! Your Spirit is stronger.");
  }
}

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
}

startBtn.addEventListener("click", () => {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
    startBtn.textContent = "Resume";
  } else {
    timerId = setInterval(updateTimer, 1000);
    startBtn.textContent = "Pause";
  }
});

// --- BUTTON MANGEMENT ---
settingsBtn.addEventListener("click", () => {
  settings.classList.toggle("hidden");
})

