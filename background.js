function scheduleAlarm(endTime) {
  chrome.alarms.clear("timerDone", () => {
    chrome.alarms.create("timerDone", { when: endTime });
  });
}

function completeTimer() {
  chrome.storage.local.get(
    ["totalWorkedSeconds", "activeDurationSeconds"],
    (result) => {
      const totalWorkedSeconds = result.totalWorkedSeconds || 0;
      const addSeconds = result.activeDurationSeconds || 0;
      chrome.storage.local.set(
        {
          timerRunning: false,
          endTime: null,
          remainingSeconds: 0,
          startTime: null,
          activeDurationSeconds: null,
          totalWorkedSeconds: totalWorkedSeconds + addSeconds,
        },
        () => {},
      );
    },
  );
}

function restoreAlarmIfNeeded() {
  chrome.storage.local.get(["timerRunning", "endTime"], (result) => {
    if (!result.timerRunning || !result.endTime) return;
    if (result.endTime <= Date.now()) {
      completeTimer();
      return;
    }
    scheduleAlarm(result.endTime);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  restoreAlarmIfNeeded();
});

chrome.runtime.onStartup.addListener(() => {
  restoreAlarmIfNeeded();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "timerDone") {
    completeTimer();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "getTimerState") {
    chrome.storage.local.get(
      ["timerRunning", "endTime", "remainingSeconds"],
      (result) => {
        sendResponse(result);
      },
    );
    return true;
  }

  if (message.type === "startTimer") {
    const durationSeconds = Math.max(0, message.durationSeconds || 0);
    const endTime = Date.now() + durationSeconds * 1000;
    chrome.storage.local.set(
      {
        timerRunning: true,
        endTime,
        remainingSeconds: null,
        startTime: Date.now(),
        activeDurationSeconds: durationSeconds,
      },
      () => {
        scheduleAlarm(endTime);
        sendResponse({ timerRunning: true, endTime });
      },
    );
    return true;
  }

  if (message.type === "resumeTimer") {
    const remainingSeconds = Math.max(0, message.remainingSeconds || 0);
    const endTime = Date.now() + remainingSeconds * 1000;
    chrome.storage.local.set(
      {
        timerRunning: true,
        endTime,
        remainingSeconds: null,
        startTime: Date.now(),
        activeDurationSeconds: remainingSeconds,
      },
      () => {
        scheduleAlarm(endTime);
        sendResponse({ timerRunning: true, endTime });
      },
    );
    return true;
  }

  if (message.type === "pauseTimer") {
    chrome.storage.local.get(
      ["endTime", "startTime", "activeDurationSeconds", "totalWorkedSeconds"],
      (result) => {
        const totalWorkedSeconds = result.totalWorkedSeconds || 0;
        const startTime = result.startTime || Date.now();
        const activeDurationSeconds = result.activeDurationSeconds || 0;
        const elapsedSeconds = Math.min(
          activeDurationSeconds,
          Math.max(0, Math.floor((Date.now() - startTime) / 1000)),
        );
        const nextTotal = totalWorkedSeconds + elapsedSeconds;

      const remainingSeconds = result.endTime
        ? Math.max(0, Math.ceil((result.endTime - Date.now()) / 1000))
        : 0;
      chrome.alarms.clear("timerDone", () => {
        chrome.storage.local.set(
          {
            timerRunning: false,
            endTime: null,
            remainingSeconds,
            startTime: null,
            activeDurationSeconds: null,
            totalWorkedSeconds: nextTotal,
          },
          () => {
            sendResponse({ timerRunning: false, remainingSeconds });
          },
        );
      });
    },
    );
    return true;
  }

  if (message.type === "resetTimer") {
    chrome.alarms.clear("timerDone", () => {
      chrome.storage.local.set(
        {
          timerRunning: false,
          endTime: null,
          remainingSeconds: null,
          startTime: null,
          activeDurationSeconds: null,
        },
        () => {
          sendResponse({ timerRunning: false, remainingSeconds: null });
        },
      );
    });
    return true;
  }

  return false;
});
