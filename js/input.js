import { updateInventory } from "./ui.js";

const chatInput = document.getElementById("chat-input");

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
};

let debugCursor, debugX, debugY;
let debugText;

// threshold to drop spurious mouse movements
const MAX_DELTA = 200;

const DEFAULT_PRIMARY = 'ak-47';
const DEFAULT_SECONDARY = 'm79';

function getSavedLoadout() {
  return {
    primary: localStorage.getItem('loadout_primary') || DEFAULT_PRIMARY,
    secondary: localStorage.getItem('loadout_secondary') || DEFAULT_SECONDARY,
  };
}

let currentPlayerWeaponKey = 'knife';

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

export function setPauseState(paused) {
  inputState.isPaused = paused;
  if (paused) {
    // Normal Reason: Ensure pointer lock is always exited when pausing.
    // Sometimes, the browser might not immediately release it or another part of the code
    // might have tried to re-acquire it. Explicitly call it here.
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    // Normal Reason: Clear all input states when paused to prevent ghost inputs.
    // This is already well-handled in your original code.
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

    // Normal Reason: Immediately update cursor visibility to default
    // without waiting for pointerlockchange event, for faster feedback.
    document.body.style.cursor = "default";
    document.removeEventListener("mousemove", onMouseMove, false);

  } else {
    // If unpausing, and if the user previously had pointer lock, try to re-acquire.
    // This handles scenarios where the user exits pointer lock manually during pause
    // (e.g., by pressing Esc) but then wants it back on unpause.
    const elementToLock = document.body;
    if (document.pointerLockElement !== elementToLock) {
      elementToLock.requestPointerLock();
    }
  }
}

export function initInput() {
  const elementToLock = document.body;
  const chatInput = document.getElementById("chat-input");

  // Changed to capture phase to prevent default behavior earlier,
  // potentially mitigating "crazy" reasons like rogue event listeners
  // or competing default browser actions trying to grab focus/pointer lock.
  elementToLock.addEventListener("mousedown", (e) => {
    // Normal Reason: Prevent pointer lock requests if paused.
    // Crazy Reason: Prevent any rogue script from re-locking the pointer if we're paused.
    if (inputState.isPaused) {
      e.preventDefault();
     // e.stopPropagation(); // Stop propagation to prevent any other listeners from acting
      return;
    }

    // Normal Reason: Allow chat input to function normally.
    if (document.activeElement === chatInput) {
      return;
    }

    // Normal Reason: Request pointer lock if not already locked.
    // Crazy Reason: A rapid click could trigger this while pointer lock is in a transitional state.
    // The pointerlockchange event listener will handle the actual state.
    if (document.pointerLockElement !== elementToLock) {
      elementToLock.requestPointerLock();
    }

    // Normal Reason: Prevent default browser actions (like text selection).
    e.preventDefault();
  }, true); // Use capture phase for mousedown on elementToLock

  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === elementToLock;

    // Normal Reason: Reset mouse deltas whenever pointer lock state changes
    // to prevent accumulated movement from an old lock.
    inputState.mouseDX = 0;
    inputState.mouseDY = 0;

    // Normal Reason: Only attach mousemove listener if locked AND not paused.
    // This is a key fix to ensure mouse movement stops when paused.
    if (locked && !inputState.isPaused) {
      document.body.style.cursor = "none";
      document.addEventListener("mousemove", onMouseMove, false);
    } else {
      // Normal Reason: Always restore default cursor and remove listener when not locked
      // or when paused, regardless of how pointer lock was lost.
      document.body.style.cursor = "default";
      document.removeEventListener("mousemove", onMouseMove, false);
    }
  });

  document.addEventListener("pointerlockerror", (e) => {
    console.error("Pointer lock error:", e);
    // Crazy Reason: Log errors to understand if external factors or browser quirks are preventing lock.
    // You might want to display a message to the user here.
    if (inputState.isPaused) {
        // If an error occurs while trying to acquire lock during unpause, ensure we remain in a paused state.
        setPauseState(true);
    }
  });


  window.addEventListener("keydown", (e) => {
    // Always allow Backquote for chat
    if (e.code === "Backquote") {
      if (document.activeElement === chatInput) {
        chatInput.blur();
      } else {
        chatInput.focus();
        // Normal Reason: Clear movement inputs immediately when chat is opened.
        inputState.forward = inputState.backward = inputState.left = inputState.right = inputState.fire = false;
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

    // Normal Reason: If game is paused or chat is focused, ignore other game keys.
    // This is crucial for preventing input when intended to be paused.
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
        // Normal Reason: Ensure key-based fire updates these states.
        inputState.fire = true;
        inputState.fireJustPressed = true;
        break;
      default:
        handled = false;
    }

    if (handled) {
      e.preventDefault();
    }
  });

  window.addEventListener("keyup", (e) => {
    // Always allow Backquote for chat, or Escape to unpause (no action on keyup)
    if (e.code === "Backquote" || e.code === "Escape") return;

    // Normal Reason: If game is paused or chat is focused, ignore other game keys.
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
  });

  // Using window.addEventListener for mousedown/mouseup to ensure they're caught regardless of target.
  // Normal Reason: Consistent mouse input handling.
  // Crazy Reason: Prevents any default browser actions (like context menus) from interfering.
  window.addEventListener("mousedown", (e) => {
    // Normal Reason: Block game input when paused.
    // Crazy Reason: Prevents phantom clicks from activating weapons.
    if (inputState.isPaused) {
      e.preventDefault();
      return;
    }
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
  });

  window.addEventListener("mouseup", (e) => {
    // Normal Reason: Block game input when paused.
    if (inputState.isPaused) {
      e.preventDefault(); // Prevent default browser action if click occurred while paused
      return;
    }
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
  });

  window.addEventListener("contextmenu", (e) => {
    // Normal Reason: Block context menu when paused, or when pointer locked.
    // Crazy Reason: Prevents context menu from breaking pointer lock or revealing cursor unexpectedly.
    if (inputState.isPaused || document.pointerLockElement === elementToLock) {
      e.preventDefault();
    }
  });
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
  // Normal Reason: Only update debug cursor if not paused.
  if (inputState.isPaused) return;

  debugX += inputState.mouseDX;
  debugY += inputState.mouseDY;

  debugX = Math.max(0, Math.min(window.innerWidth, debugX));
  debugY = Math.max(0, Math.min(window.innerHeight, debugY));

  debugCursor.style.left = debugX + "px";
  debugCursor.style.top = debugY + "px";

  debugText.innerText =
    `∆X: ${inputState.mouseDX}  ∆Y: ${inputState.mouseDY}\n` +
    `X: ${Math.round(debugX)}  Y: ${Math.round(debugY)}`;
}

export function postFrameCleanup() {
  inputState.weaponSwitch = null;
  inputState.fireJustPressed = false;
  // Normal Reason: Reset mouse deltas after each frame, regardless of pause state.
  // This prevents accumulation if movement happens briefly while paused or during a state change.
  inputState.mouseDX = 0;
  inputState.mouseDY = 0;
}

function onMouseMove(e) {
  // Normal Reason: Only process mouse movement if not paused.
  // Crazy Reason: Prevents spurious events when browser is in a weird state.
  if (inputState.isPaused) return;

  if (Math.abs(e.movementX) > MAX_DELTA || Math.abs(e.movementY) > MAX_DELTA) {
    return;
  }
  inputState.mouseDX += e.movementX;
  inputState.mouseDY += e.movementY;
}

const chatContainer = document.getElementById("chat-box");

window.addEventListener("keydown", (e) => {
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
});
