// network.js
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

import {
    releaseGameSlot,
    gamesRef,
    gameDatabaseConfigs
} from "./firebase-config.js";

import {
    addRemotePlayer,
    removeRemotePlayer as removeRemotePlayerModel,
    updateRemotePlayer,
    handleLocalDeath,
    determineWinnerAndEndGame
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
    removeBulletHole,
    // Removed updateGameClockUI as it's no longer needed for a direct display
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

export let activeGameSlotName = null;
export let currentServerTimeOffset = 0; // Offset between client and server time
export let gameEndTime = null; // Store the game end time
export let gameCurrentTime = null; // New: Current time of the game, based on a host pushing to DB

// Store listeners so they can be detached
let playersListener = null;
let chatListener = null;
let killsListener = null;
let mapStateListener = null;
let tracersListener = null;
let soundsListener = null;
let gameConfigListener = null; // Listener for game config changes (e.g., timer, current time)
let gameCurrentTimeInterval = null; // Interval for host to push current time

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

export let activeGameId = null;

export function setActiveGameId(id) {
    activeGameId = id;
}

export async function getFirebaseServerTime() {
    try {
        const connectedRef = firebase.database().ref(".info/serverTimeOffset");
        return new Promise((resolve, reject) => {
            connectedRef.once('value', function(snap) {
                const offset = snap.val() || 0;
                currentServerTimeOffset = offset;
                const serverTime = Date.now() + offset;
                console.log(`[network.js] Server time offset: ${offset}ms, Current server time: ${new Date(serverTime).toLocaleString()}`);
                resolve(serverTime);
            }, error => {
                console.error("Failed to get server time offset:", error);
                reject(error);
            });
        });
    } catch (error) {
        console.error("Error getting Firebase server time:", error);
        return Date.now();
    }
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
            lastUpdate: firebase.database.ServerValue.TIMESTAMP,
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
        dbRefs.chatRef.push({ username, text, timestamp: firebase.database.ServerValue.TIMESTAMP }).catch((err) => console.error("Failed to send chat message:", err));
    } else {
        console.warn("Attempted to send chat message before network initialized.");
    }
}

export function sendBulletHole(pos) {
    if (dbRefs.mapStateRef) {
        dbRefs.mapStateRef.child("bullets").push({
            x: pos.x, y: pos.y, z: pos.z,
            nx: pos.nx, ny: pos.ny, nz: pos.nz,
            timeCreated: firebase.database.ServerValue.TIMESTAMP
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
    if (window.playersKillsListener && window.dbRefs?.playersRef) {
        window.dbRefs.playersRef.off("value", window.playersKillsListener);
        window.playersKillsListener = null;
    }
    // Clear the gameCurrentTime interval if it was running
    if (gameCurrentTimeInterval) {
        clearInterval(gameCurrentTimeInterval);
        gameCurrentTimeInterval = null;
    }

    if (window._animationId != null) {
        cancelAnimationFrame(window._animationId);
        window._animationId = null;
    }

    if (window.audioManager) {
        window.audioManager.stopAll();
    }
    [ window.deathTheme, window.windSound, window.forestNoise ]
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
    // Clear the interval for pushing current time if it's active
    if (gameCurrentTimeInterval) {
        clearInterval(gameCurrentTimeInterval);
        gameCurrentTimeInterval = null;
        console.log("Game current time push interval cleared.");
    }


    if (audioManagerInstance) {
        audioManagerInstance.stopAll();
    }

    if (dbRefs.playersRef && localPlayerId) {
        try {
            await dbRefs.playersRef.child(localPlayerId).onDisconnect().cancel();
            console.log(`onDisconnect cancelled for player '${localPlayerId}'.`);
            await dbRefs.playersRef.child(localPlayerId).remove();
            console.log(`Local player '${localPlayerId}' explicitly removed from Firebase.`);
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


export async function initNetwork(username, mapName, gameId, ffaEnabled) {
    console.log("[network.js] initNetwork for", username, mapName, gameId, ffaEnabled);
    await endGameCleanup();

    // Get server time offset before proceeding
    await getFirebaseServerTime();

    const slotSnap = await gamesRef.child(gameId).child('slot').once('value');
    const slotName = slotSnap.val();
    if (!slotName) {
        Swal.fire('Error','No slot associated with that game ID.','error');
        return false;
    }
    activeGameId = gameId;
    activeGameSlotName = slotName;

    const slotConfig = gameDatabaseConfigs[slotName];
    if (!slotConfig) {
        console.error(`No firebase config found for slot "${slotName}"`);
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
        playersRef:      rootRef.child('players'),
        chatRef:         rootRef.child('chat'),
        killsRef:        rootRef.child('kills'),
        mapStateRef:     rootRef.child('mapState'),
        tracersRef:      rootRef.child('tracers'),
        soundsRef:       rootRef.child('sounds'),
        gameConfigRef:   rootRef.child('gameConfig'),
    };
    setUIDbRefs(dbRefs);
    console.log(`[network.js] Using existing slot "${slotName}" with DB URL ${slotConfig.databaseURL}`);

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
            if (activeGameSlotName) await releaseGameSlot(activeGameSlotName);
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
        lastUpdate: firebase.database.ServerValue.TIMESTAMP,
        isHost: false // New: Flag to identify a host for timekeeping
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
    setupGameConfigListener(dbRefs.gameConfigRef); // Set up listener for game config, including gameCurrentTime

    if (window.camera && window.scene) {
        initializeAudioManager(window.camera, window.scene);
    } else {
        console.warn("[network.js] window.camera or window.scene not available. Audio Manager may not initialize correctly.");
    }

    console.log("[network.js] Network initialization complete.");
    return true;
}

// New listener for game configuration, including gameEndTime and gameCurrentTime
function setupGameConfigListener(gameConfigRef) {
    if (gameConfigListener) gameConfigRef.off("value", gameConfigListener);

    gameConfigListener = gameConfigRef.on("value", snapshot => {
        const config = snapshot.val() || {};
        const newGameEndTime = config.gameEndTime;
        const newGameCurrentTime = config.gameCurrentTime;

        if (newGameEndTime && newGameEndTime !== gameEndTime) {
            gameEndTime = newGameEndTime;
            console.log(`[GameConfigListener] Updated gameEndTime to: ${new Date(gameEndTime).toLocaleString()}`);
        } else if (newGameEndTime === null && gameEndTime !== null) {
            // Game end time was removed, implying game has ended or reset
            console.log("[GameConfigListener] gameEndTime removed from Firebase. Game likely ended.");
            if (activeGameId) {
                console.log("[GameConfigListener] Initiating fullCleanup due to gameEndTime removal.");
                fullCleanup(activeGameId); // Trigger cleanup and reload
            }
        }

        // Update local gameCurrentTime when it changes in Firebase
        if (typeof newGameCurrentTime === 'number') {
            gameCurrentTime = newGameCurrentTime;
        } else if (newGameCurrentTime === null && gameCurrentTime !== null) {
            // If gameCurrentTime is removed, reset it locally
            gameCurrentTime = null;
        }
    });
}

// Function for a designated host to update gameCurrentTime in Firebase
export function startHostTimeSync(gameConfigRef) {
    if (gameCurrentTimeInterval) {
        clearInterval(gameCurrentTimeInterval);
    }
    console.log("[network.js] Starting host time sync interval.");
    gameCurrentTimeInterval = setInterval(() => {
        // Only update if player is still considered active/host
        if (localPlayerId && dbRefs.playersRef) {
            gameConfigRef.child("gameCurrentTime").set(firebase.database.ServerValue.TIMESTAMP)
                .catch(err => console.error("Failed to update gameCurrentTime:", err));
        } else {
            console.warn("[network.js] Local player ID or playersRef missing, stopping host time sync.");
            clearInterval(gameCurrentTimeInterval);
            gameCurrentTimeInterval = null;
        }
    }, 1000); // Update every second
}
