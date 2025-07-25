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
const settingsBox = document.getElementById("settings-box"); // Get settings box element
const keybindsContainer = document.getElementById("keybinds-container"); // Container for keybind settings
const resetKeybindsBtn = document.getElementById("reset-keybinds-btn"); // Reset button

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

// --- Default Keybinds ---
const defaultKeybinds = {
    'moveForward': 'KeyW',
    'moveBackward': 'KeyS',
    'moveLeft': 'KeyA',
    'moveRight': 'KeyD',
    'jump': 'Space',
    'crouch': 'ShiftLeft',
    'slowWalk': 'KeyZ',
    'reload': 'KeyR',
    'aim': 'Mouse2', // Right-click
    'fire': 'Mouse0', // Left-click
    'weapon1': 'Digit1', // Knife
    'weapon2': 'Digit2', // Primary
    'weapon3': 'Digit3', // Secondary
    'toggleChat': 'Backquote', // Tilde key
    'toggleChatUI': 'KeyC', // Toggle chat container visibility
};

// Current active keybinds, initialized from localStorage or defaults
let currentKeybinds = {};

// --- Keybind Management Functions ---
function loadKeybinds() {
    try {
        const savedKeybinds = JSON.parse(localStorage.getItem('gameKeybinds'));
        if (savedKeybinds) {
            currentKeybinds = { ...defaultKeybinds, ...savedKeybinds };
        } else {
            currentKeybinds = { ...defaultKeybinds };
        }
    } catch (e) {
        console.error("Failed to load keybinds from localStorage, using defaults.", e);
        currentKeybinds = { ...defaultKeybinds };
    }
}

function saveKeybinds() {
    localStorage.setItem('gameKeybinds', JSON.stringify(currentKeybinds));
}

function resetKeybinds() {
    currentKeybinds = { ...defaultKeybinds };
    saveKeybinds();
    populateKeybindSettings(); // Refresh UI
    Swal.fire({
        title: 'Keybinds Reset!',
        text: 'Your keybinds have been reset to default settings.',
        icon: 'success',
        confirmButtonText: 'OK',
        customClass: {
            popup: 'swal-custom-popup',
            confirmButton: 'swal-custom-button'
        }
    });
}

// --- Populate Keybind Settings UI ---
export function populateKeybindSettings() {
    if (!keybindsContainer) return;

    keybindsContainer.innerHTML = ''; // Clear existing
    for (const action in defaultKeybinds) {
        const keybindItem = document.createElement('div');
        keybindItem.classList.add('keybind-item');

        const label = document.createElement('label');
        // Convert camelCase action to a more readable format
        label.textContent = action.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase()) + ':';

        const button = document.createElement('button');
        button.textContent = getDisplayNameForCode(currentKeybinds[action]);
        button.dataset.action = action; // Store the action in a data attribute

        button.addEventListener('click', () => startKeybindRemap(action, button));

        keybindItem.appendChild(label);
        keybindItem.appendChild(button);
        keybindsContainer.appendChild(keybindItem);
    }
}

// Helper to get a readable name for the key code
function getDisplayNameForCode(code) {
    if (code === 'Space') return 'Spacebar';
    if (code === 'ShiftLeft') return 'Left Shift';
    if (code === 'ShiftRight') return 'Right Shift';
    if (code === 'ControlLeft') return 'Left Ctrl';
    if (code === 'ControlRight') return 'Right Ctrl';
    if (code === 'AltLeft') return 'Left Alt';
    if (code === 'AltRight') return 'Right Alt';
    if (code === 'Backquote') return 'Tilde (~)';
    if (code === 'Mouse0') return 'Left Click';
    if (code === 'Mouse1') return 'Middle Click';
    if (code === 'Mouse2') return 'Right Click';
    return code; // Fallback for other codes
}

let remappingActionButton = null;
let remappingActionName = null;
let originalKeyListener = null;
let originalMouseListener = null;

function startKeybindRemap(action, button) {
    if (remappingActionButton) {
        // If already remapping another key, cancel it
        Swal.fire({
            title: 'Remapping in Progress',
            text: 'Please complete or cancel the current key remapping before starting a new one.',
            icon: 'warning',
            confirmButtonText: 'OK',
            customClass: {
                popup: 'swal-custom-popup',
                confirmButton: 'swal-custom-button'
            }
        });
        return;
    }

    remappingActionButton = button;
    remappingActionName = action;
    button.classList.add('remapping');
    button.textContent = 'Press new key...';

    // Temporarily remove game input listeners to avoid conflicts
    removeGameEventListeners();
    document.removeEventListener("mousemove", onMouseMove, false);

    originalKeyListener = window.onkeydown;
    originalMouseListener = window.onmousedown; // Capture mouse clicks for remapping

    window.onkeydown = (e) => handleRemapInput(e, 'keyboard');
    window.onmousedown = (e) => handleRemapInput(e, 'mouse');

    // Show a SweetAlert to guide the user and allow cancellation
    Swal.fire({
        title: `Remapping "${action.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase())}"`,
        html: 'Press the new key or mouse button for this action.<br>Press **Escape** to cancel.',
        icon: 'info',
        showCancelButton: true,
        showConfirmButton: false,
        allowOutsideClick: false,
        allowEscapeKey: false, // Handle escape manually
        customClass: {
            popup: 'swal-custom-popup',
            cancelButton: 'swal-custom-button'
        },
        didOpen: (popup) => {
            const cancelButton = Swal.getCancelButton();
            if (cancelButton) {
                cancelButton.onclick = () => {
                    cancelRemap();
                    Swal.close();
                };
            }
            // Add a global escape listener specific to the Swal
            const escapeListener = (e) => {
                if (e.code === 'Escape') {
                    cancelRemap();
                    Swal.close();
                    document.removeEventListener('keydown', escapeListener); // Remove self
                }
            };
            document.addEventListener('keydown', escapeListener);
        }
    }).then((result) => {
        if (result.dismiss === Swal.DismissReason.cancel) {
            cancelRemap(); // This is redundant if cancelRemap is called by the button, but good for direct dismiss.
        }
    });
}

function handleRemapInput(e, type) {
    e.preventDefault();
    e.stopPropagation(); // Stop propagation to prevent game input from processing

    let newKeyCode = '';
    if (type === 'keyboard') {
        if (e.code === 'Escape') {
            cancelRemap();
            Swal.close(); // Close the SweetAlert manually
            return;
        }
        newKeyCode = e.code;
    } else if (type === 'mouse') {
        newKeyCode = `Mouse${e.button}`;
    }

    // Check for conflicts
    const conflictingAction = Object.keys(currentKeybinds).find(
        (action) => currentKeybinds[action] === newKeyCode && action !== remappingActionName
    );

    if (conflictingAction) {
        Swal.fire({
            title: 'Key Already Bound!',
            html: `"${getDisplayNameForCode(newKeyCode)}" is already bound to "${conflictingAction.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase())}".<br>Do you want to reassign it?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Yes, Reassign',
            cancelButtonText: 'No, Keep Current',
            customClass: {
                popup: 'swal-custom-popup',
                confirmButton: 'swal-custom-button',
                cancelButton: 'swal-custom-button'
            }
        }).then((result) => {
            if (result.isConfirmed) {
                // Remove the key from the old action
                currentKeybinds[conflictingAction] = ''; // Or some other placeholder like 'None'
                updateKeybindAndFinish(newKeyCode);
            } else {
                cancelRemap();
            }
            Swal.close();
        });
    } else {
        updateKeybindAndFinish(newKeyCode);
        Swal.close();
    }
}

function updateKeybindAndFinish(newKeyCode) {
    if (remappingActionName && remappingActionButton) {
        currentKeybinds[remappingActionName] = newKeyCode;
        saveKeybinds();
        remappingActionButton.textContent = getDisplayNameForCode(newKeyCode);
        remappingActionButton.classList.remove('remapping');
    }
    resetRemapState();
    populateKeybindSettings(); // Refresh UI to reflect changes
    Swal.fire({
        title: 'Keybind Updated!',
        text: `"${remappingActionName.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase())}" is now bound to "${getDisplayNameForCode(newKeyCode)}".`,
        icon: 'success',
        timer: 1500,
        showConfirmButton: false,
        customClass: {
            popup: 'swal-custom-popup',
        }
    });
}


function cancelRemap() {
    if (remappingActionButton) {
        remappingActionButton.textContent = getDisplayNameForCode(currentKeybinds[remappingActionName]);
        remappingActionButton.classList.remove('remapping');
        Swal.fire({
            title: 'Remapping Cancelled',
            text: 'The key remapping operation has been cancelled.',
            icon: 'info',
            timer: 1500,
            showConfirmButton: false,
            customClass: {
                popup: 'swal-custom-popup',
            }
        });
    }
    resetRemapState();
}

function resetRemapState() {
    remappingActionButton = null;
    remappingActionName = null;

    if (originalKeyListener) {
        window.onkeydown = originalKeyListener;
        originalKeyListener = null;
    }
    if (originalMouseListener) {
        window.onmousedown = originalMouseListener;
        originalMouseListener = null;
    }

    // Re-add game input listeners
    addGameEventListeners();
    // Re-add mousemove listener if pointer is locked and not paused
    if (document.pointerLockElement === elementToLock && !inputState.isPaused) {
        document.addEventListener("mousemove", onMouseMove, false);
    }
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
  // Always allow Backquote for chat, using its customized keybind
  if (e.code === currentKeybinds.toggleChat) {
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

  // If game is paused or chat is focused, ignore other game keys.
  if (inputState.isPaused || document.activeElement === chatInput) return;

  const { primary, secondary } = getSavedLoadout();
  let handled = true;

  // Use currentKeybinds for comparison
  switch (e.code) {
    case currentKeybinds.moveForward:
      inputState.forward = true;
      break;
    case currentKeybinds.moveBackward:
      inputState.backward = true;
      break;
    case currentKeybinds.moveLeft:
      inputState.left = true;
      break;
    case currentKeybinds.moveRight:
      inputState.right = true;
      break;
    case currentKeybinds.jump:
      if (!window.localPlayer || !window.localPlayer.isDead) { // Allow jump only if not dead
        inputState.jump = true;
      }
      break;
    case currentKeybinds.crouch:
      inputState.crouch = true;
      break;
    case currentKeybinds.slowWalk:
      inputState.slow = true;
      break;
    case currentKeybinds.reload:
      inputState.reload = true;
      break;
    case currentKeybinds.weapon1:
      inputState.weaponSwitch = "knife";
      break;
    case currentKeybinds.weapon2:
      if (primary) inputState.weaponSwitch = primary;
      break;
    case currentKeybinds.weapon3:
      if (secondary) inputState.weaponSwitch = secondary;
      break;
    // Aim and Fire are primarily mouse-driven, but could have keyboard binds too.
    // We'll prioritize mouse for these in onMouseDownGame.
    default:
      handled = false;
  }

  if (handled) {
    e.preventDefault();
  }
}

function onKeyUp(e) {
  // Always allow Backquote for chat, or Escape to unpause (no action on keyup)
  if (e.code === currentKeybinds.toggleChat || e.code === "Escape") return;

  // If game is paused or chat is focused, ignore other game keys.
  if (inputState.isPaused || document.activeElement === chatInput) return;

  let handled = true;
  // Use currentKeybinds for comparison
  switch (e.code) {
    case currentKeybinds.moveForward:
      inputState.forward = false;
      break;
    case currentKeybinds.moveBackward:
      inputState.backward = false;
      break;
    case currentKeybinds.moveLeft:
      inputState.left = false;
      break;
    case currentKeybinds.moveRight:
      inputState.right = false;
      break;
    case currentKeybinds.jump:
      inputState.jump = false;
      break;
    case currentKeybinds.crouch:
      inputState.crouch = false;
      break;
    case currentKeybinds.slowWalk:
      inputState.slow = false;
      break;
    case currentKeybinds.reload:
      inputState.reload = false;
      break;
    case currentKeybinds.weapon1:
    case currentKeybinds.weapon2:
    case currentKeybinds.weapon3:
      inputState.weaponSwitch = null;
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

  // Use currentKeybinds for mouse clicks
  const mouseCode = `Mouse${e.button}`;
  if (mouseCode === currentKeybinds.fire) {
    inputState.fire = true;
    inputState.fireJustPressed = true;
  } else if (mouseCode === currentKeybinds.aim) {
    inputState.aim = true;
  }
  e.preventDefault(); // Crucial: Prevent default browser action like focus or selection
}

function onMouseUpGame(e) {
  // Do not process game input if chat is active or game is paused
  if (document.activeElement === chatInput || inputState.isPaused) {
    return;
  }

  // Use currentKeybinds for mouse clicks
  const mouseCode = `Mouse${e.button}`;
  if (mouseCode === currentKeybinds.fire) {
    inputState.fire = false;
  } else if (mouseCode === currentKeybinds.aim) {
    inputState.aim = false;
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
  // Use customizable key for toggling chat UI
  if (e.code === currentKeybinds.toggleChatUI) {
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
  loadKeybinds(); // Load keybinds at startup
  populateKeybindSettings(); // Populate the settings UI

  elementToLock.addEventListener("mousedown", onMouseDownGlobal, true);
  document.addEventListener("pointerlockchange", onPointerLockChange);
  document.addEventListener("pointerlockerror", onPointerLockError);
  // These are handled by addGameEventListeners/removeGameEventListeners based on pause state
  // window.addEventListener("keydown", onKeyDown);
  // window.addEventListener("keyup", onKeyUp);
  // window.addEventListener("mousedown", onMouseDownGame);
  // window.addEventListener("mouseup", onMouseUpGame);
  // window.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("keydown", onChatKeyC); // Chat toggle always active

  addGameEventListeners(); // Add initial game event listeners
  setInterval(checkPlayerDeadAndPause, 100);

  // Event listener for resetting keybinds button
  if (resetKeybindsBtn) {
      resetKeybindsBtn.addEventListener('click', () => {
          Swal.fire({
              title: 'Are you sure?',
              text: "This will reset all your keybinds to their default settings.",
              icon: 'warning',
              showCancelButton: true,
              confirmButtonColor: '#d33',
              cancelButtonColor: '#3085d6',
              confirmButtonText: 'Yes, reset them!',
              customClass: {
                popup: 'swal-custom-popup',
                confirmButton: 'swal-custom-button',
                cancelButton: 'swal-custom-button'
              }
          }).then((result) => {
              if (result.isConfirmed) {
                  resetKeybinds();
              }
          });
      });
  }
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

function getSavedLoadout() {
    return {
      primary: localStorage.getItem("loadout_primary") || DEFAULT_PRIMARY,
      secondary: localStorage.getItem("loadout_secondary") || DEFAULT_SECONDARY,
    };
  }

// Existing settingsButtonHit function (assuming it's in a separate file or accessible)
// If this function is intended to be called when the settings button is hit from your main menu,
// ensure `settingsBox` is correctly referenced.
// Example:
// function settingsButtonHit() {
//     clearMenuCanvas(); // Assuming this clears other UI
//     // Assuming `settingsMenu` is a variable representing the settings UI container
//     // If settingsBox is already your primary settings UI, you can just show it.
//     if (settingsBox) {
//         settingsBox.classList.remove('hidden'); // Or set style.display = 'flex'
//         populateKeybindSettings(); // Ensure keybinds are up-to-date when showing settings
//     }
//     // If you have a separate menu system (like 'add(settingsMenu)'), adapt this part.
//     // For now, assuming settingsBox is the direct target.
//     addBackButton(menu); // Keep the back button to return to the main menu
// }
