// js/game.js

import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

import { EffectComposer } from "https://cdn.jsdelivr.net/npm/three@0.152.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass }     from "https://cdn.jsdelivr.net/npm/three@0.152.0/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://cdn.jsdelivr.net/npm/three@0.152.0/examples/jsm/postprocessing/UnrealBloomPass.js";

import { ShaderPass } from "https://cdn.jsdelivr.net/npm/three@0.152.0/examples/jsm/postprocessing/ShaderPass.js";
import { CopyShader } from "https://cdn.jsdelivr.net/npm/three@0.152.0/examples/jsm/shaders/CopyShader.js";
import Stats from 'stats.js';
import { dbRefs, disposeGame, fullCleanup, activeGameId } from "./network.js";

import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
    computeBoundsTree,
    disposeBoundsTree,
    acceleratedRaycast,
    MeshBVH, // <--- Added MeshBVH import
    MeshBVHHelper,
    StaticGeometryGenerator
} from 'https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.9.1/+esm';

// fffff
// ─── BVH Setup ────────────────────────────────────────────────────────────
// Extend THREE.BufferGeometry and THREE.Mesh prototypes for BVH functionality
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

import { createSigmaCity } from "./map.js";
import { createCrocodilosConstruction } from "./map.js";

import { initNetwork, sendPlayerUpdate, localPlayerId, remotePlayers, updateHealth, updateShield, initializeAudioManager, startSoundListener, disconnectPlayer } from "./network.js";
import { claimGameSlot, releaseGameSlot } from './firebase-config.js';
import { initMenuUI } from "./menu.js";
import {
initChatUI,
addChatMessage,
updateKillFeed,
updateScoreboard,
initBulletHoles,
initInventory,
updateInventory,
initAmmoDisplay,
updateAmmoDisplay,
createHealthBar,
updateHealthShieldUI,
createTracer
} from "./ui.js";

import { usersRef } from './firebase-config.js';

import { initInput, inputState, postFrameCleanup } from "./input.js";
import { PhysicsController } from "./physics.js";
import { WeaponController, _prototypeModels, getWeaponModel, activeTracers }  from "./weapons.js";
let detailsEnabled;
let renderPass;
const bodyColor = Math.floor(Math.random() * 0xffffff);

const FIXED_WIDTH  = 1920;
const FIXED_HEIGHT = 1080;



let scene, camera, renderer, composer, bloomPass, fog;
window.camera = window.camera || new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
window.scene = window.scene || new THREE.Scene();


// f
let dirLight, hemi;
let localPlayer = null;
let physicsController;
let weaponController;
let spawnPoints = [];
let skyMesh, starField;

const KILLSTREAK_SOUNDS = {
1:  'https://codehs.com/uploads/5626b4ea9d389c0936a1971b1f3a6beb',
2:  'https://codehs.com/uploads/3b7b1aa5c4a9f532aa16ac0d7f4ffdb5',
3:  'https://codehs.com/uploads/81976fee406a0346b5b75de70c7e2c0e',
4:  'https://codehs.com/uploads/b337a894983ddc58e778bdb76eb0efe4',
5:  'https://codehs.com/uploads/03edb8ea396418fbc3630d1262c7e991',
6:  'https://codehs.com/uploads/413cb56b57597f40aa223dc6488eecca',
7:  'https://codehs.com/uploads/f4bca7128545c430257bc59d0c169e45',
8:  'https://codehs.com/uploads/373998fa75359ae1ca6462fe1b023bf7',
9:  'https://codehs.com/uploads/bac5a38abad4d17c00f7adf629af9063',
10: 'https://codehs.com/uploads/c2645a73d7b76fa17634d8a4f2ffd15a'
};
let chatInput;
let respawnOverlay = null;
let respawnButton  = null;
let fadeOverlay    = null;
let playersKillsListener = null;
let sceneNum = 0;

let deathTheme = new Audio("https://codehs.com/uploads/720078943b931e7eb258b01fb10f1fba");
deathTheme.loop = true;
deathTheme.volume = 0.5;

const windSound = new Audio(
"https://codehs.com/uploads/91aa5e56fc63838b4bdc06f596849daa"
);
windSound.loop   = true;
windSound.volume = 0.1;

const forestNoise = new Audio(
"https://codehs.com/uploads/e26ad4fc80829f48ecd9b470fe84987d"
);
forestNoise.loop   = true;
forestNoise.volume = 0.15;


const bulletHoleMeshes = {};

const initialPlayerHealth = 100;
const initialPlayerShield = 50;
const initialPlayerWeapon = "knife";

window.remotePlayers = {};
window.collidables    = [];
window.envMeshes      = [];

let chatPruneInterval       = null;
let killsPruneInterval      = null;
let activeRecoils           = [];
let weaponAmmo              = {};
let playerVisibilityTimeouts = {};

let playersRef = null;
let chatRef = null;
let killsRef = null;
let mapStateRef = null;
let gameConfigRef  = null;    // ← add this


let gameEndTime   = null;   // will be fetched from gameConfigRef
let gameInterval  = null;   // ID returned by setInterval()




export function initGlobalFogAndShadowParams() {

  window.originalFogParams = {

    type:    "exp2",

    color:   0x888888,

    density: 0.015

  };

}

function createFog() {
const fp = originalFogParams;
if (fp.type === "exp2") {
window.scene.fog = new THREE.FogExp2(fp.color, fp.density);
} else if (fp.type === "linear") {
window.scene.fog = new THREE.Fog(fp.color, fp.near, fp.far);
} else {
window.scene.fog = null; // No fog
}
}

function destroyFog() {
window.scene.fog = null;
}




function enableShadows() {
if (!dirLight) {
dirLight = new THREE.DirectionalLight(0xffffff, 0.8); // Color, intensity
dirLight.position.set(50, 200, 100); // Position the light
dirLight.castShadow = true;

// Shadow map settings (adjust resolution and camera frustum for your scene)
dirLight.shadow.mapSize.width = 2048; // Higher resolution for better shadows
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 500; // Far plane for shadow camera
dirLight.shadow.camera.left = -200;
dirLight.shadow.camera.right = 200;
dirLight.shadow.camera.top = 200;
dirLight.shadow.camera.bottom = -200;
// dirLight.shadow.bias = -0.001; // Adjust bias to fight shadow acne if needed

window.scene.add(dirLight);
}
dirLight.castShadow = true; // Ensure castShadow is true
if (renderer) { // Check if renderer is initialized
renderer.shadowMap.enabled = true;
}
}

function disableShadows() {
if (dirLight) {
dirLight.castShadow = false; // Disable casting
window.scene.remove(dirLight); // Remove from scene
dirLight.dispose(); // Release resources
dirLight = null; // Set to null for re-creation
}
if (renderer) { // Check if renderer is initialized
renderer.shadowMap.enabled = false;
}
}

function createBloom() {
// Ensure composer and renderPass are initialized
if (!composer || !renderPass) {
console.warn("Composer or RenderPass not initialized. Cannot create Bloom.");
return;
}
if (!bloomPass) { // Only create if it doesn't exist
bloomPass = new UnrealBloomPass(
new THREE.Vector2(window.innerWidth, window.innerHeight), // Use window dimensions for bloom
originalBloomStrength, // Use the stored original strength
1, // Radius
0.6 // Threshold
);
composer.addPass(bloomPass);
}
}

function destroyBloom() {
if (bloomPass && composer) {
composer.removePass(bloomPass);
bloomPass.dispose(); // Release resources
bloomPass = null;
}
}

async function determineWinnerAndEndGame() {
  console.log("Determining winner and ending game...");

  if (!playersRef) {
    console.error("determineWinnerAndEndGame: playersRef is NULL");
    return;
  }

  // 1) Pull all players’ final stats
  const playersSnapshot = await playersRef.once("value");
  let winner = { username: "No one", kills: -1, deaths: 0 };
  const statsByUser = {};

  playersSnapshot.forEach(childSnap => {
    const p = childSnap.val();
    if (!p || typeof p.kills !== 'number') return;
    statsByUser[p.username] = {
      kills: p.kills || 0,
      deaths: p.deaths || 0,
      win: 0,
      loss: 0
    };
    if (p.kills > winner.kills) {
      winner = { username: p.username, kills: p.kills, deaths: p.deaths || 0 };
    }
  });

  // 2) Mark wins/losses
  Object.entries(statsByUser).forEach(([username, stats]) => {
    if (username === winner.username) {
      stats.win = 1;
    } else {
      stats.loss = 1;
    }
  });

  // 3) Store winner in localStorage & UI
  console.log(`WINNER: ${winner.username} (${winner.kills} kills, ${winner.deaths} deaths)`);
  localStorage.setItem('gameWinner', JSON.stringify(winner));
  localStorage.setItem('gameEndedTimestamp', Date.now().toString());
  const gameTimerEl = document.getElementById("game-timer");
  if (gameTimerEl) {
    gameTimerEl.textContent = `WINNER: ${winner.username}`;
    gameTimerEl.style.display = "block";
  }

  // 4) Update user stats: wins and losses
  const statUpdates = [];
  for (const [username, { win, loss }] of Object.entries(statsByUser)) {
    if (win === 1) {
      statUpdates.push(incrementUserStat(username, 'wins', 1));
    }
    if (loss === 1) {
      statUpdates.push(incrementUserStat(username, 'losses', 1));
    }
  }
  await Promise.all(statUpdates);

  try {
    // remove the entire gameConfig node
    await gameConfigRef.remove();
    console.log("Game config fully removed.");
  } catch (e) {
    console.error("Failed to remove gameConfig:", e);
  }
    
  // 5) Detach realtime listener
  if (playersKillsListener) {
    playersRef.off("value", playersKillsListener);
    playersKillsListener = null;
    console.log("Detached players kill listener.");
  }



    
  // 7) Finally, clean up game resources
  await disposeGame();
  await fullCleanup(activeGameId);

    playerIdsToDisconnect.forEach(id => disconnectPlayer(id));
}


window.determineWinnerAndEndGame = determineWinnerAndEndGame;

document.addEventListener('DOMContentLoaded', () => {
    const storedWinner = localStorage.getItem('gameWinner');
    const storedTimestamp = localStorage.getItem('gameEndedTimestamp');

    if (storedWinner) {
        try {
            const winner = JSON.parse(storedWinner);
            console.log("GAME OVER! Winner found from previous session:");
            console.log(`Username: ${winner.username}, Kills: ${winner.kills}`);

            // You can also display this on your UI now, e.g.:
            const gameOverMessageElement = document.getElementById('game-over-message'); // You'd need to create this element in your HTML
            if (gameOverMessageElement) {
                gameOverMessageElement.textContent = `Game Over! Winner: ${winner.username} with ${winner.kills} kills!`;
                gameOverMessageElement.style.display = 'block'; // Make sure it's visible
            }

            // Clean up localStorage so the message doesn't reappear on subsequent normal loads
            localStorage.removeItem('gameWinner');
            localStorage.removeItem('gameEndedTimestamp');

        } catch (e) {
            console.error("Error parsing stored winner data from localStorage:", e);
            localStorage.removeItem('gameWinner'); // Clear corrupted data
            localStorage.removeItem('gameEndedTimestamp');
        }
    }
});


function createStars() {
if (sceneNum !== 1) return; // Only create for CrocodilosConstruction

console.log("Creating stars for CrocodilosConstruction...");
if (starField) return; // Already created

const starCount = 1000;
const positions = new Float32Array(starCount * 3);

for (let i = 0; i < starCount; i++) {
const theta = Math.random() * 2 * Math.PI;
const phi = Math.acos(2 * Math.random() - 1);
const r = 90 + Math.random() * 100;

positions[3 * i] = r * Math.sin(phi) * Math.cos(theta);
positions[3 * i + 1] = r * Math.sin(phi) * Math.sin(theta);
positions[3 * i + 2] = r * Math.cos(phi);
}

const starsGeo = new THREE.BufferGeometry().setAttribute(
"position",
new THREE.BufferAttribute(positions, 3)
);
const starsMat = new THREE.PointsMaterial({
color: 0xeeeeff,
size: 0.5,
sizeAttenuation: true,
fog: false // Stars should ignore fog
});
starField = new THREE.Points(starsGeo, starsMat);
scene.add(starField);
}

/**
* Destroys the stars specifically for CrocodilosConstruction.
*/
function destroyStars() {
if (starField) {
console.log("Destroying stars for CrocodilosConstruction...");
scene.remove(starField);
starField.geometry.dispose();
starField.material.dispose();
starField = null;
}
}

/**
* Creates the fog dots specifically for CrocodilosConstruction.
*/
function createFogDots() {
if (sceneNum !== 1) return; // Only create for CrocodilosConstruction

console.log("Creating fog dots for CrocodilosConstruction...");
if (worldFog) return; // Already created

const BOUNDS = { x: 100, y: 20, z: 100 };
const fogCount = 5000;
const fogGeo = new THREE.BufferGeometry();
const pos = new Float32Array(fogCount * 3);

for (let i = 0; i < fogCount; i++) {
pos[3 * i] = (Math.random() * 2 - 1) * BOUNDS.x;
pos[3 * i + 1] = Math.random() * BOUNDS.y;
pos[3 * i + 2] = (Math.random() * 2 - 1) * BOUNDS.z;
}

fogGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
const fogMat = new THREE.PointsMaterial({
color: 0xcccccc,
size: 0.2,
transparent: true,
opacity: 0.3,
sizeAttenuation: true,
fog: true // Fog dots should be affected by fog
});
worldFog = new THREE.Points(fogGeo, fogMat);
scene.add(worldFog);
window.worldFog = worldFog; // Keep window.worldFog updated
}

/**
* Destroys the fog dots specifically for CrocodilosConstruction.
*/
function destroyFogDots() {
if (worldFog) {
console.log("Destroying fog dots for CrocodilosConstruction...");
scene.remove(worldFog);
worldFog.geometry.dispose();
worldFog.material.dispose();
worldFog = null;
}
}

// --- Main toggle function (exported for main.js to call) ---

/**
* Toggles the creation/destruction of scene details like fog, shadows, bloom, stars, and fog dots.
* This function is now intelligent about which scene is active.
* @param {boolean} isOn - True to enable details, false to disable.
*/
export function toggleSceneDetails(isOn) {
if (isOn !== detailsEnabled) {
detailsEnabled = isOn; // Update internal state

if (isOn) {
console.log("Enabling scene details...");
// Universal details
createFog();
enableShadows();
createBloom();

// Scene-specific details
if (sceneNum === 1) { // CrocodilosConstruction specific
createStars();
createFogDots();
}
// SigmaCity doesn't have unique details beyond universal ones, so no 'else if (sceneNum === 2)' needed here
} else {
console.log("Disabling scene details...");
// Universal details
destroyFog();
disableShadows();
destroyBloom();

// Scene-specific details
if (sceneNum === 1) { //CrocodilosConstruction specific
destroyStars();
destroyFogDots();
}
}
}
}


// Crosshair

const BASE_GAP      = 2;
const SPREAD_SCALAR = 50;

export function updateCrosshair(spreadAngle) {
if (window.localPlayer?.isDead) return;

const gap = BASE_GAP + spreadAngle * SPREAD_SCALAR;

const up    = document.getElementById("line-up");
const down  = document.getElementById("line-down");
const left  = document.getElementById("line-left");
const right = document.getElementById("line-right");

up.style.top    = `${-gap - up.clientHeight}px`;
down.style.top  = `${gap}px`;
left.style.left = `${-gap - left.clientWidth}px`;
right.style.left= `${gap}px`;

document.getElementById("crosshair").style.display = "";
}

// Hit Pulse

const pendingRestore = {};
const originalColor   = {};

async function pulsePlayerHit(victimId) {
const playerRef = playersRef.child(victimId);
const flashColor = 0xff0000;
const PULSE_MS   = 200;

// 0) If we don't yet know their originalColor, fetch & stash it once
if (typeof originalColor[victimId] !== 'number') {
try {
const snap      = await playerRef.child('bodyColor').once('value');
const trueColor = snap.val();
if (typeof trueColor === 'number') {
originalColor[victimId] = trueColor;
//  console.log(
//    `[pulsePlayerHit] Stashed originalColor for ${victimId}: ` +
//    `0x${trueColor.toString(16).padStart(6, '0')}`
//   );
} else {
console.warn(
`[pulsePlayerHit] Can't flash ${victimId}, bodyColor is not a number:`,
trueColor
);
return;
}
} catch (err) {
console.error('[pulsePlayerHit] Error reading originalColor:', err);
return;
}
}

// 1) Cancel any pending restore so we keep flashing
if (pendingRestore[victimId]) {
clearTimeout(pendingRestore[victimId]);
}

// 2) Flash RED immediately
//  console.log(`[pulsePlayerHit] Flashing ${victimId} RED`);
await playerRef.update({ bodyColor: flashColor });

// 3) Schedule restore back to the stashed original color
pendingRestore[victimId] = setTimeout(async () => {
const orig = originalColor[victimId];
//  console.log(
//    `[pulsePlayerHit] Restoring ${victimId} to ` +
//    `0x${orig.toString(16).padStart(6, '0')}`
//   );
try {
await playerRef.update({ bodyColor: orig });
} catch (err) {
console.error('[pulsePlayerHit] Error restoring color:', err);
}
delete pendingRestore[victimId];
// leave originalColor in place for future hits
}, PULSE_MS);
}



// Game Start
export async function startGame(username, mapName, initialDetailsEnabled, ffaEnabled, gameId) {
  const networkOk = await initNetwork(username, mapName, gameId, ffaEnabled);
  if (!networkOk) return;

  playersRef    = dbRefs.playersRef;
  gameConfigRef = dbRefs.gameConfigRef;
  const gameTimerElement = document.getElementById('game-timer');

  if (ffaEnabled) {
    gameTimerElement.style.display = 'block';

    const INITIAL_DURATION = 10 * 60;
    let currentRemainingSeconds = null;
    let gameEnded = false;
    let localInterval = null;
    let ownerId = null;

    const ownerRef = gameConfigRef.child('owner');
    function tryElectSelf() {
      ownerRef.transaction(curr => curr === null ? localPlayerId : undefined);
    }
    tryElectSelf();
    ownerRef.onDisconnect().remove();

    ownerRef.on('value', snap => {
      ownerId = snap.val();

      if (ownerId === localPlayerId && localInterval === null) {
        localInterval = setInterval(() => {
          if (gameEnded || currentRemainingSeconds == null) return;
          if (currentRemainingSeconds <= 0) {
            gameConfigRef.child('ended').set(true);
            return;
          }
          currentRemainingSeconds--;
          gameConfigRef.child('gameDuration').set(currentRemainingSeconds);
        }, 1000);
      }

      if (ownerId !== localPlayerId && localInterval !== null) {
        clearInterval(localInterval);
        localInterval = null;
      }

      if (ownerId === null) {
        tryElectSelf();
      }
    });

    gameConfigRef.child('gameDuration').on('value', snap => {
      const val = snap.val();
      gameConfigRef.child('ended').once('value').then(endSnap => {
        const hasEnded = endSnap.val() === true;
        if (val === null && ownerId === localPlayerId && !hasEnded) {
          gameConfigRef.child('gameDuration').set(INITIAL_DURATION);
          return;
        }
        if (typeof val === 'number') {
          currentRemainingSeconds = val;
        }
      });
    });

    gameConfigRef.child('ended').on('value', snap => {
      if (snap.val() === true && !gameEnded) {
        gameEnded = true;
        if (localInterval) clearInterval(localInterval);
        gameTimerElement.textContent = 'TIME UP!';
        determineWinnerAndEndGame();
      }
    });

    setInterval(() => {
      if (currentRemainingSeconds == null) {
        gameTimerElement.textContent = 'Time: Syncing…';
      } else {
        const mins = Math.floor(currentRemainingSeconds / 60);
        const secs = currentRemainingSeconds % 60;
        gameTimerElement.textContent = `Time: ${mins}:${secs < 10 ? '0' : ''}${secs}`;
      }
    }, 250);

    if (playersKillsListener) {
      playersRef.off('value', playersKillsListener);
    }
    playersKillsListener = playersRef.on('value', snap => {
      let reached = false;
      snap.forEach(childSnap => {
        if (childSnap.val().kills >= 40) reached = true;
      });
      if (reached && !gameEnded) {
        gameConfigRef.child('ended').set(true);
      }
    });

  } else {
    gameTimerElement.style.display = 'none';
    if (gameInterval) clearInterval(gameInterval);
    gameConfigRef.child('gameDuration').remove();
    gameConfigRef.child('ended').remove();
    gameConfigRef.child('owner').remove();
  }

  initGlobalFogAndShadowParams();
  window.isGamePaused = false;
  document.getElementById('menu-overlay').style.display = 'none';
  document.body.classList.add('game-active');
  document.getElementById('game-container').style.display = 'block';
  document.getElementById('hud').style.display = 'block';
  document.getElementById('crosshair').style.display = 'block';

  if (!localPlayerId) {
    console.error('No localPlayerId after initNetwork—cannot proceed.');
    return;
  }

  window.physicsController = new PhysicsController(window.camera, scene);
  physicsController        = window.physicsController;
  weaponController         = new WeaponController(
    window.camera,
    dbRefs.playersRef,
    dbRefs.mapStateRef.child('bullets'),
    createTracer,
    localPlayerId,
    physicsController
  );
  window.weaponController = weaponController;

  if (mapName === 'CrocodilosConstruction') {
    await initSceneCrocodilosConstruction();
  } else if (mapName === 'SigmaCity') {
    await initSceneSigmaCity();
  }

  initInput();
  initChatUI();
  initBulletHoles();
  initializeAudioManager(window.camera, scene);
  startSoundListener();

  const spawn = findFurthestSpawn();
  window.localPlayer = {
    id: localPlayerId,
    username,
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    rotY: 0,
    health: initialPlayerHealth,
    shield: initialPlayerShield,
    weapon: initialPlayerWeapon,
    kills: 0,
    deaths: 0,
    ks: 0,
    bodyColor: Math.floor(Math.random() * 0xffffff),
    isDead: false
  };
  window.camera.position.copy(spawn).add(new THREE.Vector3(0, 1.6, 0));

  await dbRefs.playersRef.child(localPlayerId).set({
    ...window.localPlayer,
    lastUpdate: Date.now()
  });
  updateHealthShieldUI(window.localPlayer.health, window.localPlayer.shield);
  weaponController.equipWeapon(window.localPlayer.weapon);
  initInventory(window.localPlayer.weapon);
  initAmmoDisplay(window.localPlayer.weapon, weaponController.getMaxAmmo());
  updateInventory(window.localPlayer.weapon);
  updateAmmoDisplay(weaponController.ammoInMagazine, weaponController.stats.magazineSize);

  createRespawnOverlay();
  createFadeOverlay();
  createLeaderboardOverlay();
  animate();
}

export function hideGameUI() {
  document.getElementById("menu-overlay").style.display = "flex";
  document.body.classList.remove("game-active");
}

function setupDetailToggle() {
  const btn = document.getElementById("toggle-details-btn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    detailsEnabled = !detailsEnabled;

    if (detailsEnabled) {
      const fp = window.originalFogParams;
      if (fp.type === "exp2") {
        scene.fog = new THREE.FogExp2(fp.color, fp.density);
      } else {
        scene.fog = new THREE.Fog(fp.color, fp.near, fp.far);
      }
      renderer.shadowMap.enabled = true;
      dirLight.castShadow      = true;
      window.bloomPass.strength = window.originalBloomStrength;
      btn.textContent           = "Details: On";
    } else {
      scene.fog                = null;
      renderer.shadowMap.enabled = false;
      dirLight.castShadow        = false;
      window.bloomPass.strength   = 0;
      btn.textContent             = "Details: Off";
    }
  });

  btn.textContent = detailsEnabled ? "Details: On" : "Details: Off";
  
}


export async function initSceneCrocodilosConstruction() { // Make initSceneCrocodilosConstruction async
sceneNum = 1;
console.log("Initializing CrocodilosConstruction scene...");





// 1. Scene
scene = new THREE.Scene();
const skyGeo = new THREE.SphereGeometry(200, 32, 32).scale(-1, 1, 1);
const skyMat = new THREE.MeshBasicMaterial({
color: 0x000022,
side: THREE.BackSide,
fog: false
});
const skyColor = new THREE.Color(0x111122);
scene.background = skyColor;
skyMesh = new THREE.Mesh(skyGeo, skyMat);
scene.add(skyMesh);
window.scene = scene;


window.camera.rotation.order = "YXZ";
scene.add( window.camera );


// 3. Renderer
window.renderer = new THREE.WebGLRenderer({ antialias: false }); // Antialias might reduce the "pixelated" effect of lower resolution
renderer = window.renderer;
renderer.domElement.style.position = "relative";
renderer.domElement.style.zIndex = "0";
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000, 1);
document.getElementById("game-container").appendChild(renderer.domElement);
window.renderer = renderer;

// 4. Hemisphere Light
hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.05);
scene.add(hemi);
window.hemi = hemi;

// 5. Post-processing Composer
// Note: EffectComposer also needs to know the renderer's *display* size
composer = new EffectComposer(renderer);
renderPass = new RenderPass(scene, window.camera);
composer.addPass(renderPass);
window.composer = composer;
window.renderPass = renderPass;

// --- Initial Detail Setup for CrocodilosConstruction ---
toggleSceneDetails(detailsEnabled);

// --- Map and Physics Initialization ---
// AWAIT the creation of the map and spawn points
spawnPoints = await createCrocodilosConstruction(scene, physicsController);
window.spawnPoints = spawnPoints; // Now window.spawnPoints will be the actual array

const initialSpawnPoint = findFurthestSpawn(); // Call your function to get a spawn point
physicsController.setPlayerPosition(initialSpawnPoint);

// --- Audio Initialization ---
if (typeof windSound !== 'undefined') {
windSound.play().catch(err => console.warn("Failed to play wind sound:", err));
window.windSound = windSound;
} else {
console.warn("windSound is not defined. Audio might not play for CrocodilosConstruction.");
}

// --- Window Resize Handling ---
function onWindowResize() {
const container = document.getElementById("game-container");
const displayWidth  = container.clientWidth;
const displayHeight = container.clientHeight;

// 1) Render & post‑process at fixed 1280×720
renderer.setSize(FIXED_WIDTH, FIXED_HEIGHT, false);
if (composer) composer.setSize(FIXED_WIDTH, FIXED_HEIGHT);

// 2) Stretch the canvas via CSS to fill the container
renderer.domElement.style.width  = `${displayWidth}px`;
renderer.domElement.style.height = `${displayHeight}px`;

// 3) Update camera to match the display aspect ratio
window.camera.aspect = displayWidth / displayHeight;
window.camera.updateProjectionMatrix();

// 4) Re‑attach weapon to local player (if needed)
if (window.weaponController && window.localPlayer && typeof getWeaponModel === 'function' && typeof attachWeaponToPlayer === 'function') {
const key = window.localPlayer.weapon.replace(/-/g, "").toLowerCase();
const proto = getWeaponModel(key);
if (proto) attachWeaponToPlayer(window.localPlayer.id, key);
}

// 5) Re‑attach weapons for remote players
if (window.remotePlayers) {
Object.values(window.remotePlayers).forEach(({ currentWeapon, weaponRoot }) => {
if (currentWeapon && weaponRoot && typeof attachWeaponToPlayer === 'function') {
attachWeaponToPlayer(weaponRoot.userData.playerId, currentWeapon);
}
});
}

// 6) Resize HUD overlay
const hud = document.getElementById("hud");
if (hud) {
hud.style.width  = `${displayWidth}px`;
hud.style.height = `${displayHeight}px`;
}
}

window.addEventListener("resize", onWindowResize, false);
onWindowResize(); // Call once initially to set the correct sizes
}

export async function initSceneSigmaCity() { // Make initSceneCrocodilosConstruction async
sceneNum = 2;
console.log("Initializing SigmaCity scene...");

scene = new THREE.Scene();
const skyColor = new THREE.Color(0x87CEEB);
scene.background = skyColor;
window.scene = scene;


const skyGeo = new THREE.SphereGeometry(200, 32, 32).scale(-1, 1, 1);
const skyMat = new THREE.MeshBasicMaterial({
color: 0x000022,
side: THREE.BackSide,
fog: false
});
skyMesh = new THREE.Mesh(skyGeo, skyMat);
scene.add(skyMesh);
window.scene = scene;


window.camera.rotation.order = "YXZ";
scene.add( window.camera );


// 3. Renderer
window.renderer = new THREE.WebGLRenderer({ antialias: false }); // Antialias might reduce the "pixelated" effect of lower resolution
renderer = window.renderer;
renderer.domElement.style.position = "relative";
renderer.domElement.style.zIndex = "0";
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000, 1);
document.getElementById("game-container").appendChild(renderer.domElement);
window.renderer = renderer;

// 4. Hemisphere Light
hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.05);
scene.add(hemi);
window.hemi = hemi;

// 5. Post-processing Composer
// Note: EffectComposer also needs to know the renderer's *display* size
composer = new EffectComposer(renderer);
renderPass = new RenderPass(scene, window.camera);
composer.addPass(renderPass);
window.composer = composer;
window.renderPass = renderPass;

// --- Initial Detail Setup for SigmaCity ---
toggleSceneDetails(detailsEnabled);

// --- Map and Physics Initialization ---
// AWAIT the creation of the map and spawn points
spawnPoints = await createSigmaCity(scene, physicsController);
window.spawnPoints = spawnPoints; // Now window.spawnPoints will be the actual array

const initialSpawnPoint = findFurthestSpawn(); // Call your function to get a spawn point
physicsController.setPlayerPosition(initialSpawnPoint);

// --- Audio Initialization ---
if (typeof forestNoise !== 'undefined') {
forestNoise.volume = 0.05;
forestNoise.play().catch(err => console.warn("Failed to play forest noise:", err));
window.windSound = forestNoise; // Renamed to windSound for consistency if only one wind sound
} else {
console.warn("forestNoise is not defined. Audio might not play for SigmaCity.");
}

// --- Window Resize Handling ---
function onWindowResize() {
const container = document.getElementById("game-container");
const displayWidth  = container.clientWidth;
const displayHeight = container.clientHeight;

// 1) Render & post‑process at fixed 1280×720
renderer.setSize(FIXED_WIDTH, FIXED_HEIGHT, false);
if (composer) composer.setSize(FIXED_WIDTH, FIXED_HEIGHT);

// 2) Stretch the canvas via CSS to fill the container
renderer.domElement.style.width  = `${displayWidth}px`;
renderer.domElement.style.height = `${displayHeight}px`;

// 3) Update camera to match the display aspect ratio
window.camera.aspect = displayWidth / displayHeight;
window.camera.updateProjectionMatrix();

// 4) Re‑attach weapon to local player (if needed)
if (window.weaponController && window.localPlayer && typeof getWeaponModel === 'function' && typeof attachWeaponToPlayer === 'function') {
const key = window.localPlayer.weapon.replace(/-/g, "").toLowerCase();
const proto = getWeaponModel(key);
if (proto) attachWeaponToPlayer(window.localPlayer.id, key);
}

// 5) Re‑attach weapons for remote players
if (window.remotePlayers) {
Object.values(window.remotePlayers).forEach(({ currentWeapon, weaponRoot }) => {
if (currentWeapon && weaponRoot && typeof attachWeaponToPlayer === 'function') {
attachWeaponToPlayer(weaponRoot.userData.playerId, currentWeapon);
}
});
}

// 6) Resize HUD overlay
const hud = document.getElementById("hud");
if (hud) {
hud.style.width  = `${displayWidth}px`;
hud.style.height = `${displayHeight}px`;
}
}

window.addEventListener("resize", onWindowResize, false);
onWindowResize(); // Call once initially to set the correct sizes
}





// js/game.js (modify existing initGameNetwork)


export function pruneChat() {
chatRef
.orderByChild("timestamp")
.limitToFirst(1)
.once("value", (snap) => {
if (snap.exists()) {
chatRef.once("value", (allSnap) => {
if (allSnap.numChildren() > 10) {
snap.forEach((child) => child.ref.remove());
}
});
}
});
}

export function pruneKills() {
killsRef
.orderByChild("timestamp")
.limitToFirst(1)
.once("value", (snap) => {
if (snap.exists()) {
killsRef.once("value", (allSnap) => {
if (allSnap.numChildren() > 5) {
snap.forEach((child) => child.ref.remove());
}
});
}
});
}

// — REMOTE PLAYERS MANAGEMENT —
/**
* Fully updated addRemotePlayer function — no undefined references,
* uses the stored data.bodyColor (as colorHex) and sets up the entire player.
*/
// -------------------------------------------------------------
// Spawns a remote player and remembers their default color
// -------------------------------------------------------------
// -------------------------------------------------------------
// Spawns a remote player and remembers their default color
// -------------------------------------------------------------

import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'; // Correct import for FontLoader
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';

export function addRemotePlayer(data) {
// Check if the player is ALREADY FULLY CREATED and in the scene.
// If the group is NOT in the scene, even if it's in remotePlayers, something went wrong,
// so we should try to re-create it.
const existingPlayerEntry = window.remotePlayers[data.id];
if (existingPlayerEntry && window.scene.getObjectById(existingPlayerEntry.group.id)) {
// Player exists in map AND their group is in the scene. All good.
console.warn(`Attempted to add remote player ${data.id} but their mesh already exists in scene. Skipping creation.`);
return;
}

// If an incomplete entry exists, remove it before re-creating
if (existingPlayerEntry) {
console.warn(`Incomplete remote player entry for ${data.id} found. Removing and recreating.`);
// Clean up any partial Three.js objects if they were added
if (existingPlayerEntry.group && existingPlayerEntry.group.parent) {
existingPlayerEntry.group.parent.remove(existingPlayerEntry.group);
existingPlayerEntry.group.traverse(obj => {
if (obj.geometry) obj.geometry.dispose();
if (obj.material) {
if (Array.isArray(obj.material)) {
obj.material.forEach(m => m.dispose());
} else {
obj.material.dispose();
}
}
});
}
delete window.remotePlayers[data.id]; // Remove the stale entry
}


// Ensure window.scene is available
if (!window.scene) {
console.error("Critical Error: window.scene is not initialized when attempting to add remote player mesh.");
return;
}

// 1) Determine the player’s original color
const initialColor = (typeof data.trueColor === 'number')
? data.trueColor
: (typeof data.bodyColor === 'number' ? data.bodyColor : 0xffffff);

console.log(
`Remote player ${data.id} originalColor → 0x${initialColor
           .toString(16)
           .padStart(6, '0')} `);

// 2) Build the THREE.Group for this player
const group = new THREE.Group();
group.name = `remotePlayer_${data.id}`; // Set the name here for future getObjectByName calls
group.userData.playerId = data.id; // Store ID on the group

// ─── Body ──────────────────────────────────────────────────────────────────────
const bodyGeom = new THREE.CapsuleGeometry(0.3, 1.3, 4, 8);
const bodyMat = new THREE.MeshStandardMaterial({ color: initialColor });
const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
bodyMesh.castShadow = true;
bodyMesh.position.set(0, 0.0 - 1.1, 0); // Position relative to group center
bodyMesh.userData.isPlayerBodyPart = true;
bodyMesh.userData.playerId = data.id;
group.add(bodyMesh);

     if (!bodyMesh.geometry.index) {
    bodyMesh.geometry.setIndex(
      generateSequentialIndices(bodyMesh.geometry.attributes.position.count)
    );
  }
  bodyMesh.geometry.computeBoundsTree();

  group.add(bodyMesh);

// ─── Head ──────────────────────────────────────────────────────────────────────
const headGeom = new THREE.SphereGeometry(0.15, 8, 8);
const headMat = new THREE.MeshStandardMaterial({ color: 0xffffaa });
const headMesh = new THREE.Mesh(headGeom, headMat);
headMesh.castShadow = true;
headMesh.position.set(0, 1.1 - 1.1, 0); // Relative to body/group
headMesh.userData.isPlayerBodyPart = true;
headMesh.userData.playerId = data.id;
headMesh.userData.isPlayerHead = true;
group.add(headMesh);

      if (!headMesh.geometry.index) {
    headMesh.geometry.setIndex(
      generateSequentialIndices(headMesh.geometry.attributes.position.count)
    );
  }
  headMesh.geometry.computeBoundsTree();

  group.add(headMesh);

// ─── Health Bar ───────────────────────────────────────────────────────────────
// Ensure createHealthBar exists and returns expected object structure
let healthBarObj;
try {
healthBarObj = createHealthBar();
healthBarObj.group.position.set(0, 0.5 - 1.1, -0.4); // Position relative to group
healthBarObj.group.scale.set(0.25, 0.75, 1);
group.add(healthBarObj.group);
} catch (e) {
console.error(`Error creating health bar for player ${data.id}:`, e);
// Decide how to handle: skip health bar, or abort player creation?
// For now, let's assume it's non-critical for basic player visibility.
}


// ─── Name Label ───────────────────────────────────────────────────────────────
let nameMesh;
try {
// You'll need to load a font first. This is an example, replace with your font path.
// Common Three.js fonts are in node_modules/three/examples/fonts/
const fontLoader = new FontLoader();
fontLoader.load('https://unpkg.com/three@0.165.0/examples/fonts/helvetiker_regular.typeface.json', function(font) {
const textGeometry = new TextGeometry(data.username, {
font: font,
size: 0.1, // Adjust size as needed
height: 0.05, // Depth of the 3D text
curveSegments: 12,
bevelEnabled: true,
bevelThickness: 0.01,
bevelSize: 0.005,
bevelOffset: 0,
bevelSegments: 5
});
textGeometry.center(); // Center the text geometry
const textMaterial = new THREE.MeshStandardMaterial({
color: 0xffffff
}); // White text
nameMesh = new THREE.Mesh(textGeometry, textMaterial);
nameMesh.position.set(0, 0.3 - 1.1, -0.4); // Position above the head
nameMesh.rotation.set(
THREE.MathUtils.degToRad(0),
THREE.MathUtils.degToRad(180),
0
);
nameMesh.userData.isPlayerName = true;
group.add(nameMesh);
}, undefined, function(err) {
console.error('An error happened loading the font:', err);
});

} catch (e) {
console.error(`Error creating name label for player ${data.id}:`, e);
}


// ─── Weapon Root ──────────────────────────────────────────────────────────────
const weaponRoot = new THREE.Group();
weaponRoot.name = 'remoteWeaponRoot'; // Name for easy access
group.add(weaponRoot);

// 3) Position & visibility of the main group
group.position.set(data.x, data.y, data.z); // Set absolute world position
group.rotation.y = data.rotY;
group.visible = !data.isDead; // Set initial visibility

// 4) Add to scene FIRST, then add to remotePlayers map
window.scene.add(group); // Add the entire player group to the global scene

// Now, create the entry in the map, *after* adding to the scene
window.remotePlayers[data.id] = {
id: data.id,
group, // The main Three.js group for this player
bodyMesh,
headMesh,
healthBarObj, // Object containing the health bar group and update function
nameMesh,
weaponRoot,
data: { ...data }, // Store a copy of the player data
currentWeapon: null, // Will be updated by attachWeaponToPlayer
trueColor: initialColor,
originalColor: initialColor
};

console.log(`Successfully added remote player mesh for: ${data.username} (ID: ${data.id})`);

// 5) Attach their weapon model after the player group exists
// Call this AFTER the player object is properly stored in window.remotePlayers
// to ensure attachWeaponToPlayer can find the weaponRoot.
// Ensure attachWeaponToPlayer handles cases where the player object might be incomplete if it's called too early
attachWeaponToPlayer(data.id, data.weapon);
}






// ─── bullet-proof removeRemotePlayer ─────────────────────────────────────────
export function removeRemotePlayer(id) {
const rp = window.remotePlayers[id];

// Remove model if still in scene
if (rp && rp.group && rp.group.parent) {
scene.remove(rp.group);
console.log(`[removeRemotePlayer] Removed model for player ${id}`);
}

// Clear any pending hide‐timeouts
clearTimeout(playerVisibilityTimeouts[id]);
delete playerVisibilityTimeouts[id];


// Unconditionally delete the map entry
delete window.remotePlayers[id];
// console.log(`[removeRemotePlayer] Purged remotePlayers[${id}]`);
}

export function updateRemotePlayer(data) {
// console.log('[updateRemotePlayer] called for id=', data.id);
if (data.id == null) return;

const rp = window.remotePlayers[data.id];
if (!rp || typeof rp !== 'object') {
// console.warn(`[${data.id}] no rp object, removing`);
removeRemotePlayer(data.id);
return;
}
if (!data.username) {
console.warn(`[${data.id}] missing username, removing`);
removeRemotePlayer(data.id);
return;
}

// Store latest data
rp.data = data;

// --- Apply transform only when alive ---
if (!data.isDead) {
// Alive: reset any fall state, ensure visible, apply network position/rotation
rp.group.userData.isFalling = false;
rp.group.userData.velocityY = 0;
if (!rp.group.parent) scene.add(rp.group);
rp.group.visible = true;
rp.group.position.set(data.x, data.y, data.z);
rp.group.rotation.y = data.rotY;
} else {
// Dead: start falling if not already, but DO NOT overwrite position from network.
if (!rp.group.userData.isFalling) {
rp.group.userData.isFalling = true;
rp.group.userData.velocityY = 0;
// Optionally record starting Y: 
// rp.group.userData.deathStartY = rp.group.position.y;
}
// Keep visible so falling is seen; animate loop will hide after threshold.
rp.group.visible = true;
// Update rotation if desired (so the model faces the last orientation):
rp.group.rotation.y = data.rotY;
// Do NOT call position.set here, so that the animate()/falling logic can move it downward over frames.
}
// :contentReference[oaicite:0]{index=0}

// Health/shield UI
rp.healthBarObj.update(data.health, data.shield);

// Body color flash
if (typeof data.bodyColor === 'number') {
const colorToUse = data.bodyColor === rp.originalColor
? rp.originalColor
: data.bodyColor;
rp.bodyMesh.material.color.setHex(colorToUse);
}

// Weapon change → clear any in‑flight swing timer and reset
if (data.weapon !== rp.currentWeapon) {
if (rp.swingAnim && rp.swingAnim.timerId != null) {
clearTimeout(rp.swingAnim.timerId);
rp.swingAnim.timerId = null;
}
rp.swingAnim = { active: false, timerId: null };

attachWeaponToPlayer(data.id, data.weapon);
rp.currentWeapon = data.weapon;
resetWeaponPose(data.weapon, rp.weaponMesh);
const mats = Array.isArray(rp.weaponMesh.material)
? rp.weaponMesh.material
: [rp.weaponMesh.material];
mats.forEach(m => m?.emissive?.setHex(0x000000));
}

// Death → start falling (redundant if already set above, but harmless guard)
if (data.isDead && !rp.group.userData.isFalling) {
rp.group.userData.isFalling = true;
rp.group.userData.velocityY = 0;
}

// Ensure weaponMesh exists
if (!rp.weaponMesh) {
console.warn(`[${data.id}] rp.weaponMesh is null or undefined`);
return;
}

// Ensure swingAnim defaults
if (!rp.swingAnim) {
rp.swingAnim = { active: false, timerId: null };
}

// Knife swing request → start timer once
if (data.knifeSwing && !rp.swingAnim.active && rp.currentWeapon === 'knife') {
data.knifeSwing = false;  // consume the flag
rp.swingAnim.active = true;
const rpm = 120;
const duration = 60_000 / rpm;
rp.swingAnim.duration = duration;
rp.swingAnim.startTime = performance.now();
rp.swingAnim.heavy = !!data.knifeHeavy;
rp.swingAnim.timerId = setTimeout(() => {
if (rp.currentWeapon === 'knife') {
resetWeaponPose(rp.currentWeapon, rp.weaponMesh);
const mats2 = Array.isArray(rp.weaponMesh.material)
? rp.weaponMesh.material
: [rp.weaponMesh.material];
mats2.forEach(m => m?.emissive?.setHex(0x000000));
}
rp.swingAnim.active = false;
rp.swingAnim.timerId = null;
console.log(`[${data.id}] 🗡️ knifeSwing ENDED via timer`);
}, duration);
console.log(`[${data.id}] 🗡️ knifeSwing START (heavy=${rp.swingAnim.heavy})`);
}

// Animate ongoing swing
if (rp.swingAnim.active && rp.currentWeapon === 'knife') {
const now     = performance.now();
const elapsed = now - rp.swingAnim.startTime;
const t       = Math.min(elapsed / rp.swingAnim.duration, 1);
const maxF    = rp.swingAnim.heavy ? 0.9 : 1.2;
const swingAng = maxF * Math.sin(Math.PI * t);
const { MathUtils } = THREE;

// emissive pulse
const mats = Array.isArray(rp.weaponMesh.material)
? rp.weaponMesh.material
: [rp.weaponMesh.material];
mats.forEach(mat => {
if (mat?.emissive?.setHex) {
mat.emissive.setHex(0xff0000 * t);
}
});

// apply tilt
const restX = MathUtils.degToRad(90);
const restY = MathUtils.degToRad(180);
const restZ = 0;
rp.weaponMesh.rotation.set(
restX - swingAng,
restY,
restZ
);
} else if (!rp.swingAnim.active && rp.currentWeapon === 'knife') {
resetWeaponPose(rp.currentWeapon, rp.weaponMesh);
const mats2 = Array.isArray(rp.weaponMesh.material)
? rp.weaponMesh.material
: [rp.weaponMesh.material];
mats2.forEach(m => m?.emissive?.setHex(0x000000));
}
}


function cleanUpRemotePlayers() {
for (const id in window.remotePlayers) {
const rp = window.remotePlayers[id];
// If it's not a proper object, just purge it
if (!rp || typeof rp !== "object") {
console.log(`[cleanUp] Found invalid entry for ${id}:`, rp);
removeRemotePlayer(id);
}
}
}

// Run this on a schedule (or right after you process incoming deltas)
setInterval(cleanUpRemotePlayers, 1000);

// — SPAWN SELECTION —
function findFurthestSpawn() {
//  console.log("Finding furthest spawn point...");
const spawnPoints = window.spawnPoints; // Correctly reference the global spawnPoints

if (!spawnPoints || !Array.isArray(spawnPoints) || spawnPoints.length === 0) {
console.warn("window.spawnPoints is not an array or is empty. Returning default spawn point.");
return new THREE.Vector3(0, 10, 0); // Default fallback spawn point
}

const spawnDistances = [];

// Calculate the minimum distance for each spawn point to any remote player
for (let sp of spawnPoints) {
let minDist = Infinity;

// Iterate through remote players for distance calculation
for (let pid in window.remotePlayers) {
const rp = window.remotePlayers[pid];
// Defensive check for rp.group and its position
if (rp.group && rp.group.position) {
const dx = rp.group.position.x - sp.x;
const dz = rp.group.position.z - sp.z;
const dist = Math.sqrt(dx * dx + dz * dz);
if (dist < minDist) {
minDist = dist;
}
}
}
// If no remote players were found, all minDist will remain Infinity.
// In this case, all spawn points are equally "furthest", so we'll assign a very large value.
// If there are remote players, minDist will be a finite number.
spawnDistances.push({
spawnPoint: sp,
distance: minDist
});
}

// Handle case where no remote players exist (all distances are Infinity)
if (spawnDistances.every(sd => sd.distance === Infinity)) {
console.log("No remote players found. Selecting a random spawn point from all available.");
// If no players, all spots are equally good, so pick a random one from all.
const randomIndex = Math.floor(Math.random() * spawnPoints.length);
return spawnPoints[randomIndex];
}

// Sort spawn points by distance in descending order (furthest first)
spawnDistances.sort((a, b) => b.distance - a.distance);

// Get the top 3 furthest spawn points
// Use Math.min to ensure we don't try to slice more than available spawn points
const top3Furthest = spawnDistances.slice(0, Math.min(3, spawnDistances.length));

// Randomly select one from the top 3 (or fewer if less than 3 are available)
const randomIndex = Math.floor(Math.random() * top3Furthest.length);
const chosenSpawn = top3Furthest[randomIndex].spawnPoint;

//  console.log(`Chosen spawn point: (${chosenSpawn.x}, ${chosenSpawn.y}, ${chosenSpawn.z}) with distance ${top3Furthest[randomIndex].distance}`);

return chosenSpawn;
}

// NEW: Internal functions for showing/hiding respawn overlay
function showRespawn() {
if (respawnOverlay) {
respawnOverlay.style.display = 'flex';
}
}

function hideRespawn() {
if (respawnOverlay) {
respawnOverlay.style.display = 'none';
}
}

// NEW: Create the fade-to-black overlay (initially transparent)
function createFadeOverlay() {
if (fadeOverlay) return; // Only create once
fadeOverlay = document.createElement("div");
fadeOverlay.id = "fade-overlay";
Object.assign(fadeOverlay.style, {
position: "fixed",
top: "0",
left: "0",
width: "100%",
height: "100%",
background: "#000",
opacity: "0",            // start fully transparent
transition: "opacity 1s ease-in-out",
pointerEvents: "none",   // clicks pass through while transparent
zIndex: "5",             // Above HUD (z=2), below respawn (z=6)
});
document.body.appendChild(fadeOverlay);
// console.log("[createFadeOverlay] Fade overlay added to DOM.");
}

let redOverlay;

function createRedOverlay() {
if (redOverlay) return; // only create it once

redOverlay = document.createElement("div");
redOverlay.id = "full-red-overlay";
Object.assign(redOverlay.style, {
position:      "fixed",
top:           "0",
left:          "0",
width:         "100%",
height:        "100%",
background:    "rgba(255, 0, 0, 1)",   // fully-opaque red
opacity:       "0",                    // start fully transparent
transition:    "opacity 0.5s ease-out",// fade in/out
zIndex:        "9999",                 // on top of everything
pointerEvents: "none",                 // allow clicks through when hidden
});

document.body.appendChild(redOverlay);
// console.log("[createRedOverlay] Full-screen red overlay added to DOM.");
}

const hitArrowCSS = `
 #hit-direction-arrow {
   position: absolute;
   top: 50%;
   left: 50%;
   transform: translate(-50%, -50%) rotate(0deg); /* Initial rotation */
   width: 80px; /* Adjust size as needed */
   height: 80px; /* Adjust size as needed */
   background-color: rgba(255, 0, 0, 0.7); /* Red arrow */
   clip-path: polygon(0% 20%, 60% 20%, 60% 0%, 100% 50%, 60% 100%, 60% 80%, 0% 80%);
   opacity: 0;
   transition: opacity 0.1s ease-out, transform 0.1s ease-out; /* Faster transitions for a snappier feel */
   pointer-events: none; /* Allows clicks to pass through */
   z-index: 1000; /* Ensure it's on top */
 }
`;

// Inject the CSS into the head of the document
const styleElement = document.createElement('style');
styleElement.innerHTML = hitArrowCSS;
document.head.appendChild(styleElement);

// Create the hit direction arrow element
let hitDirectionArrow = document.getElementById('hit-direction-arrow');
if (!hitDirectionArrow) {
hitDirectionArrow = document.createElement('div');
hitDirectionArrow.id = 'hit-direction-arrow';
document.body.appendChild(hitDirectionArrow);
}


function showHitDirectionArrow(angle) {
hitDirectionArrow.style.transition = 'opacity 0.1s ease-out, transform 0.1s ease-out';
hitDirectionArrow.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
hitDirectionArrow.style.opacity = '1';

// Fade out the arrow after a short duration
setTimeout(() => {
hitDirectionArrow.style.opacity = '0';
}, 500); // Arrow visible for 0.5 seconds
}

let lastDamageSourcePosition = null;

/** Call this to flash red then fade away **/
function pulseScreenRed() {
createRedOverlay();
// Bring it up quickly
redOverlay.style.pointerEvents = "auto"; // block input briefly if you want
redOverlay.style.opacity = "0.8";        // semi-strong flash

// After a short hold, fade back to transparent
setTimeout(() => {
redOverlay.style.opacity = "0";
// when fade completes, allow input through again
redOverlay.addEventListener("transitionend", function onEnd() {
redOverlay.style.pointerEvents = "none";
redOverlay.removeEventListener("transitionend", onEnd);
});
}, 100); // you can tweak this hold time (ms)
}

let whiteOverlay = null;

function createWhiteOverlay() {
if (whiteOverlay) return; // only create it once

whiteOverlay = document.createElement("div");
whiteOverlay.id = "full-white-overlay";
Object.assign(whiteOverlay.style, {
position:      "fixed",
top:           "0",
left:          "0",
width:         "100%",
height:        "100%",
background:    "rgba(255, 255, 255, 1)", // fully-opaque white
opacity:       "0",                     // start fully transparent
transition:    "opacity 0.5s ease-out",
zIndex:        "9999",
pointerEvents: "none",
});

document.body.appendChild(whiteOverlay);
// console.log("[createWhiteOverlay] Full-screen white overlay added to DOM.");
}

/** Call this to flash white then fade away **/
function pulseScreenWhite() {
createWhiteOverlay();
whiteOverlay.style.pointerEvents = "auto";
whiteOverlay.style.opacity = "0.8";

setTimeout(() => {
whiteOverlay.style.opacity = "0";
whiteOverlay.addEventListener("transitionend", function onEnd() {
whiteOverlay.style.pointerEvents = "none";
whiteOverlay.removeEventListener("transitionend", onEnd);
});
}, 100);
}

// Replace your old showRedOverlay/hideRedOverlay calls with:
window.pulseScreenRed = pulseScreenRed;


// NEW: Create the respawn overlay and button
function createRespawnOverlay() {
if (respawnOverlay) return; // Only create once
respawnOverlay = document.createElement("div");
respawnOverlay.id = "respawn-overlay";
Object.assign(respawnOverlay.style, {
position: "fixed",
top: "0",
left: "0",
width: "100%",
height: "100%",
background: "rgba(0, 0, 0, 0.75)",
zIndex: "6",            // Above fade overlay
display: "none",        // Hidden until death
alignItems: "center",
justifyContent: "center",
pointerEvents: "auto",
});

respawnButton = document.createElement("button");
respawnButton.id = "respawn-btn";
respawnButton.textContent = "Respawn";
Object.assign(respawnButton.style, {
padding: "15px 25px",
fontSize: "1.2rem",
cursor: "pointer",
border: "none",
borderRadius: "6px",
background: "#e74c3c",
color: "#fff",
});

respawnOverlay.appendChild(respawnButton);
document.body.appendChild(respawnOverlay);
// console.log("[createRespawnOverlay] Respawn overlay added to DOM.");

respawnButton.addEventListener("click", () => {
respawnPlayer();
});
}

function createLeaderboardOverlay() {
if (document.getElementById("leaderboard-overlay")) return;

// 1) Container
const overlay = document.createElement("div");
overlay.id = "leaderboard-overlay";
Object.assign(overlay.style, {
position:       "fixed",
top:            "10px",
right:          "10px",
background:     "rgba(0,0,0,0.85)",
color:          "#fff",
padding:        "12px 16px",
borderRadius:   "8px",
fontFamily:     "Arial, sans-serif",
zIndex:         "10",
pointerEvents:  "none",
display:        "block",      // default to visible
maxHeight:      "70vh",
overflowY:      "auto",
minWidth:       "240px",
});

// 2) Title
const title = document.createElement("div");
title.textContent = "Leaderboard (T to toggle)";
Object.assign(title.style, {
fontSize: "1.3rem",
fontWeight: "bold",
marginBottom: "8px",
textAlign: "center"
});
overlay.appendChild(title);

// 3) Table skeleton
const table = document.createElement("table");
Object.assign(table.style, {
width: "100%",
borderCollapse: "collapse",
textAlign: "left",
fontSize: "0.9rem"
});
table.innerHTML = `
   <thead>
     <tr>
       <th style="padding:4px;">Name</th>
       <th style="padding:4px;">K</th>
       <th style="padding:4px;">D</th>
       <th style="padding:4px;">KS</th>
     </tr>
   </thead>
   <tbody id="leaderboard-body">
     <tr><td colspan="4" style="padding:4px; text-align:center;">Loading…</td></tr>
   </tbody>
 `;
overlay.appendChild(table);

document.body.appendChild(overlay);

// 4) Firebase listener
playersRef.on("value", snapshot => {
const players = [];
snapshot.forEach(snap => {
const d = snap.val();
if (d && d.username) {
players.push({
name: d.username,
kills: d.kills || 0,
deaths: d.deaths || 0,
ks: d.ks || 0
});
}
});
players.sort((a,b) => b.kills - a.kills || b.ks - a.ks);

const tbody = document.getElementById("leaderboard-body");
tbody.innerHTML = "";
if (players.length === 0) {
tbody.innerHTML = `<tr><td colspan="4" style="padding:4px; text-align:center;">No players</td></tr>`;
} else {
players.forEach(p => {
const row = document.createElement("tr");
row.innerHTML = `
         <td style="padding:4px;">${p.name}</td>
         <td style="padding:4px;">${p.kills}</td>
         <td style="padding:4px;">${p.deaths}</td>
         <td style="padding:4px;">${p.ks}</td>
       `;
tbody.appendChild(row);
});
}
});

// 5) Toggle with T, ignoring repeats
window.addEventListener("keydown", e => {
// Prevent leaderboard toggle if user is typing in chat
if (document.activeElement === chatInput) return;

if (e.key.toLowerCase() === "t" && !e.repeat) {
overlay.style.display = overlay.style.display === "none" ? "block" : "none";
}
});
}




// — DEATH & RESPAWN —
export function handleLocalDeath() {
//console.log("▶️ handleLocalDeath called! deathTheme exists?", !!deathTheme);
document.getElementById("crosshair").style.display = "none";
// console.log("[DEBUG] handleLocalDeath called.");

if (window.localPlayer) {
// 1. Mark the player dead
window.localPlayer.isDead = true;
//  console.log("[DEBUG] window.localPlayer.isDead set to:", window.localPlayer.isDead);

// 2. Remove any physics bodies (if you’re using a physics engine)

// 3. Remove THREE.js colliders from collidables array
window.collidables = window.collidables.filter(obj => {
// assume each collider has userData.playerId === localPlayer.id
return !(obj.userData.isPlayerBodyPart && obj.userData.playerId === window.localPlayer.id);
});
//  console.log("[DEBUG] Stripped out localPlayer collidables, remaining:", window.collidables.length);

// 4. Optionally hide the model in the scene (if you want)
if (window.localPlayer.group && window.localPlayer.group.parent) {
scene.remove(window.localPlayer.group);
//  console.log("[DEBUG] Removed localPlayer model from scene");
}

// 5. Trigger your respawn UI
if (typeof showRespawn === "function") {
showRespawn();
//    console.log("[DEBUG] showRespawn() called.");
} else {
console.error("[DEBUG ERROR] showRespawn function is not defined!");
}
} else {
console.error("[DEBUG ERROR] window.localPlayer is not defined in handleLocalDeath.");
}
}


// Make sure that the 'respawnPlayer' function is defined globally as well.
// If you haven't already, define it similar to this example:
window.respawnPlayer = function() {
if (window.localPlayer) {
window.localPlayer.isDead = false;
window.localPlayer.health = 100;
window.localPlayer.shield = 50;
console.log("Player has respawned!");

}
if (typeof hideRespawn === "function") {
hideRespawn();
}
};

function respawnPlayer() {
// 0) Flip yourself alive immediately
window.localPlayer.isDead = false;

// UI + audio reset
deathTheme.currentTime = 0;
deathTheme.pause();
if (sceneNum == 1) {
windSound.play().catch(err => console.warn(err));
} else if (sceneNum == 2) {
forestNoise.play().catch(err => console.warn(err));
}

respawnOverlay.style.display = "none";
document.getElementById("crosshair").style.display = "block";
if (fadeOverlay) {
fadeOverlay.style.pointerEvents = "none";
fadeOverlay.style.opacity = "0";
}

// 1) Compute spawn point
const spawn = findFurthestSpawn();

// 2) Reset logical/player state
window.localPlayer.x = spawn.x;
window.localPlayer.y = spawn.y;
window.localPlayer.z = spawn.z;
physicsController.setPlayerPosition(spawn);
// 3) Reset your physics body so PhysicsController doesn’t yank you back
if (physicsController && physicsController.body) {
const body = physicsController.body;
// zero out any residual motion
body.velocity.set(0, 0, 0);
body.angularVelocity.set(0, 0, 0);
// teleport to spawn + eye-height
body.position.set(spawn.x, spawn.y + 1.6, spawn.z);
// reset orientation
body.quaternion.set(0, 0, 0, 1);
body.wakeUp();
}

// 4) Move THREE camera immediately
window.camera.position.copy(spawn).add(new THREE.Vector3(0, 1.6, 0));
window.camera.lookAt(new THREE.Vector3(spawn.x, spawn.y + 1.6, spawn.z + 1).add(new THREE.Vector3(0, 0, 0)));

// 5) Reposition your model/group if you have one
const group = window.localPlayer.group;
if (group) {
group.position.set(spawn.x, spawn.y + 1.6, spawn.z);
}

// 6) Re-add collidables for your body
if (group) {
group.traverse(child => {
if (child.isMesh) {
child.userData.isPlayerBodyPart = true;
child.userData.playerId = window.localPlayer.id;
window.collidables.push(child);
}
});
// console.log('[respawnPlayer] Restored collidables, total now:', window.collidables.length);
}

// 7) Pointer-lock & input reset
//  console.log("[respawnPlayer] Re-entering pointer lock");
document.body.classList.add("game-active");

// 8) Weapon & HUD reset
if (typeof weaponAmmo === 'object') {
for (const key in weaponAmmo) delete weaponAmmo[key];
}
for (const key in WeaponController.WEAPONS) {
const stats = WeaponController.WEAPONS[key];
weaponController.ammoStore[key] = stats.magazineSize;
if (weaponController.currentKey === key) {
weaponController.ammoInMagazine = stats.magazineSize;
updateAmmoDisplay(weaponController.ammoInMagazine, stats.magazineSize);
updateInventory(
weaponController.getCurrentAmmo(),
weaponController.getMaxAmmo()
);
}
}

// 9) Sync alive state to Firebase
playersRef.child(window.localPlayer.id).update({
x: spawn.x,
y: spawn.y,
z: spawn.z,
health: 100,
shield: 50,
isDead: false
});
}


// — MAIN ANIMATION LOOP —
// js/game.js (or wherever your main loop lives)

let hiddenInterval = null;
let rafId = null;

export function animate(timestamp) {
    // Schedule the next frame *first*. This ensures the loop continues
    // even if an error occurs later in this frame.
    requestAnimationFrame(animate);

    // --- Disconnection/Pause Logic ---
    // If localPlayerId is null, it means the local player has disconnected.
    // The game state should already be paused and UI updated by the handler
    // that sets localPlayerId to null. This function simply stops further animation logic.
    if (localPlayerId === null || window.isGamePaused) {
        // console.log("Animation loop paused or stopped due to local player disconnection."); // Only for debugging
        return;
    }

    // --- Frame Throttling (60fps) ---
    const FRAME_INTERVAL = 1000 / 60; // ≈16.67ms
    if (!animate.lastTime) {
        animate.lastTime = timestamp; // Initialize for the first frame
    }
    const deltaMs = timestamp - animate.lastTime;

    if (deltaMs < FRAME_INTERVAL) {
        return; // Too early, skip this frame
    }
    // Carry over any "extra" time for smoother timing
    animate.lastTime = timestamp - (deltaMs % FRAME_INTERVAL);

    // Convert to seconds for game logic
    const delta = deltaMs / 1000;

    // --- Pre-animation checks ---
    if (!physicsController || !weaponController) {
        console.warn("Skipping animate(): controllers not yet initialized");
        postFrameCleanup(); // Clean up even if controllers aren't ready
        return;
    }
    if (!window.mapReady) {
        // console.warn("Skipping animate(): map not ready."); // Can be noisy
        postFrameCleanup();
        return;
    }
    if (!window.localPlayer) {
        console.warn("Skipping animate(): window.localPlayer is not initialized.");
        postFrameCleanup();
        return;
    }

    try {
        // --- Death Screen Logic ---
        if (window.localPlayer.isDead) {
            const cross = document.getElementById("crosshair");
            if (cross) cross.style.display = "none";

            // Ensure death-related sounds are playing and others are paused
            if (windSound && !windSound.paused) windSound.pause();
            if (forestNoise && !forestNoise.paused) forestNoise.pause();
            if (deathTheme && deathTheme.paused) {
                deathTheme.currentTime = 0;
                deathTheme.play().catch(e => console.error("Error playing death theme:", e));
            }

            // Show death overlays
            if (fadeOverlay) {
                fadeOverlay.style.pointerEvents = "auto";
                fadeOverlay.style.opacity = "1";
            }
            if (respawnOverlay) respawnOverlay.style.display = "flex";

            composer.render();
            postFrameCleanup();
            return; // Exit early if player is dead
        } else {
            // Player is alive: ensure game sounds are playing and death overlays are hidden
            if (windSound && !windSound.paused) windSound.pause();
            if (forestNoise && !forestNoise.paused) forestNoise.pause();
            if (deathTheme && !deathTheme.paused) deathTheme.pause();

            if (fadeOverlay && fadeOverlay.style.opacity !== "0") {
                hideFadeOverlay(); // Assumes this function correctly sets opacity to "0" and pointerEvents to "none"
            }
            if (respawnOverlay && respawnOverlay.style.display !== "none") {
                hideRespawn(); // Assumes this function correctly sets display to "none"
            }

            // Ensure crosshair is visible if not dead
            const cross = document.getElementById("crosshair");
            if (cross) cross.style.display = "block"; // Or "flex" depending on its original display type
        }

        // --- Normal Game Updates ---
        checkForDamagePulse(); // Check for visual damage effects

        if (weaponController.stats.speedModifier != null) {
            physicsController.setSpeedModifier(weaponController.stats.speedModifier);
        }

        // Remote players falling (simplified gravity application)
        const GRAVITY = 9.8;
        Object.values(window.remotePlayers).forEach(rp => {
            const g = rp.group;
            if (g?.userData.isFalling) {
                g.userData.velocityY = (g.userData.velocityY || 0) + GRAVITY * delta;
                g.position.y -= g.userData.velocityY * delta;
                if (g.position.y < -20) { // Off-map threshold
                    g.userData.isFalling = false;
                    g.userData.velocityY = 0;
                    g.visible = false; // Hide player once they fall off the map
                }
            }
        });

        // Sky, Fog, and Starfield rotation (time-dependent)
        // Ensure skyMesh, starField, worldFog are defined or set to null if not used
        if (skyMesh) skyMesh.rotation.x += 0.0001 * deltaMs; // Use deltaMs for consistent speed, or calculate a rate per second
        if (starField) starField.rotation.x += 0.00008 * deltaMs;

        if (window.worldFog) { // Use window.worldFog as that's what you assign in createFogDots
            window.worldFog.rotation.y += delta * 0.005;
            const nowMs = performance.now();
            window.worldFog.position.x += Math.sin(nowMs * 0.0001) * delta * 2;
            window.worldFog.position.z += Math.cos(nowMs * 0.0001) * delta * 2;
        }

        // Physics & Input Update
        const physState = physicsController.update(delta, inputState, window.collidables);

        // Weapon Update
        weaponController.update(
            inputState,
            delta, {
                velocity: physState.velocity,
                isCrouched: inputState.crouch,
                physicsController,
                collidables: window.collidables,
                stats: weaponController.stats
            }
        );

        // Active Tracers Update
        for (let i = activeTracers.length - 1; i >= 0; i--) {
            const tracer = activeTracers[i];
            tracer.update(delta); // Pass the calculated delta (in seconds)

            if (tracer.remove) {
                tracer.dispose();
                activeTracers.splice(i, 1);
            }
        }

        // Network Sync - Send local player's updated state
        // dbRefs is now global, so just check it.
        if (dbRefs && dbRefs.playersRef && localPlayerId) {
            sendPlayerUpdate({
                x: physState.x,
                y: physState.y,
                z: physState.z,
                rotY: physState.rotY,
                weapon: window.localPlayer.weapon,
                knifeSwing: window.localPlayer.knifeSwing || false,
                knifeHeavy: window.localPlayer.knifeHeavy || false
            });
            // Reset knife swing flags after sending
            window.localPlayer.knifeSwing = false;
            window.localPlayer.knifeHeavy = false;
        } else {
            console.warn("Skipping sendPlayerUpdate: dbRefs, dbRefs.playersRef or localPlayerId is null.");
        }


        // Remote avatars update: This loop is for local visual updates/interpolation
        // based on data already received and processed by network.js.
        for (const id in window.remotePlayers) {
            const rp = window.remotePlayers[id];
            if (rp.data) updateRemotePlayer(rp.data); // Assuming rp.data is the latest received network state
        }

        // Weapon Switching
        if (inputState.weaponSwitch) {
            const oldW = window.localPlayer.weapon;
            weaponAmmo[oldW] = weaponController.getCurrentAmmo();
            const newW = inputState.weaponSwitch;
            window.localPlayer.weapon = newW;

            // Update Firebase if dbRefs and localPlayerId are available
            if (dbRefs && dbRefs.playersRef && localPlayerId) {
                try {
                    dbRefs.playersRef.child(localPlayerId).update({
                        weapon: newW
                    });
                } catch (error) {
                    console.error("Failed to update local player weapon in Firebase:", error);
                }
            } else {
                console.warn("Cannot update local player weapon in Firebase: dbRefs or localPlayerId is null.");
            }

            weaponController.equipWeapon(newW);
            weaponController.ammoInMagazine = weaponAmmo[newW] ?? weaponController.stats.magazineSize;
            updateInventory(weaponController.getCurrentAmmo(), weaponController.getMaxAmmo());
            updateAmmoDisplay(weaponController.ammoInMagazine, weaponController.stats.magazineSize);
            inputState.weaponSwitch = null; // Reset input state
            if (newW === "knife") activeRecoils.length = 0; // Clear recoil for knife
        }

        // Mouse Look + Recoil
        const baseSens = parseFloat(localStorage.getItem("sensitivity") || "5.00");
        const aimMul = inputState.aim ? (window.localPlayer.weapon === "marshal" ? 0.15 : 0.5) : 1;
        const finalSens = baseSens * aimMul;

        window.camera.rotation.y -= inputState.mouseDX * finalSens * 0.002;
        let newPitch = window.camera.rotation.x - inputState.mouseDY * finalSens * 0.002;
        window.camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, newPitch));

        // Recoil processing: apply recoil based on active recoil objects
        {
            const now = performance.now() / 1000;
            let totalOffset = 0;
            for (let i = activeRecoils.length - 1; i >= 0; i--) {
                const r = activeRecoils[i];
                const t = (now - r.start) / r.duration; // Normalized time (0 to 1)
                if (t >= 1) {
                    activeRecoils.splice(i, 1); // Recoil effect finished
                    continue;
                }
                totalOffset += r.angle * (1 - t); // Linear decay for simplicity
            }
            window.camera.rotation.x += totalOffset;
        }

        // Rebuild collidables: includes environment meshes and visible remote player body parts
        if (window.mapReady) {
            window.collidables = [...window.envMeshes]; // Start with environment
            for (const otherId in window.remotePlayers) {
                if (otherId === window.localPlayer.id) continue; // Don't collide with self
                const other = window.remotePlayers[otherId];
                if (other.group?.visible) {
                    other.group.traverse(child => {
                        if (child.isMesh && child.userData?.isPlayerBodyPart) {
                            window.collidables.push(child);
                        }
                    });
                }
            }
        }

        // Render the scene
        composer.render();

    } catch (err) {
        console.error("Error in animate:", err);
    } finally {
        postFrameCleanup(); // Ensure cleanup runs even if an error occurs
    }
}



function resetWeaponPose(weaponKey, mesh) {
const M = THREE.MathUtils;
switch (weaponKey) {
case "knife":
mesh.scale.set(0.0007, 0.0007, 0.0007);
mesh.rotation.set(M.degToRad(90), M.degToRad(180), 0);
mesh.position.set(0.5, 0.8 - 1.4, 0);
break;

case "deagle":
mesh.scale.set(0.5, 0.5, 0.5);
mesh.rotation.set(M.degToRad(0), M.degToRad(180), 0);
mesh.position.set(0.5, 0.8 - 1.4, 0);
break;

case "ak-47":
mesh.scale.set(0.4, 0.4, 0.4);
mesh.rotation.set(M.degToRad(0), M.degToRad(180), 0);
mesh.position.set(0.5, 0.8 - 1.4, 0);
break;

case "marshal":
mesh.scale.set(2, 2, 2);
mesh.rotation.set(M.degToRad(0), M.degToRad(0), 0);
mesh.position.set(0.5, 0.8 - 1.4, 0);
break;

default:
console.warn(`resetWeaponPose(): unknown weapon "${weaponKey}"`);
}
}


function attachWeaponToPlayer(playerId, weaponName) {
const key = weaponName.replace(/-/g, "").toLowerCase();
const rp  = window.remotePlayers[playerId];
if (!rp) return;

// 1) Clear any previous model
while (rp.weaponRoot.children.length) {
rp.weaponRoot.remove(rp.weaponRoot.children[0]);
}
// clear any old reference
rp.weaponMesh = null;

// 2) Get preloaded prototype
const proto = _prototypeModels[key];

if (proto && proto.children.length) {
const clone = proto.clone(true);
clone.visible = true;

// 3) Apply original buildX() transforms
switch (key) {
case "knife": {
const s = 0.0007;
clone.scale.set(s, s, s);
clone.rotation.set(
THREE.MathUtils.degToRad(90),
THREE.MathUtils.degToRad(180),
0
);
clone.position.set(0.5, 0.8 - 1.4, 0);
break;
}
case "deagle":
clone.scale.set(0.5, 0.5, 0.5);
clone.rotation.set(
THREE.MathUtils.degToRad(0),
THREE.MathUtils.degToRad(180),
0
);
clone.position.set(0.5, 0.8 - 1.4, 0);
break;
case "ak47":
clone.position.set(0.5, 0.8 - 1.4, 0);
clone.scale.set(0.4, 0.4, 0.4);
clone.rotation.set(
THREE.MathUtils.degToRad(0),
THREE.MathUtils.degToRad(180),
0
);
break;
case "marshal":
clone.scale.set(2, 2, 2);
clone.rotation.set(
THREE.MathUtils.degToRad(0),
THREE.MathUtils.degToRad(0),
0
);
clone.position.set(0.5, 0.8 - 1.4, 0);
break;
default:
console.warn(`attachWeaponToPlayer(): Unknown weapon "${key}"`);
return;
}

// 4) Parent it under the hand and record for animation
rp.weaponRoot.add(clone);
rp.weaponMesh = clone;
rp.currentWeapon = key;
// console.log(`[${playerId}] attached prototype "${key}" as weaponMesh`, clone);
return;
}

// 5) Knife fallback only if prototype isn't ready
if (key === "knife") {
console.warn(`[attachWeaponToPlayer] Knife prototype missing — fallback to live build`);
const tempWC = new WeaponController(new THREE.Group());
tempWC.buildKnife((knifeGroup) => {
knifeGroup.visible = true;
knifeGroup.scale.set(0.001, 0.001, 0.001);
knifeGroup.rotation.set(
THREE.MathUtils.degToRad(90),
THREE.MathUtils.degToRad(160),
0
);
knifeGroup.position.set(0.5, -0.1, -0.7);

rp.weaponRoot.add(knifeGroup);
rp.weaponMesh = knifeGroup;
rp.currentWeapon = "knife";
console.log(`[${playerId}] attached fallback knife as weaponMesh`, knifeGroup);
});
} else {
console.warn(`attachWeaponToPlayer(): No prototype available for "${key}"`);
}
}





// Optionally, re-attach on resize so your players’ weapons stay in the right spot:
window.addEventListener("resize", () => {
Object.keys(window.remotePlayers).forEach(pid => {
const wp = window.remotePlayers[pid].currentWeapon;
if (wp) attachWeaponToPlayer(pid, wp);
});
});

function animateDeath(targetId) {
// console.log('[animateDeath] called for', targetId);
const entry = window.remotePlayers[targetId];
if (!entry || !entry.group) {
console.warn('[animateDeath] missing entry or group for', targetId, entry);
return;
}
// Mark for falling/sinking. In updateRemotePlayer, death logic expects group.userData.isFalling:
entry.group.userData.isFalling = true;
entry.group.userData.velocityY = 0;
// console.log('[animateDeath] marked isFalling & set velocityY=0 for', targetId);
}


// — DAMAGE CALLBACK (Called by WeaponController when a remote player is hit) —
// This function needs to be globally accessible for WeaponController to call it.

// -------------------------------------------------------------
// Applies damage and flashes red, then reverts to originalColor
// -------------------------------------------------------------
// -------------------------------------------------------------
// Applies damage and flashes red, then reverts to originalColor
// -------------------------------------------------------------
function incrementUserStat(username, field, amount) {
  return usersRef
    .child(username)
    .child('stats')
    .child(field)
    .transaction(current => (current || 0) + amount)
    .catch(err => console.warn(`[Stats] ${username}.${field} update failed:`, err));
}

function applyDamageToRemote(targetId, damage, killerInfo) {
    if (targetId === window.localPlayer.id) {
        if (killerInfo && killerInfo.id) {
            const killerEntry = window.remotePlayers[killerInfo.id];
            if (killerEntry && killerEntry.position) {
                lastDamageSourcePosition = killerEntry.position;
            } else {
                console.warn('[applyDamageToRemote] Killer position not found for ID:', killerInfo.id);
                lastDamageSourcePosition = null;
            }
        } else {
            lastDamageSourcePosition = null;
        }
    }

    const entry = window.remotePlayers[targetId];
    if (!entry) {
        console.warn('[applyDamageToRemote] unknown player:', targetId);
        return;
    }

    playersRef.child(targetId).once('value')
        .then(snap => {
            const data = snap.val();
            if (!data || data.isDead) return;

            let newShield = data.shield;
            let newHP = data.health;
            let rem = damage;

            if (newShield > 0) {
                const sd = Math.min(newShield, rem);
                newShield -= sd;
                rem -= sd;
            }
            newHP -= rem;

            const updateData = {
                shield: newShield,
                health: newHP,
                isDead: newHP <= 0
            };

            if (newHP <= 0) {
                incrementUserStat(data.username, 'deaths', 1);

                Object.assign(updateData, {
                    deaths: (data.deaths || 0) + 1,
                    ks: 0,
                    health: 0,
                    shield: 0
                });

                return playersRef.child(targetId)
                    .update(updateData)
                    .then(() => {
                        return playersRef.child(window.localPlayer.id).once('value')
                            .then(snap2 => {
                                const kd = snap2.val() || {};
                                const newKills = (kd.kills || 0) + 1;
                                const newKS    = (kd.ks    || 0) + 1;

                                window.localPlayer.kills = newKills;
                                window.localPlayer.ks    = newKS;

                                return playersRef.child(window.localPlayer.id)
                                    .update({ kills: newKills, ks: newKS })
                                    .then(() => {
                                        incrementUserStat(window.localPlayer.username, 'kills', 1);

                                        if (killerInfo.id === window.localPlayer.id) {
                                            const streak = newKS >= 10 ? 10 : newKS;
                                            const url = typeof KILLSTREAK_SOUNDS !== 'undefined' ? KILLSTREAK_SOUNDS[streak] : null;
                                            if (url) {
                                                const audio = new Audio(url);
                                                audio.play();
                                            }
                                            pulseScreenWhite();
                                        }
                                    });
                            });
                    })
                    .then(() => {
                        animateDeath(targetId);
                        if (targetId === window.localPlayer.id) {
                            handleLocalDeath();
                        }
                        if (typeof killsRef !== 'undefined') {
                            return killsRef.push({
                                killer:    window.localPlayer.username,
                                victim:    data.username,
                                weapon:    window.localPlayer.weapon,
                                timestamp: Date.now()
                            });
                        }
                        return Promise.resolve();
                    });
            } else {
                if (typeof pulsePlayerHit !== 'undefined') {
                    pulsePlayerHit(targetId);
                }
                return playersRef.child(targetId)
                    .update(updateData);
            }
        })
        .catch(err => console.error('[applyDamageToRemote]', err));
}

window.applyDamageToRemote = applyDamageToRemote;

// --- NEW: Global FFA Active Flag ---
// This flag allows applyDamageToRemote to know if FFA mode is active.
// Set it inside startGame after the ffaEnabled check.
// You might want to adjust its placement based on your overall game state management.
// For example, if you have a dedicated game state object, store it there.
// For now, placing it after startGame to indicate it's set by startGame.
let isFFAActive = false;
window.isFFAActive = isFFAActive;


// — CLEANUP ON UNLOAD —
// Ensure player data is removed from Firebase when the window is closed/reloaded
window.addEventListener("beforeunload", () => {
if (localPlayer) {
playersRef.child(localPlayer.id).remove();
}
// Clear pruning intervals to prevent memory leaks
clearInterval(chatPruneInterval);
clearInterval(killsPruneInterval);
});


document.addEventListener("bulletHoleRemoved", (e) => {
const { id } = e.detail;
const hole = bulletHoleMeshes[id];
if (hole) {
scene.remove(hole);
hole.geometry.dispose();
hole.material.dispose();
delete bulletHoleMeshes[id];
}
});

document.addEventListener("keydown", (e) => {
// Normalize to lowercase so both 'g' and 'G' work.
setTimeout(() => {
if (e.key.toLowerCase() === "g") {
// Only call respawnPlayer() if the overlay is currently shown.


if (respawnOverlay && respawnOverlay.style.display === "flex") {
respawnPlayer();
}
}
}, 200);
});

let prevHealth = 0;
let prevShield = 0;

function checkForDamagePulse() {
// If localPlayer isn't ready, bail out
if (!window.localPlayer) return;

// Only proceed if health/shield are numbers
const hasHealth = typeof window.localPlayer.health === 'number';
const hasShield = typeof window.localPlayer.shield === 'number';

// If we haven’t initialized prevs yet, do it now
if (prevHealth === null || prevShield === null) {
prevHealth = hasHealth ? window.localPlayer.health : 0;
prevShield = hasShield ? window.localPlayer.shield : 0;
return;
}

const health = hasHealth ? window.localPlayer.health : prevHealth;
const shield = hasShield ? window.localPlayer.shield : prevShield;

if (health < prevHealth || shield < prevShield) {
pulseScreenRed();

// If there's information about the last damage source, show the arrow
if (lastDamageSourcePosition) {
const localPlayerPos = window.localPlayer.position; // Assuming localPlayer has a position

// Calculate angle from damage source to local player
const deltaX = lastDamageSourcePosition.x - localPlayerPos.x;
const deltaY = lastDamageSourcePosition.y - localPlayerPos.y;

const angleRad = Math.atan2(deltaY, deltaX);
let angleDeg = angleRad * (180 / Math.PI);

// Adjust angle to make 0 degrees point up, and arrow points from source to player
// If source is right (+X), arrow should point left (180 deg)
// If source is up (-Y), arrow should point down (90 deg)
// This flips the angle to point *towards* the player from the source.
angleDeg = (angleDeg + 180) % 360;

showHitDirectionArrow(angleDeg);
console.log(angleDeg);
// Clear the damage source info after using it
lastDamageSourcePosition = null;
}
}

prevHealth = health;
prevShield = shield;
}
