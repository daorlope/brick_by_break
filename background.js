// ============================================================
// Brick By Break — service worker
//
// Owns the timer and all XP accounting so that progress keeps
// accruing while the popup is closed.
// ============================================================

const SECONDS_PER_XP = 10; // must match popup.js
const XP_PER_LEVEL = 100;
const BRICKS_PER_LEVEL = 3;
const SESSIONS_PER_LONG_BREAK = 4;
const TICK_ALARM = "badgeTick";
const DONE_ALARM = "timerDone";

// ---------- small cross-browser helpers ----------

function getStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result || {}));
  });
}

function setStorage(values) {
  return new Promise((resolve) => {
    chrome.storage.local.set(values, () => resolve());
  });
}

const action = chrome.action || chrome.browserAction || null;

function setBadge(text, color) {
  if (!action) return;
  try {
    action.setBadgeText({ text });
    if (color && action.setBadgeBackgroundColor) {
      action.setBadgeBackgroundColor({ color });
    }
  } catch (error) {
    // badge is cosmetic; never let it break the timer
  }
}

function notify(title, message) {
  if (!chrome.notifications) return;
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("brickByBreakLogo.jpg"),
      title,
      message,
      priority: 2,
    });
  } catch (error) {
    // notifications may be unavailable; ignore
  }
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

// ---------- alarms ----------

function scheduleAlarm(endTime) {
  chrome.alarms.clear(DONE_ALARM, () => {
    chrome.alarms.create(DONE_ALARM, { when: endTime });
  });
  chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
}

function clearAlarms() {
  chrome.alarms.clear(DONE_ALARM);
  chrome.alarms.clear(TICK_ALARM);
}

// ---------- XP ----------

/**
 * Single writer for xp/level/buildTokens. Returns the new totals so
 * callers can report what happened without re-reading storage.
 */
async function awardXp(amount) {
  const safeAmount = Math.max(0, Math.floor(amount || 0));
  const stored = await getStorage(["xp", "level", "buildTokens"]);
  let xp = typeof stored.xp === "number" ? stored.xp : 0;
  let level = typeof stored.level === "number" ? stored.level : 1;
  let buildTokens =
    typeof stored.buildTokens === "number" ? stored.buildTokens : 0;

  if (safeAmount === 0) {
    return { xp, level, buildTokens, leveledUp: false, bricksEarned: 0 };
  }

  const startLevel = level;
  xp += safeAmount;
  while (xp >= XP_PER_LEVEL) {
    xp -= XP_PER_LEVEL;
    level += 1;
    buildTokens += BRICKS_PER_LEVEL;
  }

  await setStorage({ xp, level, buildTokens });
  const levelsGained = level - startLevel;
  return {
    xp,
    level,
    buildTokens,
    leveledUp: levelsGained > 0,
    bricksEarned: levelsGained * BRICKS_PER_LEVEL,
  };
}

/**
 * Commits the focus time of the segment that just ended: adds it to the
 * lifetime total and converts it to XP. Breaks bank time but no XP.
 */
async function commitElapsed(elapsedSeconds, sessionType) {
  const seconds = Math.max(0, Math.floor(elapsedSeconds || 0));
  if (seconds <= 0) return 0;

  const stored = await getStorage(["totalWorkedSeconds"]);
  const totalWorkedSeconds = (stored.totalWorkedSeconds || 0) + seconds;
  await setStorage({ totalWorkedSeconds });

  if (sessionType !== "focus") return 0;
  const xpAmount = Math.floor(seconds / SECONDS_PER_XP);
  if (xpAmount > 0) await awardXp(xpAmount);
  return xpAmount;
}

// ---------- timer lifecycle ----------

async function elapsedForRunningSegment() {
  const stored = await getStorage(["startTime", "activeDurationSeconds"]);
  if (!stored.startTime) return 0;
  const cap = stored.activeDurationSeconds || 0;
  const raw = Math.floor((Date.now() - stored.startTime) / 1000);
  return Math.min(cap || raw, Math.max(0, raw));
}

async function completeTimer() {
  const stored = await getStorage([
    "activeDurationSeconds",
    "sessionType",
    "totalSessions",
    "focusSessionsToday",
    "focusSessionsDate",
  ]);
  const sessionType = stored.sessionType || "focus";
  const duration = stored.activeDurationSeconds || 0;

  const xpAwarded = await commitElapsed(duration, sessionType);

  let nextSessionType = "focus";
  const updates = {
    timerRunning: false,
    endTime: null,
    remainingSeconds: 0,
    startTime: null,
    activeDurationSeconds: null,
    sessionId: null,
  };

  if (sessionType === "focus") {
    const isToday = stored.focusSessionsDate === todayKey();
    const todayCount = (isToday ? stored.focusSessionsToday || 0 : 0) + 1;
    updates.focusSessionsToday = todayCount;
    updates.focusSessionsDate = todayKey();
    updates.totalSessions = (stored.totalSessions || 0) + 1;
    nextSessionType =
      todayCount % SESSIONS_PER_LONG_BREAK === 0 ? "long-break" : "short-break";
  }

  updates.sessionType = nextSessionType;
  await setStorage(updates);

  clearAlarms();
  setBadge("", "#4ade80");

  if (sessionType === "focus") {
    notify(
      "Focus complete",
      xpAwarded > 0
        ? `+${xpAwarded} XP earned. Time for a ${
            nextSessionType === "long-break" ? "long" : "short"
          } break.`
        : "Nice work. Time for a break.",
    );
  } else {
    notify("Break over", "Ready for another focus session?");
  }
}

async function refreshBadge() {
  const stored = await getStorage(["timerRunning", "endTime", "sessionType"]);
  if (!stored.timerRunning || !stored.endTime) {
    setBadge("");
    return;
  }
  const remaining = Math.max(0, stored.endTime - Date.now());
  const minutes = Math.ceil(remaining / 60000);
  const text = minutes >= 60 ? `${Math.floor(minutes / 60)}h` : `${minutes}m`;
  setBadge(text, stored.sessionType === "focus" ? "#6366f1" : "#0ea5e9");
}

async function restoreAlarmIfNeeded() {
  const stored = await getStorage(["timerRunning", "endTime"]);
  if (!stored.timerRunning || !stored.endTime) {
    setBadge("");
    return;
  }
  if (stored.endTime <= Date.now()) {
    await completeTimer();
    return;
  }
  scheduleAlarm(stored.endTime);
  refreshBadge();
}

chrome.runtime.onInstalled.addListener(() => {
  restoreAlarmIfNeeded();
});

chrome.runtime.onStartup.addListener(() => {
  restoreAlarmIfNeeded();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DONE_ALARM) {
    completeTimer();
  } else if (alarm.name === TICK_ALARM) {
    refreshBadge();
  }
});

// ---------- messages ----------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return false;

  if (message.type === "getTimerState") {
    getStorage([
      "timerRunning",
      "endTime",
      "startTime",
      "remainingSeconds",
      "sessionType",
      "sessionId",
    ]).then(sendResponse);
    return true;
  }

  if (message.type === "awardXp") {
    awardXp(message.amount).then(sendResponse);
    return true;
  }

  if (message.type === "startTimer" || message.type === "resumeTimer") {
    const seconds = Math.max(
      0,
      message.type === "startTimer"
        ? message.durationSeconds || 0
        : message.remainingSeconds || 0,
    );
    const startTime = Date.now();
    const endTime = startTime + seconds * 1000;

    setStorage({
      timerRunning: true,
      endTime,
      remainingSeconds: null,
      startTime,
      activeDurationSeconds: seconds,
      sessionType: message.sessionType || "focus",
      sessionId: message.sessionId || String(startTime),
    }).then(() => {
      scheduleAlarm(endTime);
      refreshBadge();
      sendResponse({ timerRunning: true, endTime, startTime });
    });
    return true;
  }

  if (message.type === "pauseTimer") {
    (async () => {
      const stored = await getStorage(["endTime", "sessionType"]);
      const elapsed = await elapsedForRunningSegment();
      const remainingSeconds = stored.endTime
        ? Math.max(0, Math.ceil((stored.endTime - Date.now()) / 1000))
        : 0;

      const xpAwarded = await commitElapsed(
        elapsed,
        stored.sessionType || "focus",
      );

      clearAlarms();
      await setStorage({
        timerRunning: false,
        endTime: null,
        remainingSeconds,
        startTime: null,
        activeDurationSeconds: null,
      });
      setBadge("");
      sendResponse({ timerRunning: false, remainingSeconds, xpAwarded });
    })();
    return true;
  }

  if (message.type === "resetTimer") {
    (async () => {
      const stored = await getStorage(["timerRunning", "sessionType"]);
      let xpAwarded = 0;
      if (stored.timerRunning) {
        // Time already spent still counts — don't punish a restart.
        const elapsed = await elapsedForRunningSegment();
        xpAwarded = await commitElapsed(elapsed, stored.sessionType || "focus");
      }

      clearAlarms();
      await setStorage({
        timerRunning: false,
        endTime: null,
        remainingSeconds: null,
        startTime: null,
        activeDurationSeconds: null,
        sessionId: null,
      });
      setBadge("");
      sendResponse({ timerRunning: false, remainingSeconds: null, xpAwarded });
    })();
    return true;
  }

  return false;
});
