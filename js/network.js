// network.js
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

// f
// New imports for game slot management
import {
    claimGameSlot,
    releaseGameSlot,
    gamesRef,
    gameDatabaseConfigs
} from "./firebase-config.js";

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

window.addEventListener('beforeunload', async () => {
  try {
    // detach your listeners
    if (playersListener) playersRef.off('value', playersListener);

    // delete your own record
    if (localPlayerId) {
      await playersRef.child(localPlayerId).remove();
      console.log(`Player ${localPlayerId} removed`);
    }
    // NO need to call full cleanup here
  } catch (e) {
    console.error("Error in unload cleanup:", e);
  }
});

// add this:
export function setActiveGameId(id) {
  activeGameId = id;
}

async function attemptFullCleanup() {
  // 1) Read how many players remain
  const snap = await dbRefs.playersRef.once("value");
  if (snap.exists() && snap.numChildren() > 0) {
    console.log("Other players remain—skipping full cleanup.");
    return;
  }

  console.log("No players left—running full cleanup…");
  // 2) Release the game slot
  if (activeGameSlotName) {
    await releaseGameSlot(activeGameSlotName);
    console.log(`Slot ${activeGameSlotName} released.`);
    activeGameSlotName = null;
  }
  // 3) Remove the lobby entry
  if (activeGameId) {
    await gamesRef.child(activeGameId).remove();
    console.log(`Lobby entry ${activeGameId} removed.`);
  }
  // 4) Delete the entire /game node
  const slotApp = firebase.app(initialSlotName + "App");
  const rootRef  = slotApp.database().ref();
  await rootRef.child("game").remove();
  console.log("/game node removed for slot", initialSlotName);
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

export function applyDamageToRemote(targetId, damage, killerInfo) {
    if (!dbRefs.playersRef) { // Check for playersRef from the current game slot
        console.warn("dbRefs not initialized for damage application.");
        return;
    }
    const pRef = dbRefs.playersRef.child(targetId);
    pRef.transaction((current) => {
        if (!current) return;
        const prevHealth = current.health || 0;
        let { shield = 0, health = prevHealth, deaths = 0, ks = 0 } = current;
        let remaining = damage;
        if (shield > 0) {
            const sDmg = Math.min(shield, remaining);
            shield -= sDmg;
            remaining -= sDmg;
        }
        health -= remaining;
        const justDied = prevHealth > 0 && health <= 0;
        if (justDied) {
            deaths += 1;
            ks = 0; // Reset killstreak on death
            health = 0; // Ensure health doesn't go negative on death
            shield = 0; // Ensure shield is 0 on death
        }
        return { ...current, health, shield, deaths, ks, isDead: health <= 0, _justDied: justDied };
    }, (error, committed, snap) => {
        if (error) {
            console.error("Firebase transaction failed for damage:", error);
            return;
        }
        if (!committed) return;
        const updated = snap.val();
        console.log(`Player ${targetId} → H:${updated.health} S:${updated.shield} Dead:${updated.isDead}`);

        if (updated._justDied && killerInfo && localPlayerId === killerInfo.killerId) {
            dbRefs.playersRef.child(localPlayerId).transaction(currentKiller => {
                if (!currentKiller) return;
                currentKiller.kills = (currentKiller.kills || 0) + 1;
                currentKiller.ks = (currentKiller.ks || 0) + 1;
                return currentKiller;
            }).then(() => {
                dbRefs.killsRef.push({
                    killer: killerInfo.killerUsername,
                    victim: updated.username,
                    weapon: killerInfo.weapon,
                    timestamp: firebase.database.ServerValue.TIMESTAMP
                }).catch(err => console.error("Failed to record kill:", err));
            }).catch(err => console.error("Failed to update killer stats:", err));

            if (targetId === localPlayerId) {
                // If local player died, notify game.js
                handleLocalDeath(killerInfo.killerUsername);
            }
        }
    });
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
    if (dbRefs.chatRef) { // Check for chatRef from the current game slot
        dbRefs.chatRef.push({ username, text, timestamp: Date.now() }).catch((err) => console.error("Failed to send chat message:", err));
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
        dbRefs.playersRef.child(playerId).remove()
            .then(() => {
                console.log(`Local player ${playerId} removed from Firebase.`);
                // Note: The `child_removed` listener for `localPlayerId` will handle `localStorage.removeItem("playerId")`
                // and `location.reload()`, so we don't duplicate that here.
            })
            .catch(err => console.error("Failed to remove local player from Firebase:", err));

        localPlayerId = null; // Setting localPlayerId to null will also stop the animate loop in game.js
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

    // Detach all Firebase listeners from the current game database
    if (playersListener && dbRefs.playersRef) {
        dbRefs.playersRef.off("value", playersListener);
        playersListener = null;
        console.log("Players listener detached.");
    }
    if (chatListener && dbRefs.chatRef) {
        dbRefs.chatRef.off("child_added", chatListener);
        chatListener = null;
        console.log("Chat listener detached.");
    }
    if (killsListener && dbRefs.killsRef) {
        dbRefs.killsRef.off("child_added", killsListener);
        killsListener = null;
        console.log("Kills listener detached.");
    }
    if (mapStateListener && dbRefs.mapStateRef) {
        dbRefs.mapStateRef.child("bullets").off("child_added", mapStateListener);
        mapStateListener = null;
        console.log("MapState/bullets listener detached.");
    }
    if (tracersListener && dbRefs.tracersRef) {
        dbRefs.tracersRef.off("child_added", tracersListener);
        tracersListener = null;
        console.log("Tracers listener detached.");
    }
    if (soundsListener && dbRefs.soundsRef) {
        dbRefs.soundsRef.off("child_added", soundsListener);
        soundsListener = null;
        console.log("Sounds listener detached.");
    }
    if (gameConfigListener && dbRefs.gameConfigRef) {
        dbRefs.gameConfigRef.off("value", gameConfigListener);
        gameConfigListener = null;
        console.log("GameConfig listener detached.");
    }

    if (audioManagerInstance) {
        audioManagerInstance.stopAll();
    }

    if (dbRefs.playersRef && localPlayerId) {
        try {
            await dbRefs.playersRef.child(localPlayerId).remove();
            console.log(`Local player '${localPlayerId}' explicitly removed from Firebase.`);
          //  dbRefs.playersRef.child(localPlayerId).onDisconnect().cancel();
        } catch (error) {
            console.error(`Error removing local player '${localPlayerId}' from Firebase during cleanup:`, error);
        }
    }

    // Release the game slot and remove the lobby entry
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

  // 1) look up slotName from the game entry
  const slotSnap = await gamesRef.child(gameId).child('slot').once('value');
  const slotName = slotSnap.val();
  if (!slotName) {
    Swal.fire('Error','No slot associated with that game ID.','error');
    return false;
  }
activeGameId = gameId;
  // ─── MANUAL SLOT INITIALIZATION (instead of claimGameSlot) ───
  activeGameSlotName = slotName;

  // Pick the right config object from your firebase-config.js
  const slotConfig = gameDatabaseConfigs[slotName];
  if (!slotConfig) {
    console.error(`No firebase config found for slot "${slotName}"`);
    return false;
  }

  // Initialize—or re‑use if already initialized—the slot‑specific app
  let slotApp;
  try {
    slotApp = firebase.app(slotName + 'App');
  } catch (e) {
    slotApp = firebase.initializeApp(slotConfig, slotName + 'App');
  }

  // Build your DB refs exactly as claimGameSlot would have done
  const rootRef = slotApp.database().ref();
  dbRefs = {
    playersRef:    rootRef.child('players'),
    chatRef:       rootRef.child('chat'),
    killsRef:      rootRef.child('kills'),
    mapStateRef:   rootRef.child('mapState'),
    tracersRef:    rootRef.child('tracers'),
    soundsRef:     rootRef.child('sounds'),
    gameConfigRef: rootRef.child('gameConfig'),
  };
  setUIDbRefs(dbRefs);
  console.log(`[network.js] Using existing slot "${slotName}" with DB URL ${slotConfig.databaseURL}`);
  const currentPlayersSnap = await dbRefs.playersRef.once('value');
  if (currentPlayersSnap.numChildren() >= 10) {
    Swal.fire({
      icon: 'warning',
      title: 'Game Full',
      text: 'Sorry, this game slot already has 10 players.'
    });
    return false;
  }
    // --- CONSOLE LOG ADDED HERE ---
    if (dbRefs.playersRef && dbRefs.playersRef.database && dbRefs.playersRef.database.app_ && dbRefs.playersRef.database.app_.options) {
        console.log(`[network.js] Game is connected to Firebase database: ${dbRefs.playersRef.database.app_.options.databaseURL}`);
    } else {
        console.warn("[network.js] Could not determine database URL from dbRefs.playersRef.database.app_.options. This might be expected if dbRefs are not fully initialized yet or structure is different.");
    }
    console.log("[network.js] dbRefs after claiming slot (from network.js):", dbRefs);
    // --- END CONSOLE LOG ---

    // Set localPlayerId
    let storedPlayerId = localStorage.getItem(`playerId-${activeGameSlotName}`);
    if (storedPlayerId) {
        localPlayerId = storedPlayerId;
        console.log(`[network.js] Re-using localPlayerId for slot '${activeGameSlotName}':`, localPlayerId);
    } else {
        // Ensure that dbRefs.playersRef is available before trying to push
        if (!dbRefs.playersRef) {
             console.error("[network.js] dbRefs.playersRef is not defined. Cannot generate localPlayerId.");
             // Attempt to release the slot if it was claimed but playerRef isn't ready
             if (activeGameSlotName) await releaseGameSlot(activeGameSlotName);
             return false;
        }
        localPlayerId = dbRefs.playersRef.push().key; // Generate a new player ID
        localStorage.setItem(`playerId-${activeGameSlotName}`, localPlayerId);
        console.log(`[network.js] Generated new localPlayerId for slot '${activeGameSlotName}':`, localPlayerId);
    }
    window.localPlayerId = localPlayerId; // Ensure it's accessible globally if needed by game.js directly

    // Set onDisconnect for the *game-specific* player reference
    // This removes the player's data from the active game DB if they disconnect
    dbRefs.playersRef.child(localPlayerId).onDisconnect().remove()
        .then(() => console.log(`[network.js] onDisconnect set for player '${localPlayerId}' in game DB.`))
        .catch(err => console.error(`[network.js] Error setting onDisconnect for player '${localPlayerId}':`, err));

    // Initial player state
    const initialPlayerState = {
        id: localPlayerId,
        username,
        x: 0, y: 0, z: 0, // These will be overwritten by game.js's spawn point
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
        await dbRefs.playersRef.child(localPlayerId).set(initialPlayerState);
        console.log("Local player initial state set in Firebase for slot:", activeGameSlotName);
    } catch (err) {
        console.error("Failed to set initial player data:", err);
        Swal.fire({
            icon: 'error',
            title: 'Firebase Error',
            text: 'Could not write initial player data. Please check connection and try again.'
        });
        // Release the slot if we failed to set initial player data
        if (activeGameSlotName) await releaseGameSlot(activeGameSlotName);
        return false;
    }

    // Setup listeners for the new game's database
    setupPlayersListener(dbRefs.playersRef);
    setupChatListener(dbRefs.chatRef);
    setupKillsListener(dbRefs.killsRef);
    setupMapStateListener(dbRefs.mapStateRef);
    startSoundListener(); // Uses dbRefs.soundsRef internally
    setupTracerListener(dbRefs.tracersRef);
    // Note: gameConfig listener is typically set up in game.js for timer management

    console.log("[network.js] Network initialization complete.");
    return true; // Indicate success
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

        // Use the captured initialSlotName for operations that require it
        if (!initialSlotName) {
            console.warn("[fullCleanup] No initial active game slot found during fullCleanup, skipping slot-specific database removal.");
            // We can still proceed with other cleanup steps, just skip the slot-specific ones.
            // DO NOT THROW AN ERROR HERE, as endGameCleanup already did its job.
        } else {
            const slotApp = firebase.app(initialSlotName + "App");
            const rootRef = slotApp.database().ref();
            console.log("[fullCleanup] ✓ slot rootRef acquired for", initialSlotName);

            // 2) Delete game data from the specific slot's database
            await rootRef.child("game").remove();
            console.log("[fullCleanup] ✓ removed /game node");

            await Promise.all([
                rootRef.child("players").remove(),
                rootRef.child("chat").remove(),
                rootRef.child("kills").remove(),
                rootRef.child("mapState").remove(),
                rootRef.child("tracers").remove(),
                rootRef.child("sounds").remove(),
                rootRef.child("gameConfig").remove(),
            ]);
            console.log("[fullCleanup] ✓ cleared players, chat, kills, mapState, tracers, sounds, gameConfig from slot DB");

            // 3) Free the slot in slotsRef (if endGameCleanup didn't already handle it, which it should have)
            // This call is redundant if endGameCleanup correctly releases the slot.
            // Consider if `releaseGameSlot` should ONLY be in `endGameCleanup`.
            // If `releaseGameSlot` is robust and handles being called multiple times, it's fine.
            // If not, you might remove this line here.
            // For now, let's assume endGameCleanup already released it.
            // await releaseGameSlot(initialSlotName);
            // console.log(`[fullCleanup] ✓ releaseGameSlot(${initialSlotName}) complete (might be redundant)`);
        }

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
    if (killsListener) killsRef.off("child_added", killsListener); // Detach previous
    killsListener = killsRef.limitToLast(5).on("child_added", (snap) => {
        const k = snap.val();
        updateKillFeed(k.killer, k.victim, k.weapon, snap.key);
        updateScoreboard(dbRefs.playersRef); // This will cause full scoreboard refresh
    });

    // Kills cleanup interval
    // Clear any previous interval to prevent multiple from running
    if (window.killsCleanupInterval) {
        clearInterval(window.killsCleanupInterval);
    }
    window.killsCleanupInterval = setInterval(() => {
        const cutoff = Date.now() - 60000; // 1 minute cutoff
        killsRef.orderByChild("timestamp").endAt(cutoff).once("value", (snapshot) => {
            snapshot.forEach(child => child.ref.remove());
        });
    }, 60000); // Run every minute
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
