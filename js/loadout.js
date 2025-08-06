import { initInventory, } from "./ui.js";

const DEFAULT_PRIMARY   = 'ak-47';
const DEFAULT_SECONDARY = 'm79';

const loadoutScreen = document.getElementById('loadout-screen');
const infoPanel     = document.getElementById('weapon-info');

const PRIMARIES = [
  {
    key: 'ak-47',
    img: 'https://codehs.com/uploads/7aab0473bfe25a8df97fee546120aa5d',
    name: 'AK-47',
    bodyDamage: 30,
    headDamage: 100,
    magSize: 25,
    difficulty: 'Medium',
    description: 'The default AR.'
  },
  {
    key: 'deagle',
    img: 'https://codehs.com/uploads/3a742a06b29233afdce01154d0c2247d',
    name: 'Deagle',
    bodyDamage: 86,
    headDamage: 180,
    magSize: 8,
    difficulty: 'Hard',
    description: 'God aim days only.'
  },
  {
    key: 'marshal',
    img: 'https://codehs.com/uploads/231ea31e130955d00410d9b3d5f3a3b5',
    name: 'Marshal',
    bodyDamage: 100,
    headDamage: 250,
    magSize: 5,
    difficulty: 'Hard',
    description: 'Slow paced, secondary based.'
  },
  {
    key: 'viper',
    img: 'https://codehs.com/uploads/5a61c6c1dbc2c08d392b11d27c97930e',
    name: 'Viper',
    bodyDamage: 20,
    headDamage: 60,
    magSize: 35,
    difficulty: 'Easy',
    description: 'Spray em.'
  }
];

const SECONDARIES = [
  {
    key: 'm79',
    img: 'https://codehs.com/uploads/967700dec4457f4bf0461e723d74550d',
    name: 'M79',
    bodyDamage: 20,
    headDamage: 54,
    magSize: 12,
    difficulty: 'Easy',
    description: 'The default pistol.'
  },
  {
    key: 'legion',
    img: 'https://codehs.com/uploads/04cfb2d131578fa21a385c03c4d701cf',
    name: 'Legion',
    bodyDamage: 64,
    headDamage: 105,
    magSize: 2,
    difficulty: 'Hard',
    description: 'High risk, high reward.'
  }
];

function initLoadout() {
  populateWeaponGrid('primary-container', PRIMARIES, 'primary');
  populateWeaponGrid('secondary-container', SECONDARIES, 'secondary');

  const saved = loadLoadout();
  selectButton(saved.primary, 'primary');
  selectButton(saved.secondary, 'secondary');

  document.getElementById('loadout-confirm')
    .addEventListener('click', () => {
      saveLoadout();
      const { primary, secondary } = loadLoadout();

Swal.fire({
  title: 'Success!',
  html: `<strong>Primary:</strong> ${primary}<br><strong>Secondary:</strong> ${secondary}`,
  icon: 'success'
}).then(() => {
  updateHUD();
  initInventory(primary); // <-- this updates inventory with selected loadout
});
    });

  updateHUD();
}

function populateWeaponGrid(containerId, list, slotType) {
  const container = document.getElementById(containerId);

  list.forEach(w => {
    const btn = document.createElement('div');
    btn.className = 'weapon-button';
    btn.style.backgroundImage = `url(${w.img})`;
    btn.dataset.key  = w.key;
    btn.dataset.slot = slotType;

    // stats data-attrs
    btn.dataset.name = w.name;
    btn.dataset.body = w.bodyDamage;
    btn.dataset.head = w.headDamage;
    btn.dataset.mag  = w.magSize;
    btn.dataset.diff = w.difficulty;
    btn.dataset.desc = w.description;

    // 1) show & populate on hover enter
    btn.addEventListener('mouseenter', e => {
      fields.name.textContent = e.currentTarget.dataset.name;
      fields.body.textContent = e.currentTarget.dataset.body;
      fields.head.textContent = e.currentTarget.dataset.head;
      fields.mag.textContent  = e.currentTarget.dataset.mag;
      fields.diff.textContent = e.currentTarget.dataset.diff;
      fields.desc.textContent = e.currentTarget.dataset.desc;
      infoPanel.classList.add('visible');
    });

    // 2) update panel position on every mouse move
    btn.addEventListener('mousemove', e => {
      const rect = loadoutScreen.getBoundingClientRect();
      const x = e.clientX;
      const y = e.clientY;

    const panelHeight = infoPanel.getBoundingClientRect().height;

    // Calculate the new 'top' position to center the panel vertically on the cursor
    const newTop = y - (panelHeight);
      
      infoPanel.style.left = `${x}px`;
    infoPanel.style.top  = `${newTop}px`;
    });

    // 3) hide on hover leave
    btn.addEventListener('mouseleave', () => {
      infoPanel.classList.remove('visible');
    });

    // original click handler to select loadout…
    btn.addEventListener('click', () => selectButton(w.key, slotType));

    container.appendChild(btn);
  });
}

function selectButton(key, slotType) {
  // deselect others
  document.querySelectorAll(`.weapon-button[data-slot="${slotType}"]`)
    .forEach(b => b.classList.remove('selected'));
  // select this one
  const btn = document.querySelector(
    `.weapon-button[data-slot="${slotType}"][data-key="${key}"]`
  );
  if (btn) btn.classList.add('selected');
}

function loadLoadout() {
  // Pull from localStorage, or fall back to defaults if nothing stored
  const primary = localStorage.getItem('loadout_primary')   || DEFAULT_PRIMARY;
  const secondary = localStorage.getItem('loadout_secondary') || DEFAULT_SECONDARY;
  return { primary, secondary };
}

function saveLoadout() {
  const pBtn = document.querySelector('.weapon-button[data-slot="primary"].selected');
  const sBtn = document.querySelector('.weapon-button[data-slot="secondary"].selected');
  if (pBtn) localStorage.setItem('loadout_primary',   pBtn.dataset.key);
  if (sBtn) localStorage.setItem('loadout_secondary', sBtn.dataset.key);
}

export function updateHUD() {
  const hud = document.getElementById('hud-weapons');
  hud.innerHTML = ''; // clear old
  const { primary, secondary } = loadLoadout();
  [primary, secondary].forEach((key, idx) => {
    // find the data in the right slot array
    const data = (idx === 0 ? PRIMARIES : SECONDARIES)
                   .find(w => w.key === key);
    if (data) {
      const img = document.createElement('img');
      img.src = data.img;
      img.alt = key;
      img.style.width = '32px';
      img.style.height = '32px';
      hud.appendChild(img);
    }
  });
}

const fields = {
  name: document.getElementById('wi-name'),
  body: document.getElementById('wi-body'),
  head: document.getElementById('wi-head'),
  mag:  document.getElementById('wi-mag'),
  diff: document.getElementById('wi-diff'),
  desc: document.getElementById('wi-desc'),
};

function showWeaponInfo(e) {
  // 1) populate text
  fields.name.textContent = e.currentTarget.dataset.name;
  fields.body.textContent = e.currentTarget.dataset.body;
  fields.head.textContent = e.currentTarget.dataset.head;
  fields.mag.textContent  = e.currentTarget.dataset.mag;
  fields.diff.textContent = e.currentTarget.dataset.diff;
  fields.desc.textContent = e.currentTarget.dataset.desc;

  // 2) compute mouse pos relative to loadout-screen
  const rect = loadoutScreen.getBoundingClientRect();
  // offsetX, offsetY inside the screen:
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // 3) place panel so its bottom-left corner is at (x,y)
  infoPanel.style.left = `${x}px`;
  infoPanel.style.top  = `${y}px`;

  // 4) show it
  infoPanel.classList.add('visible');
}

function hideWeaponInfo() {
  infoPanel.classList.remove('visible');
}
// simple show/hide helpers
export function showLoadoutScreen() {
  document.getElementById('loadout-screen').style.display = 'block';
}
export function hideLoadoutScreen() {
  document.getElementById('loadout-screen').style.display = 'none';
}

// Expose so you can call from your menu code:
window.showLoadoutScreen = showLoadoutScreen;

// Initialize once:
initLoadout();
