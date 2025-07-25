import { updateInventory } from "./ui.js";

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

// onMouseDownGlobal no longer requests pointer lock
function onMouseDownGlobal(e) {
    if (document.activeElement === chatInput) {
        return;
    }
    // No pointer lock request here
    // No e.preventDefault() here anymore. It's handled by specific game listeners when active.
}

// Removed onPointerLockChange and onPointerLockError functions entirely

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
    // Context menu is no longer explicitly blocked by pointer lock,
    // but we can still prevent it if you want the game to always handle right click.
    e.preventDefault();
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
    { target: document, event: "mousemove", handler: onMouseMove }, // Mousemove always active for general mouse input
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
    inputState.isPaused = paused;
    if (paused) {
        // No document.exitPointerLock();
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

        // Remove game-specific input listeners when paused
        removeGameEventListeners();
        // onMouseMove is now part of gameEventListeners, so removing it explicitly here is redundant.
    } else {
        // If unpausing, we no longer try to re-acquire pointer lock.
        // No elementToLock.requestPointerLock();
        // Re-add game-specific input listeners when unpaused
        addGameEventListeners();
        // mousemove is re-added by addGameEventListeners
    }
}

export function initInput() {
    // These listeners are *always* active because they control fundamental
    // aspects like pausing, chat, and initial interaction.
    // Their internal logic handles the `inputState.isPaused` check.
    // The mousedown on elementToLock is still here, but it no longer requests pointer lock.
    elementToLock.addEventListener("mousedown", onMouseDownGlobal, true); // Capture phase
    // Removed pointerlockchange and pointerlockerror listeners

    // These specific mouse/keyboard listeners are now managed by add/removeGameEventListeners.
    // initInput will initially add them via addGameEventListeners().
    window.addEventListener("keydown", onChatKeyC); // For 'C' key to toggle chat

    // Initially add all game listeners, as the game starts unpaused
    addGameEventListeners();
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

    debugText.innerText =
        `∆X: ${inputState.mouseDX}  ∆Y: ${inputState.mouseDY}\n` +
        `X: ${Math.round(debugX)}  Y: ${Math.round(debugY)}`;
}

export function postFrameCleanup() {
    inputState.weaponSwitch = null;
    inputState.fireJustPressed = false;
    // Reset mouse deltas after each frame, regardless of pause state.
    inputState.mouseDX = 0;
    inputState.mouseDY = 0;
}
