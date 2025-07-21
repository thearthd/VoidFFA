const DEFAULT_PRIMARY   = 'ak-47';
const DEFAULT_SECONDARY = 'm79';

const PRIMARIES = [
  { key: 'ak-47',   img: 'https://codehs.com/uploads/7aab0473bfe25a8df97fee546120aa5d' },
  { key: 'deagle',  img: 'https://codehs.com/uploads/3a742a06b29233afdce01154d0c2247d' },
  { key: 'marshal', img: 'https://codehs.com/uploads/231ea31e130955d00410d9b3d5f3a3b5' },
];
const SECONDARIES = [
  { key: 'm79',     img: 'https://codehs.com/uploads/967700dec4457f4bf0461e723d74550d' },
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
      });

      updateHUD();
    });

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
    btn.onclick = () => selectButton(w.key, slotType);
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

function updateHUD() {
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
