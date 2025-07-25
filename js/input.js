import { updateInventory } from "./ui.js";

const originalRequestPointerLock = Element.prototype.requestPointerLock;

Element.prototype.requestPointerLock = function() {
    console.warn('!!! Suspicious requestPointerLock called on element:', this);
    console.trace('!!! Full call stack for requestPointerLock:');
    return originalRequestPointerLock.apply(this, arguments);
};


const chatInput = document.getElementById("chat-input");
const chatContainer = document.getElementById("chat-box");
const elementToLock = document.body; // Define elementToLock globally for easier access

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
  isPaused: false, // Added for pause functionality
  wasPausedByDeath: false, // Track if the pause was due to player death
};

let debugCursor, debugX, debugY;
let debugText;

// threshold to drop spurious mouse movements
const MAX_DELTA = 200;

const DEFAULT_PRIMARY = "ak-47";
const DEFAULT_SECONDARY = "m79";

function getSavedLoadout() {
  return {
    primary: localStorage.getItem("loadout_primary") || DEFAULT_PRIMARY,
    secondary: localStorage.getItem("loadout_secondary") || DEFAULT_SECONDARY,
  };
}

let currentPlayerWeaponKey = "knife";

export function handleWeaponSwitch() {
  if (inputState.weaponSwitch !== null) {
    const newWeaponKey = inputState.weaponSwitch;

    if (newWeaponKey !== currentPlayerWeaponKey) {
      currentPlayerWeaponKey = newWeaponKey;
      updateInventory(currentPlayerWeaponKey);
      console.log(`Switched to weapon: ${currentPlayerWeaponKey}`);
    }
  }
}

// --- Event Listener Functions (now named for easy removal) ---
function onMouseDownGlobal(e) {
  if (document.activeElement === chatInput) {
    return;
  }
  // Only request pointer lock if the game is *not* currently paused by any means.
  if (document.pointerLockElement !== elementToLock && !inputState.isPaused) {
    elementToLock.requestPointerLock();
  }
}

function onPointerLockChange() {
  const locked = document.pointerLockElement === elementToLock;

  inputState.mouseDX = 0;
  inputState.mouseDY = 0;

  if (locked && !inputState.isPaused) { // Only change cursor and add mousemove if actively playing
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

function onKeyDown(e) {
  // Always allow Backquote for chat
  if (e.code === "Backquote") {
    if (document.activeElement === chatInput) {
      chatInput.blur();
    } else {
      chatInput.focus();
      // Clear movement inputs immediately when chat is opened.
      inputState.forward =
        inputState.backward =
        inputState.left =
        inputState.right =
        inputState.fire =
          false;
    }
    e.preventDefault();
    return;
  }

  // Handle Escape key for pausing/unpausing
  // If Escape should also trigger the UI (like 'P' does), uncomment this:
  /*
  if (e.code === "Escape") {
    if (window.checkInGame) { // Make sure checkInGame is accessible if needed here
        window.togglePauseMenuUI(!inputState.isPaused);
    }
    e.preventDefault();
    return;
  }
  */

  // If game is paused or chat is focused, ignore other game keys.
  if (inputState.isPaused || document.activeElement === chatInput) return;

  const { primary, secondary } = getSavedLoadout();
  let handled = true;

  switch (e.code) {
    case "KeyW":
      inputState.forward = true;
      break;
    case "KeyS":
      inputState.backward = true;
      break;
    case "KeyA":
      inputState.left = true;
      break;
    case "KeyD":
      inputState.right = true;
      break;
    case "Space":
      if (!window.localPlayer || !window.localPlayer.isDead) { // Allow jump only if not dead
        inputState.jump = true;
      }
      break;
    case "ShiftLeft":
    case "ShiftRight":
      inputState.crouch = true;
      break;
    case "KeyZ":
      inputState.slow = true;
      break;
    case "KeyR":
      inputState.reload = true;
      break;
    case "KeyE":
      inputState.aim = true;
      break;
    case "Digit1":
      inputState.weaponSwitch = "knife";
      break;
    case "Digit2":
      if (primary) inputState.weaponSwitch = primary;
      break;
    case "Digit3":
      if (secondary) inputState.weaponSwitch = secondary;
      break;
    case "KeyX":
      inputState.fire = true;
      inputState.fireJustPressed = true;
      break;
    default:
      handled = false;
  }

  if (handled) {
    e.preventDefault();
  }
}

function onKeyUp(e) {
  // Always allow Backquote for chat, or Escape to unpause (no action on keyup)
  if (e.code === "Backquote" || e.code === "Escape") return;

  // If game is paused or chat is focused, ignore other game keys.
  if (inputState.isPaused || document.activeElement === chatInput) return;

  let handled = true;
  switch (e.code) {
    case "KeyW":
      inputState.forward = false;
      break;
    case "KeyS":
      inputState.backward = false;
      break;
    case "KeyA":
      inputState.left = false;
      break;
    case "KeyD":
      inputState.right = false;
      break;
    case "Space":
      inputState.jump = false;
      break;
    case "ShiftLeft":
    case "ShiftRight":
      inputState.crouch = false;
      break;
    case "KeyZ":
      inputState.slow = false;
      break;
    case "KeyR":
      inputState.reload = false;
      break;
    case "KeyE":
      inputState.aim = false;
      break;
    case "Digit1":
    case "Digit2":
    case "Digit3":
      inputState.weaponSwitch = null;
      break;
    case "KeyX":
      inputState.fire = false;
      break;
    default:
      handled = false;
  }

  if (handled) {
    e.preventDefault();
  }
}

function onMouseDownGame(e) {
  // Do not process game input if chat is active or game is paused
  if (document.activeElement === chatInput || inputState.isPaused) {
    return;
  }
  switch (e.button) {
    case 0: // Left click
      inputState.fire = true;
      inputState.fireJustPressed = true;
      break;
    case 2: // Right click
      inputState.aim = true;
      break;
  }
  e.preventDefault(); // Crucial: Prevent default browser action like focus or selection
}

function onMouseUpGame(e) {
  // Do not process game input if chat is active or game is paused
  if (document.activeElement === chatInput || inputState.isPaused) {
    return;
  }
  switch (e.button) {
    case 0: // Left click
      inputState.fire = false;
      break;
    case 2: // Right click
      inputState.aim = false;
      break;
  }
  e.preventDefault(); // Prevent default browser action
}

function onContextMenu(e) {
  // Block context menu when pointer locked AND game is not paused
  if (document.pointerLockElement === elementToLock && !inputState.isPaused) {
    e.preventDefault();
  }
}

function onMouseMove(e) {
  // Do not process mouse movement if game is paused
  if (inputState.isPaused) return;

  if (Math.abs(e.movementX) > MAX_DELTA || Math.abs(e.movementY) > MAX_DELTA) {
    return;
  }
  inputState.mouseDX += e.movementX;
  inputState.mouseDY += e.movementY;
}

function onChatKeyC(e) {
  if (e.code === "KeyC") {
    if (document.activeElement === chatInput) {
      return;
    }
    if (chatContainer.classList.contains("hidden")) {
      chatContainer.classList.remove("hidden");
    } else {
      chatContainer.classList.add("hidden");
      chatInput.blur();
    }
    e.preventDefault();
  }
}
// --- End Event Listener Functions ---

// Store references to all active game input listeners
const gameEventListeners = [
  { target: window, event: "keydown", handler: onKeyDown },
  { target: window, event: "keyup", handler: onKeyUp },
  { target: window, event: "mousedown", handler: onMouseDownGame },
  { target: window, event: "mouseup", handler: onMouseUpGame },
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
  // If the new state and the 'byDeath' flag are already the current state, do nothing.
  // This helps prevent unnecessary state changes and potential overrides.
  if (inputState.isPaused === paused && inputState.wasPausedByDeath === byDeath) {
    return;
  }

  inputState.isPaused = paused;
  inputState.wasPausedByDeath = byDeath;

  if (paused) {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    inputState.forward = false;
    inputState.backward = false;
    inputState.left = false;
    inputState.right = false;
    inputState.crouch = false;
    inputState.slow = false;
    inputState.jump = false;
    inputState.fire = false;
    inputState.fireJustPressed = false;
    inputState.reload = false;
    inputState.aim = false;
    inputState.weaponSwitch = null;
    inputState.mouseDX = 0;
    inputState.mouseDY = 0;

    document.body.style.cursor = "default";

    removeGameEventListeners();
    document.removeEventListener("mousemove", onMouseMove, false);
  } else {
    const elementToLock = document.body;
    // Only attempt pointer lock if player is alive.
    // If the player is dead and the game is unpausing (manually), we don't try to get pointer lock.
    if (!window.localPlayer || !window.localPlayer.isDead) {
        if (document.pointerLockElement !== elementToLock) {
            elementToLock.requestPointerLock();
        }
    } else {
        // If player is dead and unpausing manually, ensure cursor is default.
        document.body.style.cursor = "default";
    }

    addGameEventListeners();
  }
}

// Function to check player's death state and manage pause
function checkPlayerDeadAndPause() {
  if (window.localPlayer) {
    if (window.localPlayer.isDead) {
      // Player is dead.
      // IF the game is NOT currently paused, OR IF it IS paused but NOT specifically by death (i.e., manually unpaused),
      // then we enforce the "paused by death" state.
      if (!inputState.isPaused || !inputState.wasPausedByDeath) {
        setPauseState(true, true); // Pause and mark as paused by death
      }
    } else {
      // Player is alive.
      // IF the game is paused AND it was paused specifically due to death, THEN unpause.
      if (inputState.isPaused && inputState.wasPausedByDeath) {
        setPauseState(false, false); // Unpause and clear the death pause flag
      }
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

  addGameEventListeners();
  setInterval(checkPlayerDeadAndPause, 100);
}

export function initDebugCursor() {
  debugCursor = document.createElement("div");
  Object.assign(debugCursor.style, {
    position: "absolute",
    width: "8px",
    height: "8px",
    background: "red",
    borderRadius: "50%",
    pointerEvents: "none",
    zIndex: 9999,
  });
  document.body.appendChild(debugCursor);

  debugText = document.createElement("div");
  Object.assign(debugText.style, {
    position: "fixed",
    top: "10px",
    left: "10px",
    padding: "4px 8px",
    background: "rgba(0,0,0,0.5)",
    color: "#0f0",
    fontFamily: "monospace",
    fontSize: "12px",
    zIndex: 9999,
    pointerEvents: "none",
  });
  document.body.appendChild(debugText);

  debugX = window.innerWidth / 2;
  debugY = window.innerHeight / 2;
  updateDebugCursor();
}

export function updateDebugCursor() {
  if (inputState.isPaused) return;

  debugX += inputState.mouseDX;
  debugY += inputState.mouseDY;

  debugX = Math.max(0, Math.min(window.innerWidth, debugX));
  debugY = Math.max(0, Math.min(window.innerHeight, debugY));

  debugCursor.style.left = debugX + "px";
  debugCursor.style.top = debugY + "px";

  debugText.innerText = `∆X: ${inputState.mouseDX}  ∆Y: ${inputState.mouseDY}\n X: ${Math.round(debugX)}  Y: ${Math.round(debugY)}`;
}

export function postFrameCleanup() {
  inputState.weaponSwitch = null;
  inputState.fireJustPressed = false;
  inputState.mouseDX = 0;
  inputState.mouseDY = 0;
}
