// network.js
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

import {
    claimGameSlot,
    releaseGameSlot,
    gamesRef, // Keep this import, it's the main lobby ref
    gameDatabaseConfigs
} from "./firebase-config.js";

import {
    addRemotePlayer,
    removeRemotePlayer as removeRemotePlayerModel,
    updateRemotePlayer,
    handleLocalDeath
} from "./game.js";

import {
    addChatMessage,
    updateKillFeed,
    updateScoreboard,
    createTracer,
    removeTracer,
    updateHealthShieldUI,
    setUIDbRefs,
    addBulletHole,
    removeBulletHole
} from "./ui.js";

import { WeaponController } from "./weapons.js";
import { AudioManager } from "./AudioManager.js";
import { SOUND_CONFIG } from './soundConfig.js';

const PHYSICS_SOUNDS = {
    footstep: { run: 'https://codehs.com/uploads/616ef1b61061008f9993d1ab4fa323ba' },
    landingThud: { land: 'https://codehs.com/uploads/600ab769d99d74647db55a468b19761f' }
};

export let localPlayerId = null;
export const remotePlayers = {};
const permanentlyRemoved = new Set();
let latestValidIds = [];

let audioManagerInstance = null;
export let dbRefs = {};
export let activeGameId = null; // Storing the active gameId for fullCleanup
let activeGameSlotName = null;

let playersListener = null;
let chatListener = null;
let killsListener = null;
let mapStateListener = null;
let tracersListener = null;
let soundsListener = null;
let gameConfigListener = null; // Used for the timer, etc.

let staleGameCleanupInterval = null;

export function setActiveGameId(id) {
    activeGameId = id;
}

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
    window.audioManager = audioManagerInstance;
    console.log("AudioManager successfully initialized with camera:", camera.uuid, "at initial position:", camera.position.toArray());
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
                // Own sounds can be removed quicker
                setTimeout(() => {
                    soundRef.remove().catch(err => console.error("Failed to remove own sound event from Firebase:", err));
                }, 1000); // Remove own sound events faster (e.g., 1 second)
            }
            return;
        }

        // Remove other player's sound events after a reasonable time
        setTimeout(() => {
            soundRef.remove().catch(err => console.error("Failed to remove sound event from Firebase after 3s:", err));
        }, 3000);

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
                    worldPos,
                    {
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

let lastSync = 0;
export function sendPlayerUpdate(data) {
    const now = Date.now();
    if (now - lastSync < 50) return;
    lastSync = now;
    if (dbRefs.playersRef && localPlayerId) {
        dbRefs.playersRef.child(localPlayerId).update({
            x: data.x,
            y: data.y,
            z: data.z,
            rotY: data.rotY,
            weapon: data.weapon,
            lastUpdate: now,
            knifeSwing: data.knifeSwing,
            knifeHeavy: data.knifeHeavy
        }).catch(err => console.error("Failed to send player update:", err));
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
    if (!dbRefs.playersRef) {
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
            ks = 0;
            health = 0;
            shield = 0;
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
                handleLocalDeath(killerInfo.killerUsername);
            }
        }
    });
}

export function sendTracer(tracerData) {
    if (dbRefs.tracersRef) {
        dbRefs.tracersRef.push({
            ...tracerData,
            shooter: localPlayerId,
            time: firebase.database.ServerValue.TIMESTAMP
        }).catch((err) => console.error("Failed to send tracer:", err));
    }
}

export function sendChatMessage(username, text) {
    if (dbRefs.chatRef) {
        dbRefs.chatRef.push({ username, text, timestamp: Date.now() }).catch((err) => console.error("Failed to send chat message:", err));
    } else {
        console.warn("Attempted to send chat message before network initialized.");
    }
}

export function sendBulletHole(pos) {
    if (dbRefs.mapStateRef) {
        dbRefs.mapStateRef.child("bullets").push({
            x: pos.x, y: pos.y, z: pos.z,
            nx: pos.nx, ny: pos.ny, nz: pos.nz,
            timeCreated: Date.now()
        }).catch(err => console.error("Failed to send bullet hole:", err));
    }
}

export function sendSoundEvent(soundKey, soundType, position) {
    if (dbRefs.soundsRef) {
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

    await endGameCleanup();

    if (window.gameInterval) {
        clearInterval(window.gameInterval);
        window.gameInterval = null;
    }
    // Note: playersKillsListener is handled in determineWinnerAndEndGame/startGame,
    // so it might not be a global `window.playersKillsListener` anymore.
    // Ensure all listeners are correctly detached by endGameCleanup.

    if (window._animationId != null) {
        cancelAnimationFrame(window._animationId);
        window._animationId = null;
    }

    if (window.audioManager) {
        window.audioManager.stopAll();
    }
    [window.deathTheme, window.windSound, window.forestNoise]
        .forEach(sound => { if (sound && sound.pause) sound.pause(); });

    console.log("[network.js] Game disposed.");
}

export function purgeNamelessPlayers(validIds = []) {
    Object.keys(remotePlayers).forEach(id => {
        const rp = remotePlayers[id];
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
                // No need for location.reload() here, let the fullCleanup or game end handle it.
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
window.disconnectPlayer = disconnectPlayer;

export async function endGameCleanup() {
    console.log("[network.js] Running endGameCleanup...");

    // Detach all Firebase listeners from the current game database
    if (playersListener && dbRefs.playersRef) {
        dbRefs.playersRef.off("value", playersListener);
        playersListener = null;
        console.log("Players 'value' listener detached.");
    }
    // Also detach specific child listeners for playersRef
    if (dbRefs.playersRef) {
        dbRefs.playersRef.off("child_added");
        dbRefs.playersRef.off("child_changed");
        dbRefs.playersRef.off("child_removed");
        console.log("Players 'child_...' listeners detached.");
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
        // mapStateListener is typically for child_added on "bullets"
        dbRefs.mapStateRef.child("bullets").off("child_added", mapStateListener);
        dbRefs.mapStateRef.child("bullets").off("child_removed");
        mapStateListener = null;
        console.log("MapState/bullets listener detached.");
    }
    if (tracersListener && dbRefs.tracersRef) {
        dbRefs.tracersRef.off("child_added", tracersListener);
        dbRefs.tracersRef.off("child_removed"); // Ensure child_removed is also cleared
        tracersListener = null;
        console.log("Tracers listener detached.");
    }
    if (soundsListener && dbRefs.soundsRef) {
        dbRefs.soundsRef.off("child_added", soundsListener);
        soundsListener = null;
        console.log("Sounds listener detached.");
    }
    if (gameConfigListener && dbRefs.gameConfigRef) { // Ensure this is detached
        dbRefs.gameConfigRef.off("value", gameConfigListener);
        gameConfigListener = null;
        console.log("GameConfig listener detached.");
    }

    // Stop and clear any cleanup intervals from listeners
    if (window.killsCleanupInterval) {
        clearInterval(window.killsCleanupInterval);
        window.killsCleanupInterval = null;
        console.log("Kills cleanup interval cleared.");
    }
    if (window.bulletHoleCleanupInterval) { // Assuming you might add one for bullet holes
        clearInterval(window.bulletHoleCleanupInterval);
        window.bulletHoleCleanupInterval = null;
        console.log("Bullet hole cleanup interval cleared.");
    }


    if (audioManagerInstance) {
        audioManagerInstance.stopAll();
    }

    // Attempt to remove local player from the *slot-specific* players node
    if (dbRefs.playersRef && localPlayerId) {
        try {
            await dbRefs.playersRef.child(localPlayerId).remove();
            console.log(`Local player '${localPlayerId}' explicitly removed from Firebase.`);
            // Important: cancel onDisconnect here if it was set on this player's actual data
            dbRefs.playersRef.child(localPlayerId).onDisconnect().cancel();
        } catch (error) {
            console.error(`Error removing local player '${localPlayerId}' from Firebase during cleanup:`, error);
        }
    }

    // Release the game slot and remove the lobby entry (this is crucial for the /game entry)
    // This part ensures `releaseGameSlot` is called.
    if (activeGameSlotName) {
        // releaseGameSlot already removes the lobby entry and frees the slot
        await releaseGameSlot(activeGameSlotName);
        console.log(`Game slot '${activeGameSlotName}' released AND lobby entry removed (if applicable).`);
        localStorage.removeItem(`playerId-${activeGameSlotName}`);
        activeGameSlotName = null;
    }


    localPlayerId = null; // Clear local player ID
    dbRefs = {}; // Clear database references
    // Clear local remote player objects
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
 * @param {string} gameId - The ID of the game from the main lobby.
 * @param {boolean} ffaEnabled - True if FFA mode is enabled, false otherwise.
 * @returns {Promise<boolean>} True if network initialization was successful, false otherwise.
 */
export async function initNetwork(username, mapName, gameId, ffaEnabled) {
    console.log("[network.js] initNetwork for", username, mapName, gameId, ffaEnabled);
    await endGameCleanup(); // Ensure previous game state is fully cleaned up

    // 1) look up slotName from the game entry
    const slotSnap = await gamesRef.child(gameId).child('slot').once('value');
    const slotName = slotSnap.val();
    if (!slotName) {
        Swal.fire('Error', 'No slot associated with that game ID.', 'error');
        return false;
    }
    setActiveGameId(gameId); // Set the active game ID here
    activeGameSlotName = slotName; // Store the slot name for cleanup

    // Pick the right config object from your firebase-config.js
    const slotConfig = gameDatabaseConfigs[slotName];
    if (!slotConfig) {
        console.error(`No firebase config found for slot "${slotName}"`);
        // If config not found, consider if gameId should be removed from gamesRef
        await gamesRef.child(gameId).remove().catch(err => console.error("Failed to remove game entry due to missing slot config:", err));
        return false;
    }

    let slotApp;
    try {
        slotApp = firebase.app(slotName + 'App');
    } catch (e) {
        slotApp = firebase.initializeApp(slotConfig, slotName + 'App');
    }

    const rootRef = slotApp.database().ref();
    dbRefs = {
        playersRef: rootRef.child('players'),
        chatRef: rootRef.child('chat'),
        killsRef: rootRef.child('kills'),
        mapStateRef: rootRef.child('mapState'),
        tracersRef: rootRef.child('tracers'),
        soundsRef: rootRef.child('sounds'),
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

    if (dbRefs.playersRef && dbRefs.playersRef.database && dbRefs.playersRef.database.app_ && dbRefs.playersRef.database.app_.options) {
        console.log(`[network.js] Game is connected to Firebase database: ${dbRefs.playersRef.database.app_.options.databaseURL}`);
    } else {
        console.warn("[network.js] Could not determine database URL from dbRefs.playersRef.database.app_.options. This might be expected if dbRefs are not fully initialized yet or structure is different.");
    }
    console.log("[network.js] dbRefs after claiming slot (from network.js):", dbRefs);

    let storedPlayerId = localStorage.getItem(`playerId-${activeGameSlotName}`);
    if (storedPlayerId) {
        localPlayerId = storedPlayerId;
        console.log(`[network.js] Re-using localPlayerId for slot '${activeGameSlotName}':`, localPlayerId);
    } else {
        if (!dbRefs.playersRef) {
            console.error("[network.js] dbRefs.playersRef is not defined. Cannot generate localPlayerId.");
            // If we couldn't even get playersRef, the slot might not be properly set up
            if (activeGameSlotName) await releaseGameSlot(activeGameSlotName); // Attempt to release
            return false;
        }
        localPlayerId = dbRefs.playersRef.push().key;
        localStorage.setItem(`playerId-${activeGameSlotName}`, localPlayerId);
        console.log(`[network.js] Generated new localPlayerId for slot '${activeGameSlotName}':`, localPlayerId);
    }
    window.localPlayerId = localPlayerId;

    dbRefs.playersRef.child(localPlayerId).onDisconnect().remove()
        .then(() => console.log(`[network.js] onDisconnect set for player '${localPlayerId}' in game DB.`))
        .catch(err => console.error(`[network.js] Error setting onDisconnect for player '${localPlayerId}':`, err));

    const initialPlayerState = {
        id: localPlayerId,
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
        await dbRefs.playersRef.child(localPlayerId).set(initialPlayerState);
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
    // The gameConfig listener is typically set up in game.js for timer management

    console.log("[network.js] Network initialization complete.");
    return true;
}

// Function to set up gameConfig listener, to be called from game.js
export function setupGameConfigListener(gameConfigRef, gameTimerElement, ownerRef, gameDurationRef, gameEndedRef, determineWinnerAndEndGame, localPlayerId) {
    if (gameConfigListener) gameConfigRef.off("value", gameConfigListener); // Detach previous

    // This listener captures all changes to gameConfig for timer updates and game end
    gameConfigListener = gameConfigRef.on('value', snap => {
        const config = snap.val() || {};
        const ownerId = config.owner;
        const currentRemainingSeconds = typeof config.gameDuration === 'number' ? config.gameDuration : null;
        const gameEnded = config.ended === true;

        // Logic for owner election if no owner is present
        if (ownerId === null && localPlayerId) {
            ownerRef.transaction(curr => curr === null ? localPlayerId : undefined)
                .then(({ committed, snapshot }) => {
                    if (committed) console.log(`[network.js] Successfully became owner: ${snapshot.val()}`);
                    else if (snapshot.val() !== localPlayerId) console.log(`[network.js] Another player ${snapshot.val()} is already the owner.`);
                })
                .catch(error => console.error("[network.js] Owner election transaction failed:", error));
        }

        // Timer update logic for all clients (UI)
        if (currentRemainingSeconds === null) {
            gameTimerElement.textContent = 'Time: Syncing…';
        } else {
            const mins = Math.floor(currentRemainingSeconds / 60);
            const secs = currentRemainingSeconds % 60;
            gameTimerElement.textContent = `Time: ${mins}:${secs < 10 ? '0' : ''}${secs}`;
        }

        // Game ending logic
        if (gameEnded && !window.gameIsEnding) { // Use a flag to prevent multiple calls
            window.gameIsEnding = true;
            console.log("[network.js] Game ended flag detected. Initiating game end process.");
            // Detach listeners related to game state (handled in disposeGame/endGameCleanup)
            // Call the game's determineWinnerAndEndGame (pass gameId from activeGameId)
            determineWinnerAndEndGame(activeGameId);
        }
    });

    // Set onDisconnect for the owner node *from this client's perspective*
    // This will ensure that if *this* client is the owner, and it disconnects,
    // the 'owner' node is cleared, allowing another client to take over.
    ownerRef.onDisconnect().remove()
        .then(() => console.log(`[network.js] onDisconnect set for owner ref for local player ${localPlayerId}`))
        .catch(err => console.error("[network.js] Failed to set onDisconnect for owner ref:", err));

    // Owner's responsibility to decrement timer
    // This interval only runs if the localPlayerId is the current owner
    let ownerInterval = null;
    gameConfigRef.child('owner').on('value', ownerSnap => {
        const currentOwnerId = ownerSnap.val();
        if (currentOwnerId === localPlayerId) {
            if (ownerInterval === null) {
                console.log(`[network.js] I am the owner (${localPlayerId}). Starting owner interval.`);
                ownerInterval = setInterval(() => {
                    gameConfigRef.child('gameDuration').transaction(currentDuration => {
                        if (typeof currentDuration !== 'number' || currentDuration <= 0) {
                            if (currentDuration <= 0) {
                                gameConfigRef.child('ended').set(true); // Signal game end
                            }
                            return undefined; // Abort transaction if invalid or 0/less
                        }
                        return currentDuration - 1;
                    }).then(({ committed }) => {
                        if (!committed) {
                            // If transaction failed (e.g., another owner updated it, or already ended)
                            // or if duration became 0, stop interval
                            if (ownerInterval) {
                                clearInterval(ownerInterval);
                                ownerInterval = null;
                                console.log("[network.js] Owner interval cleared due to transaction result or game ending.");
                            }
                        }
                    }).catch(err => console.error("[network.js] Owner interval transaction failed:", err));
                }, 1000);
            }
        } else if (ownerInterval !== null) {
            // No longer the owner, or owner changed
            clearInterval(ownerInterval);
            ownerInterval = null;
            console.log("[network.js] No longer owner. Clearing owner interval.");
        }
    });

    // Initialize game duration if it's null and we become owner
    gameDurationRef.on('value', snap => {
        const val = snap.val();
        if (val === null && gameConfigRef.child('owner').val() === localPlayerId) {
            console.log("[network.js] Game duration is null. Initializing with INITIAL_DURATION.");
            gameDurationRef.set(10 * 60); // Set initial duration (e.g., 10 minutes)
        }
    });
}


function setupPlayersListener(playersRef) {
    playersRef.off("value");
    playersRef.off("child_added");
    playersRef.off("child_changed");
    playersRef.off("child_removed");

    playersListener = playersRef.on("value", (fullSnap) => {
        const allIds = [];
        fullSnap.forEach(s => allIds.push(s.key));
        latestValidIds = allIds;
        purgeNamelessPlayers(latestValidIds);
        updateScoreboard(playersRef);
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
            permanentlyRemoved.delete(id);
            console.log(`[permanentlyRemoved] Player ${id} re-joined, clearing from permanent removal list.`);
        }

        if (remotePlayers[id]) {
            console.warn(`[playersRef:child_added] Player ${id} already exists in remotePlayers. Skipping model creation.`);
            return;
        }

        if (!data.username) {
            console.warn(`[playersRef:child_added] Player ${id} has incomplete data (missing username). Skipping model creation.`);
            return;
        }

        addRemotePlayer(data);
    });

    playersRef.on("child_changed", (snap) => {
        const data = snap.val();
        const id = data.id;

        if (permanentlyRemoved.has(id)) {
            removeRemotePlayerModel(id);
            return;
        }

        if (id === localPlayerId && window.localPlayer) {
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

            if (window.localPlayer.bodyMesh && typeof data.bodyColor === "number" &&
                window.localPlayer.bodyMesh.material.color.getHex() !== data.bodyColor) {
                window.localPlayer.bodyMesh.material.color.setHex(data.bodyColor);
            }
        } else {
            updateRemotePlayer(data);
        }
    });

    playersRef.on("child_removed", (snap) => {
        const id = snap.key;
        if (id === localPlayerId) {
            console.warn("Local player removed from Firebase. Handling disconnection.");
            localStorage.removeItem(`playerId-${activeGameSlotName}`);
            localPlayerId = null;
            // The expectation is that `fullCleanup` (called by `determineWinnerAndEndGame`)
            // or `endGameCleanup` has already been or will be triggered to handle the game's removal.
            // Avoid `location.reload()` here to prevent premature reloads if `fullCleanup` is still running.
            // A dedicated "return to lobby" flow should be triggered by the UI, perhaps after `fullCleanup`.
            return;
        }
        permanentlyRemoved.add(id);
        removeRemotePlayerModel(id);
    });
}

function setupChatListener(chatRef) {
    if (chatListener) chatRef.off("child_added", chatListener);
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
    if (killsListener) killsRef.off("child_added", killsListener);
    killsListener = killsRef.limitToLast(5).on("child_added", (snap) => {
        const k = snap.val();
        updateKillFeed(k.killer, k.victim, k.weapon, snap.key);
        updateScoreboard(dbRefs.playersRef);
    });

    if (window.killsCleanupInterval) {
        clearInterval(window.killsCleanupInterval);
    }
    window.killsCleanupInterval = setInterval(() => {
        const cutoff = Date.now() - 60000;
        killsRef.orderByChild("timestamp").endAt(cutoff).once("value", (snapshot) => {
            snapshot.forEach(child => child.ref.remove());
        });
    }, 60000);
}

function setupMapStateListener(mapStateRef) {
    if (!mapStateRef) {
        console.warn("mapStateRef is not defined, bullet hole synchronization disabled.");
        return;
    }
    if (mapStateListener) {
        mapStateRef.child("bullets").off("child_added", mapStateListener);
        mapStateRef.child("bullets").off("child_removed");
    }

    mapStateListener = mapStateRef.child("bullets").on("child_added", (snap) => {
        const hole = snap.val();
        const holeKey = snap.key;

        addBulletHole(hole, holeKey);

        setTimeout(() => {
            snap.ref.remove().catch(err => console.error("Failed to remove scheduled bullet hole from Firebase:", err));
        }, Math.max(0, 5000 - (Date.now() - (hole.timeCreated || 0))));
    });

    mapStateRef.child("bullets").on("child_removed", (snap) => {
        removeBulletHole(snap.key);
    });
}

function setupTracerListener(tracersRef) {
    if (tracersListener) tracersRef.off("child_added", tracersListener);
    tracersListener = tracersRef.on("child_added", (snap) => {
        const { ox, oy, oz, tx, ty, tz, shooter } = snap.val();
        const tracerRef = snap.ref;
        setTimeout(() => tracerRef.remove().catch(err => console.error("Failed to remove tracer from Firebase:", err)), 1000);
        createTracer(new THREE.Vector3(ox, oy, oz), new THREE.Vector3(tx, ty, tz), snap.key);
    });

    tracersRef.off("child_removed");
    tracersRef.on("child_removed", (snap) => {
        removeTracer(snap.key);
    });
}

document.addEventListener("visibilitychange", () => {
    if (!document.hidden && dbRefs && dbRefs.playersRef) {
        console.log("Tab is visible. Resyncing player data.");
        dbRefs.playersRef.once("value").then(snapshot => {
            const activeFirebasePlayers = new Set();
            snapshot.forEach(snap => {
                const data = snap.val();
                activeFirebasePlayers.add(data.id);
                if (data.id === localPlayerId) return;

                if (remotePlayers[data.id]) {
                    updateRemotePlayer(data);
                } else if (!permanentlyRemoved.has(data.id)) {
                    addRemotePlayer(data);
                }
            });

            Object.keys(remotePlayers).forEach(id => {
                if (!activeFirebasePlayers.has(id)) {
                    console.log(`Resync: Player ${id} not found in Firebase. Removing model.`);
                    removeRemotePlayerModel(id);
                    permanentlyRemoved.add(id);
                }
            });
        }).catch(err => console.error("Error during visibility change resync:", err));
    }
});

export function startStaleGameCleanupMonitor() {
    // Clear any existing monitor to prevent duplicates
    if (staleGameCleanupInterval) {
        clearInterval(staleGameCleanupInterval);
        console.log("[network.js] Cleared existing stale game cleanup monitor.");
    }

    // Run this check periodically (e.g., every 5 minutes)
    const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    const MAX_INACTIVITY_MS = 10 * 60 * 1000; // Consider a game stale if no player updates for 10 minutes

    staleGameCleanupInterval = setInterval(async () => {
        console.log("[network.js] Running stale game cleanup monitor...");
        try {
            const gamesSnapshot = await gamesRef.once('value'); // Get all games in the lobby
            if (!gamesSnapshot.exists()) {
                console.log("[network.js] No active games in lobby to monitor for cleanup.");
                return;
            }

            const gamesToDelete = [];

            gamesSnapshot.forEach(gameSnap => {
                const gameId = gameSnap.key;
                const gameData = gameSnap.val();
                const slotName = gameData.slot;

                if (!slotName) {
                    // If a game entry doesn't even have a slot, it's malformed, delete it.
                    console.warn(`[Stale Cleanup] Game ${gameId} has no slot name. Marking for deletion.`);
                    gamesToDelete.push({ gameId, reason: "No slot name" });
                    return;
                }

                const slotConfig = gameDatabaseConfigs[slotName];
                if (!slotConfig) {
                    console.warn(`[Stale Cleanup] Game ${gameId} uses slot ${slotName} but no config found. Marking for deletion.`);
                    gamesToDelete.push({ gameId, reason: "Missing slot config" });
                    return;
                }

                // Initialize (or re-use) a Firebase app for the slot's database
                let slotApp;
                try {
                    slotApp = firebase.app(slotName + 'App');
                } catch (e) {
                    slotApp = firebase.initializeApp(slotConfig, slotName + 'App');
                }
                const slotDbRootRef = slotApp.database().ref();
                const playersRef = slotDbRootRef.child('players');
                const gameConfigRef = slotDbRootRef.child('gameConfig');


                // Scenario 1: Game ended flag is true
                gameConfigRef.child('ended').once('value').then(endedSnap => {
                    if (endedSnap.val() === true) {
                        console.log(`[Stale Cleanup] Game ${gameId} in slot ${slotName} is marked as ended. Marking for deletion.`);
                        gamesToDelete.push({ gameId, slotName, reason: "Game ended flag true" });
                        return; // Done with this game, move to next
                    }

                    // Scenario 2: No active players for a long time
                    playersRef.once('value').then(playersSnap => {
                        if (!playersSnap.exists() || playersSnap.numChildren() === 0) {
                            console.log(`[Stale Cleanup] Game ${gameId} in slot ${slotName} has no players. Marking for deletion.`);
                            gamesToDelete.push({ gameId, slotName, reason: "No players" });
                            return;
                        }

                        // Check last update time for all players
                        let latestPlayerUpdate = 0;
                        playersSnap.forEach(playerChildSnap => {
                            const playerData = playerChildSnap.val();
                            if (playerData && playerData.lastUpdate && playerData.lastUpdate > latestPlayerUpdate) {
                                latestPlayerUpdate = playerData.lastUpdate;
                            }
                        });

                        if (Date.now() - latestPlayerUpdate > MAX_INACTIVITY_MS) {
                            console.log(`[Stale Cleanup] Game ${gameId} in slot ${slotName} has been inactive for too long. Marking for deletion.`);
                            gamesToDelete.push({ gameId, slotName, reason: "Inactive players" });
                        }
                    }).catch(err => console.error(`[Stale Cleanup] Error checking players for game ${gameId}:`, err));

                }).catch(err => console.error(`[Stale Cleanup] Error checking game config for game ${gameId}:`, err));
            });

            // After iterating through all games, perform deletions
            for (const { gameId, slotName, reason } of gamesToDelete) {
                console.log(`[Stale Cleanup] Attempting to clean up game ${gameId} (Slot: ${slotName || 'N/A'}, Reason: ${reason})`);
                try {
                    // 1. Remove game entry from the main lobby
                    await gamesRef.child(gameId).remove();
                    console.log(`[Stale Cleanup] Removed lobby entry for game ${gameId}.`);

                    // 2. Clear all data in the associated slot database
                    if (slotName) {
                        const slotConfig = gameDatabaseConfigs[slotName];
                        if (slotConfig) {
                            let slotApp;
                            try {
                                slotApp = firebase.app(slotName + 'App');
                            } catch (e) {
                                slotApp = firebase.initializeApp(slotConfig, slotName + 'App');
                            }
                            const slotDbRootRef = slotApp.database().ref();
                            await slotDbRootRef.remove(); // Remove ALL data for this slot
                            console.log(`[Stale Cleanup] Cleared all data from slot database ${slotName}.`);
                        }
                    }
                    // 3. Release the game slot (this might be redundant if slotDbRootRef.remove() cleans up the slot's state in slotsRef, but good to be explicit)
                    await releaseGameSlot(slotName);
                    console.log(`[Stale Cleanup] Released game slot ${slotName}.`);

                } catch (cleanupErr) {
                    console.error(`[Stale Cleanup] Failed to fully clean up game ${gameId}:`, cleanupErr);
                }
            }

        } catch (err) {
            console.error("[network.js] Error in stale game cleanup monitor:", err);
        }
    }, CHECK_INTERVAL_MS);
    console.log("[network.js] Stale game cleanup monitor started.");
}

// You need to call this function once when your application initializes,
// for example, in your main index.js or app.js after Firebase is set up.
// Example:
// import { startStaleGameCleanupMonitor } from './network.js';
// firebase.initializeApp(firebaseConfig); // Your main app config
// startStaleGameCleanupMonitor();


// ... (rest of your existing network.js code) ...
