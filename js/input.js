import { updateInventory } from "./ui.js";

const chatInput = document.getElementById("chat-input");
// f
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
};

let debugCursor, debugX, debugY;
let debugText;

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
    // When pausing, *explicitly* exit pointer lock if it's active.
    // This is crucial because pressing Escape typically exits pointer lock automatically,
    // and we want our state to match the browser's state.
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    // Reset all current input states
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
  } else {
    // When unpausing, you might want to re-request pointer lock
    // This should ideally be triggered by an explicit "Resume" button click,
    // not automatically on unpause, to give the user control.
    // document.body.requestPointerLock(); // Only if you want immediate re-lock
  }
}

export function initInput() {
  const elementToLock = document.body; // Or your specific game canvas element
  const chatInput = document.getElementById("chat-input");

  // Event listener for requesting pointer lock
  // This typically happens on the first click to start the game
  /*
  elementToLock.addEventListener("mousedown", (e) => {
    // Always prevent default actions for clicks on the element meant for pointer lock
    e.preventDefault();

    // If game is paused, or chat is active, don't try to get pointer lock
    if (inputState.isPaused || document.activeElement === chatInput) {
      return;
    }

    // Only request pointer lock if it's not already active
    if (document.pointerLockElement !== elementToLock) {
      elementToLock.requestPointerLock()
        .then(() => {
          // Pointer lock successfully engaged
          // You might not need to do anything here if pointerlockchange handles it
        })
        .catch((error) => {
          // Handle cases where pointer lock request fails (e.g., user denied, security issues)
          console.warn("Pointer Lock Request Failed:", error);
          // If the error is "SecurityError: The user has exited the lock...",
          // it means the user already pressed Escape. We should not try to re-lock immediately.
          // Ensure your UI state reflects that pointer lock isn't active.
        });
    }
  });
*/
  // Event listener for changes in pointer lock status
  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === elementToLock;
    inputState.mouseDX = 0;
    inputState.mouseDY = 0;

    // We only attach/detach mousemove listener if the element we care about is locked
    // AND the game is not paused (as the cursor needs to be visible for menus).
    if (locked && !inputState.isPaused) {
      document.body.style.cursor = "none";
      document.addEventListener("mousemove", onMouseMove, false);
    } else {
      document.body.style.cursor = "default";
      document.removeEventListener("mousemove", onMouseMove, false);
      // If pointer lock is lost (e.g., by pressing Escape), and the game isn't explicitly paused,
      // it might indicate the user wants to pause or interact with a menu.
      // You could potentially trigger your pause menu here if `!inputState.isPaused`
      // and pointer lock was just lost.
      // Example: if (!inputState.isPaused) setPauseState(true);
    }
  });

  // Handle pointerlockerror (optional, but good for debugging)
  document.addEventListener("pointerlockerror", (e) => {
    console.error("Pointer Lock Error:", e);
  });

  window.addEventListener("keydown", (e) => {
    // Always allow Backquote for chat
    if (e.code === "Backquote") {
      if (document.activeElement === chatInput) {
        chatInput.blur();
      } else {
        chatInput.focus();
        inputState.forward = inputState.backward = inputState.left = inputState.right = inputState.fire = false;
      }
      e.preventDefault();
      return;
    }

    // Handle Escape key for pausing/unpausing
    if (e.code === "Escape") {
      // Toggle pause state. setPauseState will handle exiting pointer lock.
      setPauseState(!inputState.isPaused);
      e.preventDefault();
      return;
    }

    // If game is paused or chat is focused, ignore other game keys
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
  });

  window.addEventListener("keyup", (e) => {
    // Always allow Backquote for chat, or Escape (no action on keyup)
    if (e.code === "Backquote" || e.code === "Escape") return;

    // If game is paused or chat is focused, ignore other game keys
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

  window.addEventListener("mousedown", (e) => {
    // Prevent default browser actions for game-related clicks
    e.preventDefault();

    // Block game input when paused or chat is active
    if (inputState.isPaused || document.activeElement === chatInput) {
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
  });

  window.addEventListener("mouseup", (e) => {
    // Prevent default browser actions for game-related clicks
    e.preventDefault();

    // Block game input when paused or chat is active
    if (inputState.isPaused || document.activeElement === chatInput) {
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
  });
/*
  window.addEventListener("contextmenu", (e) => {
    // Prevent default context menu from appearing if pointer is locked
    // or if the game is paused (where you might have your own menu)
    if (document.pointerLockElement === elementToLock || inputState.isPaused) {
      e.preventDefault();
    }
  });
  */
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
  inputState.mouseDX = 0;
  inputState.mouseDY = 0;
}

function onMouseMove(e) {
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
