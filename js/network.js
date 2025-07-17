// network.js
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import firebase from "firebase/app"; // Ensure firebase app is imported for ServerValue.TIMESTAMP
import "firebase/database"; // Ensure database module is imported

// New imports for game slot management
import {
    claimGameSlot,
    releaseGameSlot
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

export function startSoundListener() {
    if (!dbRefs || !dbRefs.soundsRef) {
        console.error("Cannot start sound listener: dbRefs or soundsRef not initialized.");
        return;
    }

    dbRefs.soundsRef.off(); // Detach existing listener before adding a new one

    dbRefs.soundsRef.on("child_added", (snap) => {
        const data = snap.val();
        const soundRef = snap.ref;

        // Skip own sounds and remove them after a short delay to avoid cluttering DB
        if (!data || data.shooter === localPlayerId) {
            if (data.shooter === localPlayerId) {
                // Own sounds can be removed quickly as they've been processed locally
                setTimeout(() => {
                    soundRef.remove().catch(err => console.error("Failed to remove own sound event from Firebase:", err));
                }, 500); // Remove faster for self-originated sounds
            }
            return;
        }

        // For other players' sounds, remove after a short delay
        setTimeout(() => {
            soundRef.remove().catch(err => console.error("Failed to remove sound event from Firebase after 3s:", err));
        }, 3000); // Give remote clients time to process

        const url = WeaponController.SOUNDS[data.soundKey]?.[data.soundType] ??
            PHYSICS_SOUNDS[data.soundKey]?.[data.soundType];

        if (!url) {
            console.warn(`No URL found for soundKey: ${data.soundKey}, soundType: ${data.soundType}`);
            return;
        }

        const worldPos = new THREE.Vector3(data.x, data.y, data.z);

        if (audioManagerInstance) {
            const soundProps = SOUND_CONFIG[data.soundKey]?.[data.soundType];
            if (soundProps) {
                audioManagerInstance.playSpatial(
                    url,
                    worldPos, {
                        loop: soundProps.loop ?? false,
                        volume: soundProps.volume,
                        hearingRange: soundProps.hearingRange,
                        rolloffFactor: soundProps.rolloffFactor,
                        distanceModel: soundProps.distanceModel
                    }
                );
            } else {
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
        console.warn("Attempted to send player update before network initialized or localPlayerId is null.");
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
        console.warn("Attempted to send tracer before network initialized or dbRefs.tracersRef is null.");
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
            timeCreated: pos.timeCreated
        }).catch(err => console.error("Failed to send bullet hole:", err));
    } else {
        console.warn("Attempted to send bullet hole before network initialized or dbRefs.mapStateRef is null.");
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
                // We just need to trigger the Firebase removal, and the listener will react.
            })
            .catch(err => console.error("Failed to remove local player from Firebase:", err));

        // Setting localPlayerId to null will also stop the animate loop in game.js
        localPlayerId = null;
    } else {
        console.log("Disconnecting remote player:", playerId);
        removeRemotePlayerModel(playerId);
        delete remotePlayers[playerId];
        permanentlyRemoved.add(playerId);
    }
}
window.disconnectPlayer = disconnectPlayer; // Make accessible globally for button presses etc.

// --- Main Network Initialization Function ---

/**
 * Initializes the game network by claiming a Firebase database slot,
 * setting up local player ID, and attaching all necessary listeners.
 * @param {string} username The username of the local player.
 * @param {string} mapName The name of the map (used for slot claiming).
 * @returns {Promise<boolean>} Resolves true if successful, false if no slot is available.
 */
export async function initNetwork(username, mapName) {
    console.log("[network.js] Initializing network for map:", mapName);

    // --- Step 1: Claim a game slot ---
    const claimedSlot = await claimGameSlot(mapName);

    if (!claimedSlot) {
        Swal.fire({
            icon: 'error',
            title: 'Game Full!',
            text: 'All game slots are currently occupied. Please try again later.'
        }).then(() => {
            window.location.reload(); // Simple reload to get back to menu
        });
        return false; // Indicate failure to start game
    }

    activeGameSlotName = claimedSlot.slotName;
    dbRefs = claimedSlot.dbRefs; // Set the global dbRefs for the *claimed* game slot
    setUIDbRefs(dbRefs); // Pass the new dbRefs to UI module

    // --- Step 2: Establish localPlayerId (slot-specific) ---
    // Use the activeGameSlotName to make the player ID storage specific to the game instance
    let storedPlayerId = localStorage.getItem(`playerId-${activeGameSlotName}`);
    if (!storedPlayerId) {
        const newPlayerRef = dbRefs.playersRef.push(); // Use the playersRef of the *claimed* DB
        storedPlayerId = newPlayerRef.key;
        localStorage.setItem(`playerId-${activeGameSlotName}`, storedPlayerId);
        console.log("New localPlayerId generated for this game slot:", storedPlayerId);
    } else {
        console.log("Re-using localPlayerId for this game slot:", storedPlayerId);
    }
    localPlayerId = storedPlayerId;

    // --- Step 3: Set initial local player state in Firebase and onDisconnect ---
    // This uses the dbRefs of the claimed game slot
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
        return false;
    }

    // Set Firebase onDisconnect for local player (to clean up when browser/tab closes)
    dbRefs.playersRef.child(localPlayerId).onDisconnect().remove()
        .then(() => console.log(`onDisconnect set for local player ${localPlayerId} in ${activeGameSlotName}`))
        .catch(error => console.error("Error setting onDisconnect for player:", error));

    // --- Step 4: Detach existing listeners to prevent duplicates (CRITICAL for re-joining/re-initializing) ---
    // Call .off() on all previously active dbRefs if they were set.
    // This ensures only the listeners for the *newly claimed* database are active.
    if (dbRefs.playersRef) dbRefs.playersRef.off();
    if (dbRefs.chatRef) dbRefs.chatRef.off();
    if (dbRefs.killsRef) dbRefs.killsRef.off();
    if (dbRefs.tracersRef) dbRefs.tracersRef.off();
    if (dbRefs.soundsRef) dbRefs.soundsRef.off();
    if (dbRefs.mapStateRef) dbRefs.mapStateRef.child("bullets").off();
    if (dbRefs.gameConfigRef) dbRefs.gameConfigRef.off(); // If you have gameConfig specific listeners

    // --- Step 5: Re-attach all Firebase listeners to the *newly claimed* dbRefs ---

    // Initial sync of existing players (once)
    dbRefs.playersRef.once("value").then((snapshot) => {
        const currentIds = [];
        snapshot.forEach((snap) => {
            const data = snap.val();
            currentIds.push(data.id);
            if (data.id === localPlayerId) {
                if (window.localPlayer && data.isDead) { // Ensure window.localPlayer is initialized
                    handleLocalDeath(); // Reactivate local death state if already dead in DB
                }
            } else if (!remotePlayers[data.id] && !permanentlyRemoved.has(data.id)) {
                addRemotePlayer(data);
            }
        });

        latestValidIds = currentIds;
        purgeNamelessPlayers(latestValidIds); // Cleanup any stale remote players from previous sessions

        // Add persistent listener for scoreboard updates on any player change
        dbRefs.playersRef.on("value", (fullSnap) => {
            const allIds = [];
            fullSnap.forEach(s => allIds.push(s.key));
            latestValidIds = allIds;
            purgeNamelessPlayers(latestValidIds);
            updateScoreboard(dbRefs.playersRef); // Update UI scoreboard
        });

        // Player child_added listener
        dbRefs.playersRef.on("child_added", (snap) => {
            const data = snap.val();
            const id = data.id;
            console.log("child_added fired for:", id);
            if (id === localPlayerId) return;

            if (permanentlyRemoved.has(id)) {
                permanentlyRemoved.delete(id); // Player re-joined
                console.log(`[permanentlyRemoved] Clearing permanent removal for ${id} — they rejoined`);
            }

            if (remotePlayers[id] || !data.username) return; // Already exists or incomplete data

            addRemotePlayer(data);
        });

        // Player child_changed listener
        dbRefs.playersRef.on("child_changed", (snap) => {
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
                // Assuming window.localPlayer.bodyMesh is set in game.js after player model is created
                if (window.localPlayer.bodyMesh && typeof data.bodyColor === "number" &&
                    window.localPlayer.bodyMesh.material.color.getHex() !== data.bodyColor) {
                    window.localPlayer.bodyMesh.material.color.setHex(data.bodyColor);
                }
            } else {
                updateRemotePlayer(data); // Update remote player's model and data
            }
        });

        // Player child_removed listener
        dbRefs.playersRef.on("child_removed", (snap) => {
            const id = snap.key;
            if (id === localPlayerId) {
                console.warn("Local player removed from Firebase. Handling disconnection.");
                localStorage.removeItem(`playerId-${activeGameSlotName}`); // Clear slot-specific ID
                localPlayerId = null; // Ensure game loop knows to stop
                // The client should ideally be redirected to the main menu here
                location.reload(); // Simple reload for now to go back to initial state
                return;
            }
            permanentlyRemoved.add(id);
            removeRemotePlayerModel(id);
        });

        // Chat listener
        const chatSeenKeys = new Set(); // To prevent duplicate messages on initial load/resync
        dbRefs.chatRef.on("child_added", (snap) => {
            const { username: u, text } = snap.val();
            const key = snap.key;
            if (chatSeenKeys.has(key)) return;
            chatSeenKeys.add(key);
            addChatMessage(u, text, key);
        });

        // Kills listener (limited to last 5 for feed, but scoreboard updates from all)
        dbRefs.killsRef.limitToLast(5).on("child_added", (snap) => {
            const k = snap.val();
            updateKillFeed(k.killer, k.victim, k.weapon, snap.key);
            updateScoreboard(dbRefs.playersRef); // This will cause full scoreboard refresh
        });

        // Kills cleanup interval
        setInterval(() => {
            const cutoff = Date.now() - 60000; // 1 minute cutoff
            dbRefs.killsRef.orderByChild("timestamp").endAt(cutoff).once("value", (snapshot) => {
                snapshot.forEach(child => child.ref.remove());
            });
        }, 60000); // Run every minute

        // Tracers listener
        dbRefs.tracersRef.on("child_added", (snap) => {
            const { x, y, z, tx, ty, tz, shooter } = snap.val();
            const tracerRef = snap.ref;
            // Remove from Firebase after a short delay (e.g., 1 second)
            setTimeout(() => tracerRef.remove().catch(err => console.error("Failed to remove tracer from Firebase:", err)), 1000);
            // Always create tracer locally for all players, regardless of who shot it
            createTracer(new THREE.Vector3(x, y, z), new THREE.Vector3(tx, ty, tz), snap.key);
        });
        dbRefs.tracersRef.on("child_removed", (snap) => {
            removeTracer(snap.key);
        });

        // Bullet holes listener
        if (dbRefs.mapStateRef) {
            dbRefs.mapStateRef.child("bullets").on("child_added", (snap) => {
                const hole = snap.val();
                const holeKey = snap.key;

                addBulletHole(hole, holeKey); // Call UI function to add locally

                // Schedule removal from Firebase after its visual lifecycle (e.g., 5 seconds)
                // Adjust timeout based on how old the bullet hole already is
                setTimeout(() => {
                    snap.ref.remove().catch(err => console.error("Failed to remove scheduled bullet hole from Firebase:", err));
                }, Math.max(0, 5000 - (Date.now() - (hole.timeCreated || 0)))); // Ensure positive timeout
            });

            dbRefs.mapStateRef.child("bullets").on("child_removed", (snap) => {
                removeBulletHole(snap.key); // Call UI function to remove locally
            });
        } else {
            console.warn("mapStateRef is not defined, bullet hole synchronization disabled.");
        }

        resolve(true); // Indicate successful network initialization
    }).catch((error) => {
        console.error("Network init failed during initial player sync:", error);
        reject(error);
    });

    return true; // Indicate initial success, promise handles async listeners
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


// --- Game End Cleanup ---

export async function endGameCleanup() {
    console.log("[network.js] Initiating game end cleanup.");

    // 1. Detach all Firebase listeners from the current game database
    if (dbRefs.playersRef) {
        dbRefs.playersRef.off();
        console.log("Detached playersRef listener.");
    }
    if (dbRefs.chatRef) {
        dbRefs.chatRef.off();
        console.log("Detached chatRef listener.");
    }
    if (dbRefs.killsRef) {
        dbRefs.killsRef.off();
        console.log("Detached killsRef listener.");
    }
    if (dbRefs.tracersRef) {
        dbRefs.tracersRef.off();
        console.log("Detached tracersRef listener.");
    }
    if (dbRefs.soundsRef) {
        dbRefs.soundsRef.off();
        console.log("Detached soundsRef listener.");
    }
    if (dbRefs.mapStateRef) {
        dbRefs.mapStateRef.child("bullets").off();
        console.log("Detached mapStateRef/bullets listener.");
    }
    if (dbRefs.gameConfigRef) {
        dbRefs.gameConfigRef.off(); // Detach game config listeners
        console.log("Detached gameConfigRef listener.");
    }

    // 2. Stop AudioManager sounds
    if (audioManagerInstance) {
        audioManagerInstance.stopAll();
        // You might want to dispose of the audioManagerInstance if it's not reused
        // audioManagerInstance = null;
    }

    // 3. Remove local player's data from Firebase (explicitly, in case onDisconnect hasn't fired yet)
    if (dbRefs.playersRef && localPlayerId) {
        try {
            await dbRefs.playersRef.child(localPlayerId).remove();
            console.log(`Local player ${localPlayerId} explicitly removed from Firebase.`);
            // Also cancel onDisconnect for this player if it was still active
            dbRefs.playersRef.child(localPlayerId).onDisconnect().cancel();
        } catch (error) {
            console.error(`Error removing local player ${localPlayerId} from Firebase during cleanup:`, error);
        }
    }

    // 4. Release the game slot in the menu database
    if (activeGameSlotName) {
        await releaseGameSlot(activeGameSlotName);
        console.log(`Game slot ${activeGameSlotName} released.`);
        activeGameSlotName = null;
    }

    // 5. Clear local player ID and related storage for this game slot
    localStorage.removeItem(`playerId-${localPlayerId}`);
    localPlayerId = null; // Mark local player as no longer active

    // 6. Clear global dbRefs and remote players array
    dbRefs = {};
    for (const id in remotePlayers) {
        removeRemotePlayerModel(id); // Remove Three.js models
    }
    window.remotePlayers = {}; // Clear the global object
    permanentlyRemoved.clear(); // Clear the set of permanently removed players
    latestValidIds = [];

    console.log("[network.js] Game cleanup complete. All listeners detached and data cleared.");
}
