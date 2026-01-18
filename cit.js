document.addEventListener("DOMContentLoaded", () => {
  // ----- Config -----
  const N = 30; // grid size
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

  // cached stats
  let population = 0;
  let jobs = 0;
  let pollution = 0;
  let happiness = 50;
  let playerLevel = 1;
  let playerXp = 0;
  let growthBonus = 1;

  // ----- DOM -----
  const canvas = document.getElementById("c");
  if (!canvas) {
    console.error("Canvas #c not found. Check your HTML has <canvas id='c'>");
    return;
  }
  const ctx = canvas.getContext("2d");

  const toolSel = document.getElementById("tool");
  const stepBtn = document.getElementById("step");
  const resetBtn = document.getElementById("reset");
  const unlockNoteEl = document.getElementById("unlock-note");

  const dayEl = document.getElementById("day");
  const popEl = document.getElementById("pop");
  const jobsEl = document.getElementById("jobs");
  const happyEl = document.getElementById("happy");
  const polluteEl = document.getElementById("pollute");
  const levelEl = document.getElementById("city-level");
  const xpEl = document.getElementById("city-xp");

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
  }

  function updateUI(){
    dayEl.textContent = String(day);
    popEl.textContent = population.toLocaleString();
    jobsEl.textContent = jobs.toLocaleString();
    happyEl.textContent = String(Math.max(0, Math.min(100, Math.round(happiness))));
    polluteEl.textContent = String(Math.max(0, Math.round(pollution)));
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
  }

  // ----- Painting -----
  function paintCell(cx, cy, tile, brush3=false){
    const paintOne = (x,y) => {
      if(!inBounds(x,y)) return;

      const prev = grid[y][x];
      const next = tile;

      if(prev === next) return;

      grid[y][x] = next;

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
  canvas.addEventListener("mousemove", (e)=>{ if(dragging) handlePaint(e); });

  // ----- Controls -----
  stepBtn.addEventListener("click", () => simulateDay());

  resetBtn.addEventListener("click", () => {
    for(let y=0;y<N;y++){
      for(let x=0;x<N;x++){
        grid[y][x] = TILE.empty;
        dev[y][x] = 0;
      }
    }
    day = 0;
    recomputeStats();
    updateUI();
    draw();
  });

  function applyPlayerProgress(level, xp){
    playerLevel = Number.isFinite(level) ? level : 1;
    playerXp = Number.isFinite(xp) ? xp : 0;
    const xpProgress = Math.min(1, playerXp / 100);
    growthBonus = Math.min(1.6, 1 + playerLevel * 0.03 + xpProgress * 0.05);
    if (levelEl) levelEl.textContent = `City Level ${playerLevel}`;
    if (xpEl) xpEl.textContent = `XP ${playerXp}/100`;
    updateToolOptions();
    updateUI();
    draw();
  }

  if (window.chrome?.storage?.local) {
    chrome.storage.local.get(["level", "xp"], (result) => {
      applyPlayerProgress(result.level || 1, result.xp || 0);
    });
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.level || changes.xp) {
        const nextLevel = changes.level?.newValue ?? playerLevel;
        const nextXp = changes.xp?.newValue ?? playerXp;
        applyPlayerProgress(nextLevel, nextXp);
      }
    });
  }

  // init
  recomputeStats();
  updateUI();
  draw();
});
