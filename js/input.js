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
  isPaused: false, // Added for pause functionality f
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
  if (document.pointerLockElement !== elementToLock && !inputState.isPaused) {
    elementToLock.requestPointerLock();
  }
  // No e.preventDefault() here anymore. It's handled by specific game listeners when active.
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
  if (inputState.isPaused) {
    setPauseState(true);
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
  if (e.code === "Escape") {
    setPauseState(!inputState.isPaused);
    e.preventDefault();
    return;
  }

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
      if (!window.localPlayer || !window.localPlayer.isDead) {
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
  if (document.activeElement === chatInput) {
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
  if (document.activeElement === chatInput) {
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
  // Block context menu when pointer locked.
  if (document.pointerLockElement === elementToLock) {
    e.preventDefault();
  }
}

function onMouseMove(e) {
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

export function setPauseState(paused) {
  // Prevent redundant calls if already in the desired state
  if (inputState.isPaused === paused) {
    return;
  }

  inputState.isPaused = paused;
  if (paused) {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    // Clear all input states when paused to prevent ghost inputs.
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

    // *** Remove game-specific input listeners when paused ***
    removeGameEventListeners();
    document.removeEventListener("mousemove", onMouseMove, false); // Already in pointerlockchange, but good to be explicit.
  } else {
    // If unpausing, and if the user previously had pointer lock, try to re-acquire.
    const elementToLock = document.body;
    if (document.pointerLockElement !== elementToLock) {
      elementToLock.requestPointerLock();
    }
    // *** Re-add game-specific input listeners when unpaused ***
    addGameEventListeners();
    // mousemove will be re-added by pointerlockchange if successful
  }
}

// Function to check player's death state and manage pause
function checkPlayerDeadAndPause() {
  // Check if localPlayer exists to prevent errors
  if (window.localPlayer) {
    if (window.localPlayer.isDead && !inputState.isPaused) {
      // Player is dead and game is not paused, so pause it
      setPauseState(true);
    } else if (!window.localPlayer.isDead && inputState.isPaused) {
      // Player is no longer dead and game is paused, so unpause it
      setPauseState(false);
    }
  }
}

export function initInput() {
  // These listeners are *always* active because they control fundamental
  // aspects like pausing, chat, and initial pointer lock requests.
  // Their internal logic handles the inputState.isPaused check.
  elementToLock.addEventListener("mousedown", onMouseDownGlobal, true); // Capture phase
  document.addEventListener("pointerlockchange", onPointerLockChange);
  document.addEventListener("pointerlockerror", onPointerLockError);
  window.addEventListener("keydown", onKeyDown); // Keydown needs to be always active for Backquote and Escape
  window.addEventListener("keyup", onKeyUp); // Keyup needs to be always active for Backquote and Escape
  window.addEventListener("mousedown", onMouseDownGame); // These specific mouse listeners are removed/added
  window.addEventListener("mouseup", onMouseUpGame); // by setPauseState
  window.addEventListener("contextmenu", onContextMenu); // Context menu listener is also removed/added
  window.addEventListener("keydown", onChatKeyC); // For 'C' key to toggle chat

  // Initially add all game listeners, as the game starts unpaused
  addGameEventListeners();

  // Set up a periodic check for player death state
  setInterval(checkPlayerDeadAndPause, 100); // Check every 100 milliseconds
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
  // Only update debug cursor if not paused.
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
  // Reset mouse deltas after each frame, regardless of pause state.
  inputState.mouseDX = 0;
  inputState.mouseDY = 0;
}
