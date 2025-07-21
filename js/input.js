// js/input_with_debug.js
// Handles keyboard/mouse input with Pointer Lock, prevents snapping by filtering out implausible deltas,
// plus a visible debug cursor, numeric overlay, console logging, and cursor hide/restore on Esc.

const chatInput = document.getElementById("chat-input");

export const inputState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  crouch: false,
  slow: false,             // ← new
  jump: false,
  fire: false,
  fireJustPressed: false,
  reload: false,
  aim: false,
  weaponSwitch: null,
  mouseDX: 0,
  mouseDY: 0,
};

let debugCursor, debugX, debugY;
let debugText;

// threshold to drop spurious mouse movements
const MAX_DELTA = 200;


export function initInput() {
  const elementToLock = document.body;
  const chatInput = document.getElementById("chat-input");

  elementToLock.addEventListener("mousedown", (e) => {
    if (document.activeElement === chatInput) {
      e.preventDefault();
      return;
    }
    if (document.pointerLockElement !== elementToLock) {
      elementToLock.requestPointerLock();
    }
  });

  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === elementToLock;
   // console.log("🔒 pointerLockChange — locked?", locked);
    inputState.mouseDX = 0;
    inputState.mouseDY = 0;
    if (locked) {
      document.body.style.cursor = "none";
      document.addEventListener("mousemove", onMouseMove, false);
    } else {
      document.body.style.cursor = "default";
      document.removeEventListener("mousemove", onMouseMove, false);
    }
  });

  window.addEventListener("keydown", (e) => {
    // Toggle chat on backquote
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

    // If chat is focused, ignore game keys
    if (document.activeElement === chatInput) return;

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
        inputState.weaponSwitch = "deagle";
        break;
      case "Digit3":
        inputState.weaponSwitch = "ak-47";
        break;
      case "Digit4":
        inputState.weaponSwitch = "marshal";
        break;
      case "Digit5":
        inputState.weaponSwitch = "m79";
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
    if (document.activeElement === chatInput) return;

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
      case "Digit4":
      case "Digit5":
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
    if (document.activeElement === chatInput) {
      e.preventDefault();
      return;
    }
    switch (e.button) {
      case 0:
        inputState.fire = true;
        inputState.fireJustPressed = true;
        break;
      case 2:
        inputState.aim = true;
        break;
    }
    e.preventDefault();
  });

  window.addEventListener("mouseup", (e) => {
    if (document.activeElement === chatInput) {
      e.preventDefault();
      return;
    }
    switch (e.button) {
      case 0:
        inputState.fire = false;
        break;
      case 2:
        inputState.aim = false;
        break;
    }
    e.preventDefault();
  });

  window.addEventListener("contextmenu", (e) => {
    if (document.pointerLockElement === elementToLock) {
      e.preventDefault();
    }
  });
}

export function initDebugCursor() {
  // Debug dot
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

  // Debug text overlay
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

  // Center start
  debugX = window.innerWidth / 2;
  debugY = window.innerHeight / 2;
  updateDebugCursor();
}

export function updateDebugCursor() {
  debugX += inputState.mouseDX;
  debugY += inputState.mouseDY;

  // Clamp inside window
  debugX = Math.max(0, Math.min(window.innerWidth, debugX));
  debugY = Math.max(0, Math.min(window.innerHeight, debugY));

  // Move debug dot
  debugCursor.style.left = debugX + "px";
  debugCursor.style.top  = debugY + "px";

  // Update text with raw deltas and dot pos
  debugText.innerText =
    `∆X: ${inputState.mouseDX}  ∆Y: ${inputState.mouseDY}\n` +
    `X: ${Math.round(debugX)}  Y: ${Math.round(debugY)}`;
}

export function postFrameCleanup() {
  inputState.weaponSwitch    = null;
  inputState.fireJustPressed = false;
  inputState.mouseDX = 0;
  inputState.mouseDY = 0;
}

function onMouseMove(e) {
  // drop spurious large jumps
  if (Math.abs(e.movementX) > MAX_DELTA || Math.abs(e.movementY) > MAX_DELTA) {
   // console.warn(
   //   "Dropped spurious mouse move →",
  //    e.movementX,
  //    e.movementY
 //   );
    return;
  }
  inputState.mouseDX += e.movementX;
  inputState.mouseDY += e.movementY;
}

const chatContainer = document.getElementById("chat-box");

window.addEventListener("keydown", (e) => {
  // Prevent C from closing chat if user is currently typing
  if (e.code === "KeyC") {
    // If chat input is focused, ignore C key
    if (document.activeElement === chatInput) {
      return; // Do nothing, user is typing
    }

    // Otherwise, toggle chat UI (no focus)
    if (chatContainer.classList.contains("hidden")) {
      chatContainer.classList.remove("hidden");
    } else {
      chatContainer.classList.add("hidden");
      chatInput.blur();
    }
    e.preventDefault();
    return;
  }
});
