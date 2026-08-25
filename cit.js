document.addEventListener("DOMContentLoaded", () => {
  // ----- Config -----
  const N = 30; // grid size
  const SIM_STEP_MS = 500;
  const TILE = {
    empty: 0,
    road: 1,
    res: 2,
    com: 3,
    ind: 4,
    park: 5,
    plaza: 6,
    school: 7,
  };

  const COLORS = {
    [TILE.empty]: "#0b1020",
    [TILE.road]:  "#6b7280",
    [TILE.res]:   "#22c55e",
    [TILE.com]:   "#60a5fa",
    [TILE.ind]:   "#f59e0b",
    [TILE.park]:  "#16a34a",
    [TILE.plaza]: "#a855f7",
    [TILE.school]: "#f97316",
  };

  // Capacity per developed zone tile (0..3 dev level)
  const CAP = {
    [TILE.res]: [0, 10, 25, 45],
    [TILE.com]: [0,  8, 18, 30],
    [TILE.ind]: [0, 10, 22, 36],
  };

  // ----- State -----
  const grid = Array.from({length:N}, () => Array(N).fill(TILE.empty));
  // dev levels for each tile (0..3); only meaningful for zones
  const dev  = Array.from({length:N}, () => Array(N).fill(0));

  let day = 0;
  let running = false;
  let timer = null;
  let lastTick = null;
  let hover = null;

  // cached stats
  let population = 0;
  let jobs = 0;
  let pollution = 0;
  let happiness = 50;
  let playerLevel = 1;
  let playerXp = 0;
  let growthBonus = 1;
  let buildTokens = 0;

  // ----- DOM -----
  const canvas = document.getElementById("c");
  if (!canvas) {
    console.error("Canvas #c not found. Check your HTML has <canvas id='c'>");
    return;
  }
  const ctx = canvas.getContext("2d");

  const toolSel = document.getElementById("tool");
  const runBtn = document.getElementById("run");
  const stepBtn = document.getElementById("step");
  const resetBtn = document.getElementById("reset");
  const unlockNoteEl = document.getElementById("unlock-note");
  const statusEl = document.getElementById("build-status");
  let cityName = "";

  const dayEl = document.getElementById("day");
  const popEl = document.getElementById("pop");
  const buildsLeftEl = document.getElementById("builds-left");
  const buildsLeftPill = document.getElementById("builds-left-pill");
  const jobsEl = document.getElementById("jobs");
  const happyEl = document.getElementById("happy");
  const polluteEl = document.getElementById("pollute");
  const levelEl = document.getElementById("city-level");
  const xpEl = document.getElementById("city-xp");
  const cityTitleEl = document.getElementById("city-title");

  const TOOL_UNLOCKS = {
    road: 1,
    res: 1,
    park: 2,
    com: 3,
    ind: 4,
    plaza: 3,
    school: 5,
    empty: 1,
  };
  const TILE_TO_TOOL = {
    [TILE.road]: "road",
    [TILE.res]: "res",
    [TILE.park]: "park",
    [TILE.plaza]: "plaza",
    [TILE.com]: "com",
    [TILE.ind]: "ind",
    [TILE.school]: "school",
    [TILE.empty]: "empty",
  };

  // ----- Helpers -----
  const inBounds = (x,y) => x>=0 && y>=0 && x<N && y<N;
  const neigh4 = (x,y) => [[x+1,y],[x-1,y],[x,y+1],[x,y-1]].filter(([a,b])=>inBounds(a,b));
  const neigh8 = (x,y) => {
    const out=[];
    for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++){
      if(dx===0 && dy===0) continue;
      const a=x+dx,b=y+dy;
      if(inBounds(a,b)) out.push([a,b]);
    }
    return out;
  };
  const isZone = (t) => t===TILE.res || t===TILE.com || t===TILE.ind;

  function toolToTile(v){
    return TILE[v] ?? TILE.road;
  }

  const TOOL_LABELS = {
    road: "Road",
    res: "Residential",
    park: "Park",
    plaza: "Plaza",
    com: "Commercial",
    ind: "Industrial",
    school: "School",
    empty: "Bulldoze",
  };

  // Returns null when the tile can be placed, otherwise the reason why not.
  // Bulldozing is free, so a mis-click never costs a brick to undo.
  function placementIssue(tile){
    const tool = TILE_TO_TOOL[tile];
    const requiredLevel = TOOL_UNLOCKS[tool] || 1;
    if (playerLevel < requiredLevel) {
      return `${TOOL_LABELS[tool] || tool} unlocks at city level ${requiredLevel}`;
    }
    if (tile !== TILE.empty && buildTokens <= 0) {
      return "Out of bricks - finish a focus session to earn more";
    }
    return null;
  }

  function setStatus(text, tone){
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.dataset.tone = tone || "";
  }

  function defaultStatus(){
    const tool = toolSel ? toolSel.value : "road";
    if (tool === "empty") {
      setStatus("Bulldoze is free.", "");
      return;
    }
    if (buildTokens > 0) {
      setStatus(
        `${buildTokens} brick${buildTokens === 1 ? "" : "s"} left - 1 brick per tile`,
        "",
      );
    } else {
      setStatus("Out of bricks - finish a focus session to earn more", "warn");
    }
  }

  function updateToolOptions(){
    if (!toolSel) return;
    const locked = [];
    Array.from(toolSel.options).forEach((option) => {
      if (!option.dataset.label) option.dataset.label = option.textContent;
      const unlockLevel = TOOL_UNLOCKS[option.value] || 1;
      const isLocked = playerLevel < unlockLevel;
      option.disabled = isLocked;
      option.textContent = isLocked
        ? `${option.dataset.label} (Lvl ${unlockLevel})`
        : option.dataset.label;
      if (isLocked) locked.push(`${option.dataset.label} (Lvl ${unlockLevel})`);
    });

    if (toolSel.selectedOptions.length && toolSel.selectedOptions[0].disabled) {
      toolSel.value = "road";
    }

    if (unlockNoteEl) {
      unlockNoteEl.textContent =
        locked.length > 0
          ? `Locked: ${locked.join(", ")}`
          : "All tools unlocked.";
    }
  }

  function draw(){
    const w = canvas.width, h = canvas.height;
    const cell = Math.floor(w / N);
    ctx.clearRect(0,0,w,h);

    // background grid
    ctx.fillStyle = "#07102a";
    ctx.fillRect(0,0,w,h);

    // tiles
    for(let y=0;y<N;y++){
      for(let x=0;x<N;x++){
        ctx.fillStyle = COLORS[grid[y][x]];
        ctx.fillRect(x*cell, y*cell, cell, cell);

        // dev dots
        const t = grid[y][x];
        if(isZone(t) && dev[y][x]>0){
          ctx.fillStyle = "rgba(255,255,255,.75)";
          for(let i=0;i<dev[y][x];i++){
            ctx.beginPath();
            ctx.arc(x*cell + 6 + i*8, y*cell + cell-7, 2.2, 0, Math.PI*2);
            ctx.fill();
          }
        }
      }
    }

    // grid lines
    ctx.strokeStyle = "rgba(34,50,99,.55)";
    ctx.lineWidth = 1;
    for(let i=0;i<=N;i++){
      ctx.beginPath(); ctx.moveTo(i*cell,0); ctx.lineTo(i*cell, N*cell); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,i*cell); ctx.lineTo(N*cell, i*cell); ctx.stroke();
    }

    // brush preview under the cursor: white = placeable, red = blocked
    if(hover && inBounds(hover.cx, hover.cy)){
      const span = hover.brush3 ? 3 : 1;
      const off = hover.brush3 ? 1 : 0;
      ctx.strokeStyle = placementIssue(toolToTile(toolSel.value))
        ? "rgba(251,113,133,.95)"
        : "rgba(255,255,255,.85)";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        (hover.cx - off) * cell + 1,
        (hover.cy - off) * cell + 1,
        cell * span - 2,
        cell * span - 2,
      );
    }
  }

  function updateUI(){
    dayEl.textContent = String(day);
    popEl.textContent = population.toLocaleString();
    if (buildsLeftEl) {
      buildsLeftEl.textContent = String(buildTokens);
    }
    if (buildsLeftPill) {
      buildsLeftPill.textContent = `${buildTokens} brick${buildTokens === 1 ? "" : "s"}`;
    }
    jobsEl.textContent = jobs.toLocaleString();
    happyEl.textContent = String(Math.max(0, Math.min(100, Math.round(happiness))));
    polluteEl.textContent = String(Math.max(0, Math.round(pollution)));
    if (cityTitleEl) {
      cityTitleEl.textContent = cityName || "Mini City Simulator";
    }
  }

  function serializeState(){
    return {
      grid,
      dev,
      day,
      running,
      lastTick,
      cityName,
    };
  }

  function saveState(){
    if (!window.chrome?.storage?.local) return;
    chrome.storage.local.set({ cityState: serializeState() });
  }

  function loadState(state){
    if (!state) return;
    if (Array.isArray(state.grid) && Array.isArray(state.dev)) {
      for (let y = 0; y < N; y += 1) {
        for (let x = 0; x < N; x += 1) {
          grid[y][x] = state.grid?.[y]?.[x] ?? TILE.empty;
          dev[y][x] = state.dev?.[y]?.[x] ?? 0;
        }
      }
    }
    day = Number.isFinite(state.day) ? state.day : 0;
    running = Boolean(state.running);
    lastTick = Number.isFinite(state.lastTick) ? state.lastTick : null;
    if (typeof state.cityName === "string" && state.cityName.trim()) {
      cityName = state.cityName;
    }
  }

  function resumeFromSavedTime(){
    if (!running || !lastTick) return;
    const elapsedMs = Date.now() - lastTick;
    const steps = Math.min(200, Math.floor(elapsedMs / SIM_STEP_MS));
    for (let i = 0; i < steps; i += 1) {
      simulateDay();
    }
    lastTick = Date.now();
  }

  // We'll treat "hasAdjacentRoad" as good enough for activation (simple and fun).
  function hasAdjacentRoad(x,y){
    return neigh4(x,y).some(([a,b]) => grid[b][a] === TILE.road);
  }

  function nearbyJobsScore(x,y){
    // look within radius 3 for developed com/ind
    let score = 0;
    for(let dy=-3;dy<=3;dy++){
      for(let dx=-3;dx<=3;dx++){
        const a=x+dx,b=y+dy;
        if(!inBounds(a,b)) continue;
        const t=grid[b][a];
        if(t===TILE.com || t===TILE.ind){
          const d = Math.abs(dx)+Math.abs(dy);
          const lvl = dev[b][a];
          if(lvl>0){
            score += (CAP[t][lvl] / Math.max(1,d));
          }
        }
      }
    }
    return score;
  }

  function amenityBonus(x,y){
    // amenities nearby boost happiness and reduce pollution
    let bonus = 0;
    let cleanse = 0;
    for(let dy=-2;dy<=2;dy++){
      for(let dx=-2;dx<=2;dx++){
        const a=x+dx,b=y+dy;
        if(!inBounds(a,b)) continue;
        const tile = grid[b][a];
        if(tile === TILE.park || tile === TILE.plaza || tile === TILE.school){
          const d = Math.abs(dx)+Math.abs(dy);
          const base = tile === TILE.school ? 4 : tile === TILE.plaza ? 2 : 3;
          const clean = tile === TILE.school ? 2.5 : tile === TILE.plaza ? 1.5 : 2;
          bonus += base / Math.max(1,d);
          cleanse += clean / Math.max(1,d);
        }
      }
    }
    return { bonus, cleanse };
  }

  function recomputeStats(){
    let pop=0, jb=0, pol=0;
    // zone output based on dev
    for(let y=0;y<N;y++){
      for(let x=0;x<N;x++){
        const t = grid[y][x];
        const lvl = dev[y][x];
        if(t===TILE.res) pop += CAP[t][lvl];
        if(t===TILE.com) jb  += CAP[t][lvl];
        if(t===TILE.ind){
          jb += CAP[t][lvl];
          pol += 3*lvl; // industry pollutes
        }
        if(t===TILE.road) pol += 0.15; // tiny traffic pollution
      }
    }
    // amenities reduce pollution globally a bit
    let amenities = 0;
    for(let y=0;y<N;y++) for(let x=0;x<N;x++){
      const tile = grid[y][x];
      if(tile===TILE.park) amenities += 1;
      if(tile===TILE.plaza) amenities += 0.8;
      if(tile===TILE.school) amenities += 1.2;
    }
    pol = Math.max(0, pol - amenities*1.1);

    population = Math.round(pop);
    jobs = Math.round(jb);
    pollution = pol;

    // happiness from (jobs coverage, pollution, amenities)
    const jobCoverage = population === 0 ? 1 : Math.min(1, jobs / population);
    let happy = 40 + jobCoverage*30 - Math.min(35, pollution*0.7);
    // add amenity happiness
    happy += Math.min(20, amenities*0.3);
    happiness = Math.max(0, Math.min(100, happy));
  }

  function simulateDay(){
    day++;

    // Growth logic: zones level up/down
    for(let y=0;y<N;y++){
      for(let x=0;x<N;x++){
        const t = grid[y][x];
        if(!isZone(t)) continue;

        const roadOK = hasAdjacentRoad(x,y);
        if(!roadOK){
          // decay if isolated
          if(dev[y][x] > 0 && Math.random() < 0.45) dev[y][x]--;
          continue;
        }

        if(t===TILE.res){
          const score = nearbyJobsScore(x,y);
          const { bonus } = amenityBonus(x,y);
          const want = score + bonus*2;
          const growChance =
            Math.min(0.55, 0.08 + want / 80) * (happiness / 70) * growthBonus;
          const decayChance =
            Math.max(0, 0.12 - happiness / 140) * (2 - growthBonus);

          if(dev[y][x] < 3 && Math.random() < growChance) dev[y][x]++;
          else if(dev[y][x] > 0 && Math.random() < decayChance) dev[y][x]--;
        }

        if(t===TILE.com){
          // commercial grows with population nearby
          let nearbyPop = 0;
          for(const [a,b] of neigh8(x,y)){
            if(grid[b][a]===TILE.res) nearbyPop += CAP[TILE.res][dev[b][a]];
          }
          const { bonus } = amenityBonus(x,y);
          const growChance =
            Math.min(0.5, 0.06 + nearbyPop / 250) *
            (happiness / 80) *
            (1 + bonus / 30) *
            growthBonus;
          const decayChance =
            Math.max(0, 0.10 - happiness / 160) * (2 - growthBonus);
          if(dev[y][x] < 3 && Math.random() < growChance) dev[y][x]++;
          else if(dev[y][x] > 0 && Math.random() < decayChance) dev[y][x]--;
        }

        if(t===TILE.ind){
          const recomputedUnemp = Math.max(0, population - jobs);
          const { bonus } = amenityBonus(x,y);
          const growChance =
            Math.min(0.45, 0.08 + recomputedUnemp / 400) *
            (1 + bonus / 40) *
            growthBonus;
          const decayChance =
            (0.07 + Math.min(0.12, pollution / 250)) * (2 - growthBonus);
          if(dev[y][x] < 3 && Math.random() < growChance) dev[y][x]++;
          else if(dev[y][x] > 0 && Math.random() < decayChance) dev[y][x]--;
        }
      }
    }

    recomputeStats();

    updateUI();
    draw();
    saveState();
  }

  // ----- Painting -----
  function paintCell(cx, cy, tile, brush3=false){
    let placed = 0;
    let blocked = null;

    const paintOne = (x,y) => {
      if(!inBounds(x,y)) return;

      const prev = grid[y][x];
      const next = tile;

      if(prev === next) return;

      const issue = placementIssue(next);
      if(issue){ blocked = issue; return; }

      grid[y][x] = next;
      placed += 1;
      if(next !== TILE.empty){
        buildTokens = Math.max(0, buildTokens - 1);
      }

      if(!isZone(next)) dev[y][x] = 0;
      if(isZone(next) && !isZone(prev)) dev[y][x] = 0;
    };

    if(!brush3){
      paintOne(cx,cy);
    } else {
      for(let dy=-1;dy<=1;dy++){
        for(let dx=-1;dx<=1;dx++){
          paintOne(cx+dx, cy+dy);
        }
      }
    }

    // One write per gesture instead of one per tile.
    if(placed){
      if (window.chrome?.storage?.local) {
        chrome.storage.local.set({ buildTokens });
      }
      saveState();
      defaultStatus();
    } else if(blocked){
      setStatus(blocked, "warn");
    }

    recomputeStats();
    updateUI();
    draw();
  }

  function getCellFromMouse(evt){
    const rect = canvas.getBoundingClientRect();
    const x = (evt.clientX - rect.left) * (canvas.width / rect.width);
    const y = (evt.clientY - rect.top)  * (canvas.height / rect.height);
    const cell = Math.floor(canvas.width / N);
    return { cx: Math.floor(x / cell), cy: Math.floor(y / cell) };
  }

  let dragging = false;
  function handlePaint(evt){
    const {cx,cy} = getCellFromMouse(evt);
    const tile = toolToTile(toolSel.value);
    const brush3 = evt.shiftKey;
    paintCell(cx,cy,tile,brush3);
  }

  canvas.addEventListener("mousedown", (e)=>{ dragging=true; handlePaint(e); });
  window.addEventListener("mouseup", ()=> dragging=false);
  canvas.addEventListener("mousemove", (e)=>{
    const {cx,cy} = getCellFromMouse(e);
    hover = { cx, cy, brush3: e.shiftKey };
    if(dragging) handlePaint(e);
    else draw();
  });
  canvas.addEventListener("mouseleave", ()=>{ hover = null; draw(); });

  toolSel?.addEventListener("change", ()=>{ defaultStatus(); draw(); });

  // Number keys 1-8 select a tool, in the same order as the dropdown.
  const TOOL_KEYS = ["road","res","park","plaza","com","ind","school","empty"];
  window.addEventListener("keydown", (e)=>{
    if(e.target instanceof HTMLInputElement) return;
    const index = Number.parseInt(e.key, 10) - 1;
    if(Number.isNaN(index) || index < 0 || index >= TOOL_KEYS.length) return;
    const option = Array.from(toolSel.options).find((o)=> o.value === TOOL_KEYS[index]);
    if(!option || option.disabled) return;
    toolSel.value = TOOL_KEYS[index];
    defaultStatus();
    draw();
  });

  // ----- Controls -----
  runBtn.addEventListener("click", () => {
    running = !running;
    runBtn.textContent = running ? "⏸ Pause" : "▶ Run";
    if (running) {
      lastTick = Date.now();
      timer = setInterval(() => {
        simulateDay();
        lastTick = Date.now();
      }, SIM_STEP_MS);
    } else if (timer) {
      clearInterval(timer);
      timer = null;
      saveState();
    }
  });

  stepBtn.addEventListener("click", () => simulateDay());

  resetBtn.addEventListener("click", () => {
    for(let y=0;y<N;y++){
      for(let x=0;x<N;x++){
        grid[y][x] = TILE.empty;
        dev[y][x] = 0;
      }
    }
    day = 0;
    running = false;
    lastTick = null;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (runBtn) runBtn.textContent = "▶ Run";
    recomputeStats();
    updateUI();
    draw();
    saveState();
  });

  function applyPlayerProgress(level, xp){
    playerLevel = Number.isFinite(level) ? level : 1;
    playerXp = Number.isFinite(xp) ? xp : 0;
    const xpProgress = Math.min(1, playerXp / 100);
    growthBonus = Math.min(1.6, 1 + playerLevel * 0.03 + xpProgress * 0.05);
    if (levelEl) levelEl.textContent = `City Level ${playerLevel}`;
    if (xpEl) xpEl.textContent = `XP ${playerXp}`;
    updateToolOptions();
    updateUI();
    draw();
  }

  if (window.chrome?.storage?.local) {
    chrome.storage.local.get(["level", "xp", "buildTokens"], (result) => {
      applyPlayerProgress(result.level || 1, result.xp || 0);
      if (typeof result.buildTokens === "number") {
        buildTokens = result.buildTokens;
        updateUI();
      }
      defaultStatus();
    });
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.level || changes.xp) {
        const nextLevel = changes.level?.newValue ?? playerLevel;
        const nextXp = changes.xp?.newValue ?? playerXp;
        applyPlayerProgress(nextLevel, nextXp);
      }
      if (changes.buildTokens) {
        buildTokens = changes.buildTokens.newValue || 0;
        updateUI();
        defaultStatus();
      }
      if (changes.cityName) {
        cityName = changes.cityName.newValue || "";
        updateUI();
        saveState();
      }
    });

    chrome.storage.local.get(["cityState", "cityName"], (result) => {
      if (result.cityState) {
        loadState(result.cityState);
      }
      if (typeof result.cityName === "string") {
        cityName = result.cityName;
      }
      saveState();
      resumeFromSavedTime();
      updateUI();
      draw();
      if (runBtn) {
        runBtn.textContent = running ? "⏸ Pause" : "▶ Run";
      }
      if (running) {
        timer = setInterval(() => {
          simulateDay();
          lastTick = Date.now();
        }, SIM_STEP_MS);
      }
    });
  }

  // init
  recomputeStats();
  updateUI();
  defaultStatus();
  draw();
});
