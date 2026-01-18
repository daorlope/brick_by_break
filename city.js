const CITY_STAGES = [
  {
    minXp: 0,
    label: "Empty lot",
    art: [
      "                              ",
      "                              ",
      "                              ",
      "          .---.               ",
      "         (     )              ",
      "          `---'               ",
      "______________________________",
      "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
    ],
  },
  {
    minXp: 1,
    label: "Campfire town",
    art: [
      "                              ",
      "        _         _           ",
      "       | |  _    | |          ",
      "   _   | | | |   | |   _      ",
      "  | |__| |_| |___| |__| |     ",
      "__|____|_____|___|_____|_____ ",
      "______________________________",
      "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
    ],
  },
  {
    minXp: 25,
    label: "Small city",
    art: [
      "             _   ___          ",
      "    _       | | |[] |   _     ",
      "   | |  _   | | |   |  | |    ",
      "   | | | |  | |_|   |  | |    ",
      "   | |_| |__|___|___|__| |    ",
      "__|___|_____|___|___|____|___ ",
      "______________________________",
      "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
    ],
  },
  {
    minXp: 60,
    label: "Growing skyline",
    art: [
      "          ___       ____      ",
      "   __    |[] |  _  |[]  |     ",
      "  |  |   |   | | | |    |  _  ",
      "  |[]| __|   |_| |_| [] | | | ",
      "  |  ||__|___|___|_|____|_| | ",
      "__|__|_____|___|_____|___|_|__",
      "______________________________",
      "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
    ],
  },
  {
    minXp: 110,
    label: "Busy downtown",
    art: [
      "     ____   ___    _____      ",
      "  __|[]  | |[] |  |[] []| __  ",
      " |  |    | |   |  |     ||  | ",
      " |[]| [] | |[] |__| []  ||[]| ",
      " |  |____|_|___|__|_____| |  |",
      "_|__|_____|___|__|___|___|_|__",
      "______________________________",
      "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
    ],
  },
  {
    minXp: 180,
    label: "Metropolis",
    art: [
      "  ____  _____  ____  _____    ",
      " |[]  ||[] []||[]  ||[] []|   ",
      " |    ||     ||    ||     |   ",
      " | [] || []  || [] || []  | __",
      " |____||_____| |____||____||[]",
      "_|____|_|____|_|____|_|____|__",
      "______________________________",
      "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
    ],
  },
];

const asciiEl = document.getElementById("city-ascii");
const xpEl = document.getElementById("city-xp");
const stageEl = document.getElementById("city-stage");

function normalizeArt(art) {
  const maxLength = art.reduce((max, line) => Math.max(max, line.length), 0);
  return art.map((line) => line.padEnd(maxLength, " ")).join("\n");
}

function getStage(totalXp) {
  for (let i = CITY_STAGES.length - 1; i >= 0; i -= 1) {
    if (totalXp >= CITY_STAGES[i].minXp) {
      return i;
    }
  }
  return 0;
}

function renderCity(totalXp) {
  const stageIndex = getStage(totalXp);
  const stage = CITY_STAGES[stageIndex];
  asciiEl.textContent = normalizeArt(stage.art);
  xpEl.textContent = `Total XP: ${totalXp}`;
  stageEl.textContent = `Stage ${stageIndex} - ${stage.label}`;
}

function readStoredXp() {
  chrome.storage.local.get(["totalXp", "xp"], (result) => {
    const storedTotal =
      typeof result.totalXp === "number"
        ? result.totalXp
        : typeof result.xp === "number"
          ? result.xp
          : 0;
    renderCity(storedTotal);
  });
}

readStoredXp();

chrome.storage.onChanged.addListener((changes) => {
  if (changes.totalXp || changes.xp) {
    readStoredXp();
  }
});
