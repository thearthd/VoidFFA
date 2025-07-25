
import { updateInventory } from "./ui.js";

const originalRequestPointerLock = Element.prototype.requestPointerLock;
Element.prototype.requestPointerLock = function() {
  console.warn('!!! Suspicious requestPointerLock called on element:', this);
  console.trace('!!! Full call stack for requestPointerLock:');
  return originalRequestPointerLock.apply(this, arguments);
};

const chatInput = document.getElementById("chat-input");
const chatContainer = document.getElementById("chat-box");
const elementToLock = document.body;

export const inputState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  crouch: false,
  slow: false,
  jump: false,
  fire: false,
  fireJustPressed: false,
  reload: false,
  aim: false,
  weaponSwitch: null,
  mouseDX: 0,
  mouseDY: 0,
  isPaused: false,
  wasPausedByDeath: false,
};

const MAX_DELTA = 200;
const DEFAULT_PRIMARY   = "ak-47";
const DEFAULT_SECONDARY = "m79";

const DEFAULT_BINDINGS = {
  forward:  'KeyW',
  backward: 'KeyS',
  left:     'KeyA',
  right:    'KeyD',
  jump:     'Space',
  crouch:   'ShiftLeft',
  slow:     'KeyZ',
  reload:   'KeyR',
  aim:      'KeyE',
  fire:     'KeyX',
  weapon1:  'Digit1',
  weapon2:  'Digit2',
  weapon3:  'Digit3'
};
let bindings = JSON.parse(localStorage.getItem('keyBindings')) || { ...DEFAULT_BINDINGS };
function saveBindings() {
  localStorage.setItem('keyBindings', JSON.stringify(bindings));
}

function getSavedLoadout() {
  return {
    primary:   localStorage.getItem("loadout_primary")   || DEFAULT_PRIMARY,
    secondary: localStorage.getItem("loadout_secondary") || DEFAULT_SECONDARY,
  };
}

let currentPlayerWeaponKey = "knife";
export function handleWeaponSwitch() {
  if (inputState.weaponSwitch && inputState.weaponSwitch !== currentPlayerWeaponKey) {
    currentPlayerWeaponKey = inputState.weaponSwitch;
    updateInventory(currentPlayerWeaponKey);
    console.log(`Switched to weapon: ${currentPlayerWeaponKey}`);
  }
}

const actions = [
  { key: 'forward',  label: 'Move Forward' },
  { key: 'backward', label: 'Move Backward' },
  { key: 'left',     label: 'Move Left' },
  { key: 'right',    label: 'Move Right' },
  { key: 'jump',     label: 'Jump' },
  { key: 'crouch',   label: 'Crouch' },
  { key: 'slow',     label: 'Walk/Slow' },
  { key: 'reload',   label: 'Reload' },
  { key: 'aim',      label: 'Aim' },
  { key: 'fire',     label: 'Fire' },
  { key: 'weapon1',  label: 'Weapon Slot 1' },
  { key: 'weapon2',  label: 'Weapon Slot 2' },
  { key: 'weapon3',  label: 'Weapon Slot 3' }
];

export function buildKeybindUI() {
  const settingsBox = document.getElementById('settings-box');
  const container = document.createElement('div');
  container.id = 'keybinds-container';

  actions.forEach(action => {
    const row = document.createElement('div');
    row.classList.add('setting-item');
    row.innerHTML = `
      <label>${action.label}:</label>
      <span id="binding-${action.key}">${bindings[action.key]}</span>
      <button id="btn-${action.key}">Change</button>
    `;
    container.appendChild(row);
    document.getElementById(`btn-${action.key}`)
      .addEventListener('click', () => promptRebind(action.key, action.label));
  });

  const ref = document.getElementById('sensitivity-slider-container');
  settingsBox.insertBefore(container, ref);
}

function promptRebind(actionKey, actionLabel) {
  Swal.fire({
    title: `Press new key for "${actionLabel}"`,
    text: 'Listening…',
    icon: 'info',
    showCancelButton: true,
    allowOutsideClick: false,
    didOpen: () => {
      const listener = e => {
        const newCode = e.code;
        document.removeEventListener('keydown', listener, true);
        Swal.fire({
          title: `Bind "${actionLabel}" to "${newCode}"?`,
          icon: 'question',
          showCancelButton: true
        }).then(result => {
          if (result.isConfirmed) {
            bindings[actionKey] = newCode;
            saveBindings();
            document.getElementById(`binding-${actionKey}`).textContent = newCode;
            Swal.fire('Saved!', '', 'success');
          }
        });
      };
      document.addEventListener('keydown', listener, true);
    }
  });
}

function onKeyDown(e) {
  if (e.code === 'Backquote') {
    if (document.activeElement === chatInput) chatInput.blur();
    else {
      chatInput.focus();
      inputState.forward = inputState.backward = inputState.left = inputState.right = inputState.fire = false;
    }
    e.preventDefault(); return;
  }
  if (inputState.isPaused || document.activeElement === chatInput) return;

  let handled = true;
  switch (e.code) {
    case bindings.forward:   inputState.forward = true; break;
    case bindings.backward:  inputState.backward = true; break;
    case bindings.left:      inputState.left = true; break;
    case bindings.right:     inputState.right = true; break;
    case bindings.jump:
      if (!window.localPlayer?.isDead) inputState.jump = true;
      break;
    case bindings.crouch:
    case 'ShiftRight':       inputState.crouch = true; break;
    case bindings.slow:      inputState.slow = true; break;
    case bindings.reload:    inputState.reload = true; break;
    case bindings.aim:       inputState.aim = true; break;
    case bindings.fire:
      inputState.fire = true;
      inputState.fireJustPressed = true;
      break;
    case bindings.weapon1:   inputState.weaponSwitch = 'knife'; break;
    case bindings.weapon2:
      if (getSavedLoadout().primary) inputState.weaponSwitch = getSavedLoadout().primary;
      break;
    case bindings.weapon3:
      if (getSavedLoadout().secondary) inputState.weaponSwitch = getSavedLoadout().secondary;
      break;
    default: handled = false;
  }
  if (handled) e.preventDefault();
}

function onKeyUp(e) {
  if (['Backquote','Escape'].includes(e.code)) return;
  if (inputState.isPaused || document.activeElement === chatInput) return;

  let handled = true;
  switch (e.code) {
    case bindings.forward:   inputState.forward = false; break;
    case bindings.backward:  inputState.backward = false; break;
    case bindings.left:      inputState.left = false; break;
    case bindings.right:     inputState.right = false; break;
    case bindings.jump:      inputState.jump = false; break;
    case bindings.crouch:
    case 'ShiftRight':       inputState.crouch = false; break;
    case bindings.slow:      inputState.slow = false; break;
    case bindings.reload:    inputState.reload = false; break;
    case bindings.aim:       inputState.aim = false; break;
    case bindings.fire:      inputState.fire = false; break;
    case bindings.weapon1:
    case bindings.weapon2:
    case bindings.weapon3:   inputState.weaponSwitch = null; break;
    default: handled = false;
  }
  if (handled) e.preventDefault();
}

function onMouseDownGlobal(e) {
  if (document.activeElement === chatInput) return;
  if (document.pointerLockElement !== elementToLock && !inputState.isPaused) {
    elementToLock.requestPointerLock();
  }
}

function onPointerLockChange() {
  const locked = document.pointerLockElement === elementToLock;
  inputState.mouseDX = 0;
  inputState.mouseDY = 0;
  if (locked && !inputState.isPaused) {
    document.body.style.cursor = "none";
    document.addEventListener("mousemove", onMouseMove, false);
  } else {
    document.body.style.cursor = "default";
    document.removeEventListener("mousemove", onMouseMove, false);
  }
}

function onPointerLockError(e) {
  console.error("Pointer lock error:", e);
  if (!inputState.isPaused) {
    console.warn("Pointer lock error encountered while unpausing or attempting to acquire lock. Game might remain unpaused but without lock.");
  }
}

function onMouseDownGame(e) {
  if (document.activeElement === chatInput || inputState.isPaused) return;
  if (e.button === 0) { inputState.fire = true; inputState.fireJustPressed = true; }
  if (e.button === 2) { inputState.aim = true; }
  e.preventDefault();
}

function onMouseUpGame(e) {
  if (document.activeElement === chatInput || inputState.isPaused) return;
  if (e.button === 0) inputState.fire = false;
  if (e.button === 2) inputState.aim = false;
  e.preventDefault();
}

function onContextMenu(e) {
  if (document.pointerLockElement === elementToLock && !inputState.isPaused) {
    e.preventDefault();
  }
}

function onMouseMove(e) {
  if (inputState.isPaused) return;
  if (Math.abs(e.movementX) > MAX_DELTA || Math.abs(e.movementY) > MAX_DELTA) return;
  inputState.mouseDX += e.movementX;
  inputState.mouseDY += e.movementY;
}

function onChatKeyC(e) {
  if (e.code === "KeyC") {
    if (document.activeElement === chatInput) return;
    chatContainer.classList.toggle("hidden");
    if (chatContainer.classList.contains("hidden")) chatInput.blur();
    e.preventDefault();
  }
}

const gameEventListeners = [
  { target: window, event: "keydown",   handler: onKeyDown },
  { target: window, event: "keyup",     handler: onKeyUp },
  { target: window, event: "mousedown", handler: onMouseDownGame },
  { target: window, event: "mouseup",   handler: onMouseUpGame },
  { target: window, event: "contextmenu", handler: onContextMenu },
];

function addGameEventListeners() {
  gameEventListeners.forEach(({ target, event, handler }) => {
    target.addEventListener(event, handler, false);
  });
}

function removeGameEventListeners() {
  gameEventListeners.forEach(({ target, event, handler }) => {
    target.removeEventListener(event, handler, false);
  });
}

export function setPauseState(paused, byDeath = false) {
  if (inputState.isPaused === paused && inputState.wasPausedByDeath === byDeath) return;

  inputState.isPaused = paused;
  inputState.wasPausedByDeath = byDeath;

  if (paused) {
    if (document.pointerLockElement) document.exitPointerLock();
    Object.assign(inputState, {
      forward: false, backward: false, left: false, right: false,
      crouch: false, slow: false, jump: false, fire: false,
      fireJustPressed: false, reload: false, aim: false,
      weaponSwitch: null, mouseDX: 0, mouseDY: 0
    });
    document.body.style.cursor = "default";
    removeGameEventListeners();
    document.removeEventListener("mousemove", onMouseMove, false);
  } else {
    if (!window.localPlayer || !window.localPlayer.isDead) {
      if (document.pointerLockElement !== elementToLock) {
        elementToLock.requestPointerLock();
      }
    } else {
      document.body.style.cursor = "default";
    }
    addGameEventListeners();
  }
}

function checkPlayerDeadAndPause() {
  if (!window.localPlayer) return;
  if (window.localPlayer.isDead) {
    if (!inputState.isPaused || !inputState.wasPausedByDeath) {
      setPauseState(true, true);
    }
  } else {
    if (inputState.isPaused && inputState.wasPausedByDeath) {
      setPauseState(false, false);
    }
  }
}

export function initInput() {
  elementToLock.addEventListener("mousedown", onMouseDownGlobal, true);
  document.addEventListener("pointerlockchange", onPointerLockChange);
  document.addEventListener("pointerlockerror", onPointerLockError);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mousedown", onMouseDownGame);
  window.addEventListener("mouseup", onMouseUpGame);
  window.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("keydown", onChatKeyC);

  buildKeybindUI();
  addGameEventListeners();
  setInterval(checkPlayerDeadAndPause, 100);
}

export function initDebugCursor() {
  debugCursor = document.createElement("div");
  Object.assign(debugCursor.style, {
    position: "absolute", width: "8px", height: "8px",
    background: "red", borderRadius: "50%", pointerEvents: "none", zIndex: 9999,
  });
  document.body.appendChild(debugCursor);

  debugText = document.createElement("div");
  Object.assign(debugText.style, {
    position: "fixed", top: "10px", left: "10px",
    padding: "4px 8px", background: "rgba(0,0,0,0.5)",
    color: "#0f0", fontFamily: "monospace", fontSize: "12px",
    zIndex: 9999, pointerEvents: "none",
  });
  document.body.appendChild(debugText);

  debugX = window.innerWidth / 2;
  debugY = window.innerHeight / 2;
  updateDebugCursor();
}

export function updateDebugCursor() {
  if (inputState.isPaused) return;
  debugX = Math.max(0, Math.min(window.innerWidth,  debugX + inputState.mouseDX));
  debugY = Math.max(0, Math.min(window.innerHeight, debugY + inputState.mouseDY));
  debugCursor.style.left = debugX + "px";
  debugCursor.style.top  = debugY + "px";
  debugText.innerText = `∆X: ${inputState.mouseDX}  ∆Y: ${inputState.mouseDY}\n X: ${Math.round(debugX)}  Y: ${Math.round(debugY)}`;
}

export function postFrameCleanup() {
  inputState.weaponSwitch   = null;
  inputState.fireJustPressed = false;
  inputState.mouseDX = 0;
  inputState.mouseDY = 0;
}
