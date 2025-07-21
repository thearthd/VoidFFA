// loadout.js

const PRIMARIES = [
  { key: 'ak-47',   img: 'https://codehs.com/uploads/7aab0473bfe25a8df97fee546120aa5d' },
  { key: 'deagle',  img: 'https://codehs.com/uploads/3a742a06b29233afdce01154d0c2247d' },
  { key: 'marshal', img: 'https://codehs.com/uploads/231ea31e130955d00410d9b3d5f3a3b5' },
];
const SECONDARIES = [
  { key: 'm79',     img: 'https://codehs.com/uploads/967700dec4457f4bf0461e723d74550d' },
];

function initLoadout() {
  // Populate buttons
  populateWeaponGrid('primary-container', PRIMARIES, 'primary');
  populateWeaponGrid('secondary-container', SECONDARIES, 'secondary');

  // Load saved choices
  const saved = loadLoadout();
  if (saved.primary)   selectButton(saved.primary,   'primary');
  if (saved.secondary) selectButton(saved.secondary, 'secondary');

  // Confirm click
  document.getElementById('loadout-confirm')
    .addEventListener('click', () => {
      saveLoadout();
      hideLoadoutScreen();
      updateHUD();
    });
  
  // On startup, immediately update HUD from storage
  updateHUD();
}

function populateWeaponGrid(containerId, list, slotType) {
  const container = document.getElementById(containerId);
  list.forEach(w => {
    const btn = document.createElement('div');
    btn.className = 'weapon-button';
    btn.style.backgroundImage = `url(${w.img})`;
    btn.dataset.key = w.key;
    btn.dataset.slot = slotType;
    btn.onclick = () => {
      selectButton(w.key, slotType);
    };
    container.appendChild(btn);
  });
}

function selectButton(key, slotType) {
  // deselect others
  document.querySelectorAll(`.weapon-button[data-slot="${slotType}"]`)
    .forEach(b => b.classList.remove('selected'));
  // select this one
  const btn = document.querySelector(`.weapon-button[data-slot="${slotType}"][data-key="${key}"]`);
  if (btn) btn.classList.add('selected');
}

function loadLoadout() {
  return {
    primary:   localStorage.getItem('loadout_primary'),
    secondary: localStorage.getItem('loadout_secondary'),
  };
}

function saveLoadout() {
  const pBtn = document.querySelector('.weapon-button[data-slot="primary"].selected');
  const sBtn = document.querySelector('.weapon-button[data-slot="secondary"].selected');
  if (pBtn) localStorage.setItem('loadout_primary',   pBtn.dataset.key);
  if (sBtn) localStorage.setItem('loadout_secondary', sBtn.dataset.key);
}

function updateHUD() {
  const hud = document.getElementById('hud-weapons');
  hud.innerHTML = ''; // clear old
  const { primary, secondary } = loadLoadout();
  [primary, secondary].forEach((key, idx) => {
    if (!key) return;
    // find the image URL
    const data = (idx === 0 ? PRIMARIES : SECONDARIES).find(w => w.key === key);
    if (data) {
      const img = document.createElement('img');
      img.src = data.img;
      img.alt = key;
      img.style.width = '64px';
      img.style.height = '38px';
      hud.appendChild(img);
    }
  });
}

// simple show/hide helpers
function showLoadoutScreen() {
  document.getElementById('loadout-screen').style.display = 'block';
}
function hideLoadoutScreen() {
  document.getElementById('loadout-screen').style.display = 'none';
}

// Expose so you can call from your menu code:
window.showLoadoutScreen = showLoadoutScreen;

// Initialize once:
initLoadout();
