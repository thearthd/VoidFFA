// network.js
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

// ff
// New imports for game slot management
import {
    claimGameSlot,
    releaseGameSlot,
    gamesRef,
    gameDatabaseConfigs,
    initGameFirebaseApp
} from "./firebase-config.js";

import { isMessageClean } from './chatFilter.js';

// Re-importing existing functions from game.js and ui.js
// Ensure these paths are correct relative to network.js
import {
    addRemotePlayer,
    removeRemotePlayer as removeRemotePlayerModel,
    updateRemotePlayer,
    handleLocalDeath // Assuming this handles respawn too
} from "./game.js";

import {
    addChatMessage,
    updateKillFeed,
    updateScoreboard,
    createTracer,
    removeTracer,
    updateHealthShieldUI,
    setUIDbRefs, // This will be used to pass the game-specific dbRefs to UI
    addBulletHole,
    removeBulletHole
} from "./ui.js";

import { WeaponController } from "./weapons.js";
import { AudioManager } from "./AudioManager.js";
import { SOUND_CONFIG } from './soundConfig.js'; // Ensure the path is correct

const PHYSICS_SOUNDS = {
    footstep: { run: 'https://codehs.com/uploads/616ef1b61061008f9993d1ab4fa323ba' },
    landingThud: { land: 'https://codehs.com/uploads/600ab769d99d74647db55a468b19761f' }
};

export let localPlayerId = null;
export const remotePlayers = {}; // This is where Three.js objects for remote players are stored
const permanentlyRemoved = new Set(); // Tracks players confirmed disconnected
let latestValidIds = []; // Used in purgeNamelessPlayers

let audioManagerInstance = null;
export let dbRefs = {}; // Will hold game-specific Firebase references (playersRef, chatRef, etc.)

let activeGameSlotName = null; // Stores the name of the currently claimed game slot

// Store listeners so they can be detached
let playersListener = null;
let chatListener = null;
let killsListener = null;
let mapStateListener = null;
let tracersListener = null;
let soundsListener = null;
let gameConfigListener = null; // New listener for game config changes (e.g., timer)


// --- Core AudioManager Initialization & Listener Functions (from your original code) ---

export function initializeAudioManager(camera, scene) {
    console.log("Attempting to initialize AudioManager...");
    if (!camera || !scene) {
        console.error("Cannot initialize AudioManager: Camera or Scene are undefined/null. AudioManager will not be created.");
        return;
    }
    if (audioManagerInstance) {
        console.warn("AudioManager already initialized. Stopping existing sounds and reinitializing.");
        audioManagerInstance.stopAll();
    }
    audioManagerInstance = new AudioManager(camera, scene, { hearingRange: 50 });
    window.audioManager = audioManagerInstance; // Global access for game.js
    console.log("AudioManager successfully initialized with camera:", camera.uuid, "at initial position:", camera.position.toArray());
}

export let activeGameId = null;

// add this:
export function setActiveGameId(id) {
  activeGameId = id;
}

export function startSoundListener() {
  if (!dbRefs || !dbRefs.soundsRef) {
    console.error("Cannot start sound listener: dbRefs or soundsRef not initialized.");
    return;
  }

  dbRefs.soundsRef.off();

  dbRefs.soundsRef.on("child_added", (snap) => {
    const data = snap.val();
    const soundRef = snap.ref;

    if (!data || data.shooter === localPlayerId) {
      if (data.shooter === localPlayerId) {
        setTimeout(() => {
          soundRef.remove().catch(err => console.error("Failed to remove own sound event from Firebase:", err));
        }, 10000);
      }
      return;
    }

    setTimeout(() => {
      soundRef.remove().catch(err => console.error("Failed to remove sound event from Firebase after 10s:", err));
    }, 3000);

    const url = WeaponController.SOUNDS[data.soundKey]?.[data.soundType] ??
      PHYSICS_SOUNDS[data.soundKey]?.[data.soundType];

    if (!url) {
      console.warn(`No URL found for soundKey: ${data.soundKey}, soundType: ${data.soundType}`);
      return;
    }

    const worldPos = new THREE.Vector3(data.x, data.y, data.z);

    if (audioManagerInstance) {
      // Get sound properties from SOUND_CONFIG
      const soundProps = SOUND_CONFIG[data.soundKey]?.[data.soundType];
      if (soundProps) {
        audioManagerInstance.playSpatial(
          url,
          worldPos,
          {
            loop: soundProps.loop ?? false, // Default to false if not specified
            volume: soundProps.volume,
            hearingRange: soundProps.hearingRange,
            rolloffFactor: soundProps.rolloffFactor,
            distanceModel: soundProps.distanceModel
          }
        );
      } else {
        // Fallback to default values if not found in SOUND_CONFIG
        console.warn(`Sound properties not found for ${data.soundKey}:${data.soundType}. Playing with defaults.`);
        audioManagerInstance.playSpatial(url, worldPos, { loop: false, volume: 1, hearingRange: 100, rolloffFactor: 2, distanceModel: 'linear' });
      }
    } else {
      console.warn("AudioManager not initialized when trying to play spatial sound (after startSoundListener called).");
    }
  });
  console.log("Firebase sound listener started.");
}


// --- Player Data Update Functions (from your original code) ---

let lastSync = 0;
export function sendPlayerUpdate(data) {
    const now = Date.now();
    if (now - lastSync < 50) return; // Limit update frequency
    lastSync = now;
    if (dbRefs.playersRef && localPlayerId) { // Check for playersRef from the current game slot
        dbRefs.playersRef.child(localPlayerId).update({
            x: data.x,
            y: data.y,
            z: data.z,
            rotY: data.rotY,
            weapon: data.weapon,
            lastUpdate: now,
            knifeSwing: data.knifeSwing, // Include knife animation states
            knifeHeavy: data.knifeHeavy
        }).catch(err => console.error("Failed to send player update:", err));
    } else {
        // console.warn("Attempted to send player update before network initialized or localPlayerId is null."); // Too chatty
    }
}

export function updateHealth(health) {
    if (dbRefs.playersRef && localPlayerId) {
        dbRefs.playersRef.child(localPlayerId).update({ health }).catch(err => console.error("Failed to update health:", err));
    }
}

export function updateShield(shield) {
    if (dbRefs.playersRef && localPlayerId) {
        dbRefs.playersRef.child(localPlayerId).update({ shield }).catch(err => console.error("Failed to update shield:", err));
    }
}
// --- Event Sending Functions (Tracers, Chat, Bullet Holes, Sounds) ---

export function sendTracer(tracerData) {
    if (dbRefs.tracersRef) { // Check for tracersRef from the current game slot
        dbRefs.tracersRef.push({
            ...tracerData,
            shooter: localPlayerId,
            time: firebase.database.ServerValue.TIMESTAMP
        }).catch((err) => console.error("Failed to send tracer:", err));
    } else {
        // console.warn("Attempted to send tracer before network initialized or dbRefs.tracersRef is null."); // Too chatty
    }
}

export function sendChatMessage(username, text) {
    if (!isMessageClean(text)) {
        console.warn("Message blocked due to profanity/slurs");
        return;
    }

    if (dbRefs.chatRef) { // Check for chatRef from the current game slot
        dbRefs.chatRef.push({ username, text, timestamp: Date.now() })
            .catch((err) => console.error("Failed to send chat message:", err));
    } else {
        console.warn("Attempted to send chat message before network initialized.");
    }
}
export function sendBulletHole(pos) {
    if (dbRefs.mapStateRef) { // Check for mapStateRef from the current game slot
        dbRefs.mapStateRef.child("bullets").push({
            x: pos.x, y: pos.y, z: pos.z,
            nx: pos.nx, ny: pos.ny, nz: pos.nz,
            timeCreated: Date.now() // Use Date.now() for client-side timestamp
        }).catch(err => console.error("Failed to send bullet hole:", err));
    } else {
        // console.warn("Attempted to send bullet hole before network initialized or dbRefs.mapStateRef is null."); // Too chatty
    }
}

export function sendSoundEvent(soundKey, soundType, position) {
    if (dbRefs.soundsRef) { // Check for soundsRef from the current game slot
        const soundProps = SOUND_CONFIG[soundKey]?.[soundType];
        if (!soundProps) {
            console.warn(`Sound properties for ${soundKey}:${soundType} not found in SOUND_CONFIG. Event will be sent with minimal data.`);
            dbRefs.soundsRef.push({
                soundKey, soundType,
                x: position.x, y: position.y, z: position.z,
                shooter: localPlayerId,
                time: firebase.database.ServerValue.TIMESTAMP
            }).catch(err => console.error("Failed to send sound event:", err));
            return;
        }

        dbRefs.soundsRef.push({
            soundKey,
            soundType,
            x: position.x,
            y: position.y,
            z: position.z,
            shooter: localPlayerId,
            time: firebase.database.ServerValue.TIMESTAMP,
            volume: soundProps.volume,
            hearingRange: soundProps.hearingRange,
            rolloffFactor: soundProps.rolloffFactor,
            distanceModel: soundProps.distanceModel,
            loop: soundProps.loop ?? false
        }).catch(err => console.error("Failed to send sound event:", err));
    } else {
        console.warn("Attempted to send sound event before network initialized or dbRefs.soundsRef is null.");
    }
}

export async function disposeGame() {
  console.log("[network.js] Disposing game…");

  // 1) Run your existing cleanup of Firebase + slot
  await endGameCleanup();

  // 2) Clear any game‑side intervals and listeners
  if (window.gameInterval) {
    clearInterval(window.gameInterval);
    window.gameInterval = null;
  }
  if (window.playersKillsListener && window.dbRefs?.playersRef) {
    window.dbRefs.playersRef.off("value", window.playersKillsListener);
    window.playersKillsListener = null;
  }

  // 3) Cancel the animation loop
  if (window._animationId != null) {
    cancelAnimationFrame(window._animationId);
    window._animationId = null;
  }

  // 4) Stop all audio
  if (window.audioManager) {
    window.audioManager.stopAll();
  }
  [ window.deathTheme, window.windSound, window.forestNoise ]
    .forEach(sound => { if (sound && sound.pause) sound.pause(); });

  console.log("[network.js] Game disposed.");
}

// --- Player Purging and Disconnection ---

export function purgeNamelessPlayers(validIds = []) {
    Object.keys(remotePlayers).forEach(id => {
        const rp = remotePlayers[id];
        // If player has no username (indicates incomplete data) OR is not in the latest valid IDs list
        if (!rp?.data?.username || (validIds.length && !validIds.includes(id))) {
            permanentlyRemoved.add(id);
            console.log(`[purgeNameless] Permanently removing ${id}`);
            removeRemotePlayerModel(id);
        }
    });
}

export function disconnectPlayer(playerId) {
    if (!dbRefs.playersRef) {
        console.warn("Cannot disconnect player: dbRefs not initialized.");
        return;
    }

    if (playerId === localPlayerId) {
        console.log("Disconnecting local player:", playerId);
        remove(ref(dbRefs.playersRef, playerId))
            .then(() => {
                console.log(`Local player ${playerId} removed from Firebase.`);
            })
            .catch(err => console.error("Failed to remove local player from Firebase:", err));

        localPlayerId = null;
    } else {
        console.log("Disconnecting remote player:", playerId);
        removeRemotePlayerModel(playerId);
        delete remotePlayers[playerId];
        permanentlyRemoved.add(playerId);
    }
}

window.disconnectPlayer = disconnectPlayer; // Make accessible globally for button presses etc.

// --- Game End Cleanup ---

export async function endGameCleanup() {
    console.log("[network.js] Running endGameCleanup...");

    if (playersListener) {
        onValue(dbRefs.playersRef, () => {});
        playersListener = null;
        console.log("Players listener detached.");
    }
    if (chatListener) {
        onValue(dbRefs.chatRef, () => {});
        chatListener = null;
        console.log("Chat listener detached.");
    }
    if (killsListener) {
        onValue(dbRefs.killsRef, () => {});
        killsListener = null;
        console.log("Kills listener detached.");
    }
    if (mapStateListener) {
        onValue(dbRefs.mapStateRef, () => {});
        mapStateListener = null;
        console.log("MapState listener detached.");
    }
    if (tracersListener) {
        onValue(dbRefs.tracersRef, () => {});
        tracersListener = null;
        console.log("Tracers listener detached.");
    }
    if (soundsListener) {
        onValue(dbRefs.soundsRef, () => {});
        soundsListener = null;
        console.log("Sounds listener detached.");
    }
    if (gameConfigListener) {
        onValue(dbRefs.gameConfigRef, () => {});
        gameConfigListener = null;
        console.log("GameConfig listener detached.");
    }

    if (audioManagerInstance) {
        audioManagerInstance.stopAll();
        console.log("Audio manager stopped all sounds.");
    }

    if (dbRefs.playersRef && localPlayerId) {
        try {
            const playerRef = ref(dbRefs.playersRef, localPlayerId);
            const db = getDatabase(firebase.app(activeGameSlotName + "App"));
            await remove(playerRef);
            console.log(`Local player '${localPlayerId}' explicitly removed from Firebase.`);
        } catch (error) {
            console.error(`Error removing local player '${localPlayerId}' from Firebase during cleanup:`, error);
        }
    }

    if (activeGameSlotName) {
        await releaseGameSlot(activeGameSlotName);
        console.log(`Game slot '${activeGameSlotName}' released AND lobby entry removed.`);
        localStorage.removeItem(`playerId-${activeGameSlotName}`);
        activeGameSlotName = null;
    }

    localPlayerId = null;
    dbRefs = {};
    
    for (const id in remotePlayers) {
        removeRemotePlayerModel(id);
    }
    for (const key in remotePlayers) {
        delete remotePlayers[key];
    }
    permanentlyRemoved.clear();
    latestValidIds = [];

    console.log("[network.js] Game cleanup complete. All listeners detached and data cleared.");
}


/**
 * Initializes the network connection for a new game.
 * Claims a game slot, sets up Firebase references, and attaches listeners.
 * @param {string} username - The username of the player joining the game.
 * @param {string} mapName - The name of the map for the game.
 * @param {boolean} ffaEnabled - True if FFA mode is enabled, false otherwise.
 * @returns {Promise<boolean>} True if network initialization was successful, false otherwise.
 */
export async function initNetwork(username, mapName, gameId, ffaEnabled) {
    console.log("[network.js] initNetwork for", username, mapName, gameId, ffaEnabled);
    await endGameCleanup();

    // Use .child() and .once() from the compat SDK
    const slotSnap = await gamesRef.child(gameId + "/slot").once("value");
    const slotName = slotSnap.val();
    if (!slotName) {
        Swal.fire('Error', 'No slot associated with that game ID.', 'error');
        return false;
    }
    activeGameId = gameId;
    activeGameSlotName = slotName;

    const gameAuthResult = await initGameFirebaseApp(slotName);
    if (!gameAuthResult) {
        console.error("Failed to initialize Firebase app or authenticate for game slot.");
        return false;
    }
    const { slotApp, userId, dbRefs: newDbRefs } = gameAuthResult;
    dbRefs = newDbRefs;
    setUIDbRefs(dbRefs);

    // Player count check
    const currentPlayersSnap = await dbRefs.playersRef.once("value");
    const playerCount = currentPlayersSnap.exists() ? Object.keys(currentPlayersSnap.val()).length : 0;
    if (playerCount >= 10) {
        Swal.fire({
            icon: 'warning',
            title: 'Game Full',
            text: 'Sorry, this game slot already has 10 players.'
        });
        return false;
    }

    console.log(`[network.js] Using existing slot "${slotName}" with DB URL ${slotApp.options.databaseURL}`);

    // Force correct ID from auth (guarantees localPlayerId === auth.uid)
    const correctPlayerId = userId; // From Firebase auth
    localStorage.setItem(`playerId-${activeGameSlotName}`, correctPlayerId);
    localPlayerId = correctPlayerId;
    window.localPlayerId = correctPlayerId;
    console.log(`[network.js] Using auth.uid as localPlayerId: ${correctPlayerId}`);

    // Now bind playerRef AFTER correcting ID
    const playerRef = dbRefs.playersRef.child(correctPlayerId);

    // Clean up on disconnect
    try {
        await playerRef.onDisconnect().remove();
        console.log(`[network.js] onDisconnect set for player '${correctPlayerId}'.`);
    } catch (err) {
        console.error(`[network.js] Error setting onDisconnect for player '${correctPlayerId}':`, err);
    }

    const initialPlayerState = {
        id: correctPlayerId,
        username,
        x: 0, y: 0, z: 0,
        rotY: 0,
        health: 100,
        shield: 50,
        weapon: "knife",
        kills: 0,
        deaths: 0,
        ks: 0,
        isDead: false,
        bodyColor: Math.floor(Math.random() * 0xffffff),
        lastUpdate: Date.now()
    };

    try {
        // This will now match your Firebase security rule ".write": "auth.uid === $playerId"
        await playerRef.set(initialPlayerState);
        console.log("Local player initial state set in Firebase for slot:", activeGameSlotName);
    } catch (err) {
        console.error("Failed to set initial player data:", err);
        Swal.fire({
            icon: 'error',
            title: 'Firebase Error',
            text: 'Could not write initial player data. Please check connection and try again.'
        });
        if (activeGameSlotName) await releaseGameSlot(activeGameSlotName);
        return false;
    }

    setupPlayersListener(dbRefs.playersRef);
    setupChatListener(dbRefs.chatRef);
    setupKillsListener(dbRefs.killsRef);
    setupMapStateListener(dbRefs.mapStateRef);
    startSoundListener();
    setupTracerListener(dbRefs.tracersRef);

    console.log("[network.js] Network initialization complete.");
    return true;
}

// --- Listener Setup Functions ---
export async function fullCleanup(gameId) {
    console.log("[fullCleanup] START, gameId =", gameId);

    // ✅ Capture BEFORE cleanup processes which might wipe it
    const initialSlotName = activeGameSlotName; // Capture it here
    const initialLocalPlayerId = localPlayerId;

    try {
        // 1) Detach all listeners & remove local player using the *current* state
        // endGameCleanup will also set activeGameSlotName to null, but we've already captured it.
        await endGameCleanup();
        console.log("[fullCleanup] ✓ endGameCleanup complete");
        // 4) Remove from lobby (this is on the *main* gamesRef, not slot-specific)
        if (gameId) {
            await gamesRef.child(gameId).remove();
            console.log(`[fullCleanup] ✓ removed lobby entry gamesRef/${gameId}`);
        } else {
            console.warn("[fullCleanup] no gameId provided, skipping lobby removal from main gamesRef");
        }

        // 5) Dispose Three.js
        if (window.scene) {
            // Your disposeThreeScene function might need to be imported or globally accessible
            if (typeof disposeThreeScene === 'function') {
                disposeThreeScene(window.scene);
            } else {
                console.warn("[fullCleanup] disposeThreeScene function not found. Skipping scene disposal.");
                // Manual basic cleanup if function isn't available
                window.scene.clear();
                window.scene = null;
            }
            console.log("[fullCleanup] ✓ Three.js scene disposed");
        }
        if (window.camera) {
            window.camera = null;
            console.log("[fullCleanup] ✓ camera reference cleared");
        }

        // 6) Clear pointers (already largely done by endGameCleanup, but good to be explicit for fullCleanup's scope)
        activeGameSlotName = null;
        localPlayerId = null;

        console.log("[fullCleanup] END");
        location.reload();
        return true;

    } catch (err) {
        console.error("[fullCleanup] ERROR during cleanup:", err);
        throw err; // Re-throw to propagate the error if necessary
    }
}

function setupPlayersListener(playersRef) {
    // Detach previous listeners before attaching new ones
    playersRef.off("value");
    playersRef.off("child_added");
    playersRef.off("child_changed");
    playersRef.off("child_removed");

    playersListener = playersRef.on("value", (fullSnap) => {
        const allIds = [];
        fullSnap.forEach(s => allIds.push(s.key));
        latestValidIds = allIds;
        purgeNamelessPlayers(latestValidIds);
        updateScoreboard(playersRef); // Update UI scoreboard
    });

    playersRef.on("child_added", (snap) => {
        const data = snap.val();
        const id = data.id;
        console.log(`[playersRef:child_added] Event for player ID: ${id}`);

        if (id === localPlayerId) {
            console.log(`[playersRef:child_added] Skipping local player ${id}.`);
            return;
        }

        if (permanentlyRemoved.has(id)) {
            permanentlyRemoved.delete(id); // Player re-joined
            console.log(`[permanentlyRemoved] Player ${id} re-joined, clearing from permanent removal list.`);
        }

        // Explicit check to prevent adding a player model if it's already in our local cache
        if (remotePlayers[id]) {
            console.warn(`[playersRef:child_added] Player ${id} already exists in remotePlayers. Skipping model creation.`);
            return;
        }

        // Check for essential data before adding the player model
        if (!data.username) {
            console.warn(`[playersRef:child_added] Player ${id} has incomplete data (missing username). Skipping model creation.`);
            return;
        }

        // If all checks pass, add the remote player model
        addRemotePlayer(data);
    });

    playersRef.on("child_changed", (snap) => {
        const data = snap.val();
        const id = data.id;

        if (permanentlyRemoved.has(id)) {
            removeRemotePlayerModel(id); // Ensure we don't update models of removed players
            return;
        }

        if (id === localPlayerId && window.localPlayer) {
            // Only update localPlayer's health/shield/death status from DB if it changed
            if (typeof data.health === "number") {
                window.localPlayer.health = data.health;
            }
            if (typeof data.shield === "number") {
                window.localPlayer.shield = data.shield;
            }
            if (typeof data.isDead === "boolean") {
                if (!window.localPlayer.isDead && data.isDead) {
                    handleLocalDeath(data.killerUsername || "Unknown Player");
                }
                window.localPlayer.isDead = data.isDead;
            }
            updateHealthShieldUI(window.localPlayer.health, window.localPlayer.shield);

            // Update local player's body color if changed (for visual feedback/debugging)
            if (window.localPlayer.bodyMesh && typeof data.bodyColor === "number" &&
                window.localPlayer.bodyMesh.material.color.getHex() !== data.bodyColor) {
                window.localPlayer.bodyMesh.material.color.setHex(data.bodyColor);
            }
        } else {
            updateRemotePlayer(data); // Update remote player's model and data
        }
    });

    playersRef.on("child_removed", (snap) => {
        const id = snap.key;
        if (id === localPlayerId) {
            console.warn("Local player removed from Firebase. Handling disconnection.");
            localStorage.removeItem(`playerId-${activeGameSlotName}`); // Clear slot-specific ID
            localPlayerId = null; // Ensure game loop knows to stop
            // location.reload(); // Simple reload for now to go back to initial state
            return;
        }
        permanentlyRemoved.add(id);
        removeRemotePlayerModel(id);
    });
}

function setupChatListener(chatRef) {
    if (chatListener) chatRef.off("child_added", chatListener); // Detach previous
    const chatSeenKeys = new Set();
    chatListener = chatRef.on("child_added", (snap) => {
        const { username: u, text } = snap.val();
        const key = snap.key;
        if (chatSeenKeys.has(key)) return;
        chatSeenKeys.add(key);
        addChatMessage(u, text, key);
    });
}

function setupKillsListener(killsRef) {
  // 1) Detach any old child_added listener
  if (killsListener) {
    killsRef.off("child_added", killsListener);
  }

  // 2) Listen to the last 5 kills
  killsListener = killsRef
    .limitToLast(5)
    .on("child_added", (snap) => {
      const k = snap.val() || {};

    updateKillFeed(
      k.killer,
      k.victim,
      k.weapon,
      /* killId: */           snap.key,
      /* isHeadshot: */       Boolean(k.isHeadshot),
      /* isPenetrationShot: */Boolean(k.isPenetrationShot),
    );

      // Also refresh your scoreboard
      updateScoreboard(dbRefs.playersRef);
    });

  // 3) OPTIONAL: auto‐remove entries if Firebase record is deleted
  //    This keeps the DOM in sync if your cleanup interval nukes old kills.
  killsRef.on("child_removed", (snap) => {
    const feed = document.getElementById("kill-feed");
    const entry = feed?.querySelector(`[data-kill-id="${snap.key}"]`);
    if (entry) entry.remove();
  });

  // 4) Cleanup interval: delete old kills from Firebase
  if (window.killsCleanupInterval) {
    clearInterval(window.killsCleanupInterval);
  }
  window.killsCleanupInterval = setInterval(() => {
    const cutoff = Date.now() - 60_000; // 1 minute ago
    killsRef
      .orderByChild("timestamp")
      .endAt(cutoff)
      .once("value", (snapshot) => {
        snapshot.forEach(child => child.ref.remove());
      });
  }, 60_000);
}

function setupMapStateListener(mapStateRef) {
    if (!mapStateRef) {
        console.warn("mapStateRef is not defined, bullet hole synchronization disabled.");
        return;
    }
    // Detach previous listeners for bullets child
    if (mapStateListener) {
        mapStateRef.child("bullets").off("child_added", mapStateListener);
        mapStateRef.child("bullets").off("child_removed");
    }

    mapStateListener = mapStateRef.child("bullets").on("child_added", (snap) => {
        const hole = snap.val();
        const holeKey = snap.key;

        addBulletHole(hole, holeKey); // Call UI function to add locally

        // Schedule removal from Firebase after its visual lifecycle (e.g., 5 seconds)
        setTimeout(() => {
            snap.ref.remove().catch(err => console.error("Failed to remove scheduled bullet hole from Firebase:", err));
        }, Math.max(0, 5000 - (Date.now() - (hole.timeCreated || 0)))); // Ensure positive timeout
    });

    mapStateRef.child("bullets").on("child_removed", (snap) => {
        removeBulletHole(snap.key); // Call UI function to remove locally
    });
}

function setupTracerListener(tracersRef) {
    if (tracersListener) tracersRef.off("child_added", tracersListener); // Detach previous
    tracersListener = tracersRef.on("child_added", (snap) => {
        const { ox, oy, oz, tx, ty, tz, shooter } = snap.val();
        const tracerRef = snap.ref;
        // Remove from Firebase after a short delay (e.g., 1 second)
        setTimeout(() => tracerRef.remove().catch(err => console.error("Failed to remove tracer from Firebase:", err)), 1000);
        // Always create tracer locally for all players, regardless of who shot it
        createTracer(new THREE.Vector3(ox, oy, oz), new THREE.Vector3(tx, ty, tz), snap.key);
    });

    tracersRef.off("child_removed"); // Detach previous
    tracersRef.on("child_removed", (snap) => {
        removeTracer(snap.key);
    });
}


// --- Global Visibility Change Listener (from your original code) ---

document.addEventListener("visibilitychange", () => {
    if (!document.hidden && dbRefs && dbRefs.playersRef) {
        console.log("Tab is visible. Resyncing player data.");
        dbRefs.playersRef.once("value").then(snapshot => {
            const activeFirebasePlayers = new Set();
            snapshot.forEach(snap => {
                const data = snap.val();
                activeFirebasePlayers.add(data.id);
                if (data.id === localPlayerId) return; // Don't process local player as remote

                // Update existing remote players or add new ones if they are in Firebase
                if (remotePlayers[data.id]) {
                    updateRemotePlayer(data);
                } else if (!permanentlyRemoved.has(data.id)) {
                    addRemotePlayer(data);
                }
            });

            // Remove models for players no longer in Firebase
            Object.keys(remotePlayers).forEach(id => {
                if (!activeFirebasePlayers.has(id)) {
                    console.log(`Resync: Player ${id} not found in Firebase. Removing model.`);
                    removeRemotePlayerModel(id);
                    permanentlyRemoved.add(id); // Mark as permanently removed
                }
            });
        }).catch(err => console.error("Error during visibility change resync:", err));
    }
});
