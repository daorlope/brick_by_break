// --- STATE VARIABLES ---
let timeLeft = 25 * 60;
let timerId = null;
let xp = 0;
let buildingsCount = 0; // Tracks city progress

// --- NAVIGATION LOGIC ---
const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view');

navItems.forEach(item => {
  item.addEventListener('click', () => {
    // Update active button
    navItems.forEach(n => n.classList.remove('active'));
    item.classList.add('active');

    // Show selected view
    const target = item.getAttribute('data-target');
    views.forEach(v => v.classList.add('hidden'));
    document.getElementById(target).classList.remove('hidden');
  });
});

// --- UPDATED XP & CITY LOGIC ---
function gainXP(amount) {
  xp += amount;
  
  if (xp >= 100) {
    xp = 0;
    buildingsCount++;
    addBuilding();
    
    // Level up visual for spirit
    const spirit = document.getElementById("spirit");
    spirit.style.transform = "scale(1.3)";
    setTimeout(() => spirit.style.transform = "scale(1)", 500);
  }
  
  xpFill.style.width = `${xp}%`;
}

function addBuilding() {
  const grid = document.getElementById("buildings-grid");
  const building = document.createElement("div");
  building.className = "building";
  
  // Varied heights for a city look
  const height = 20 + (Math.random() * 40); 
  building.style.height = `${height}px`;
  
  grid.appendChild(building);
}

// ... Keep your existing fetchCanvasTasks(), renderTasks(), 
// and updateTimer() functions as they were.