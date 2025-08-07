// network.js
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import {
    claimGameSlot,
    releaseGameSlot,
    gamesRef,
    gameDatabaseConfigs
} from "./firebase-config.js";

import { isMessageClean } from './chatFilter.js';

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

let firebaseUser = null;
export function setFirebaseUser(user) {
    firebaseUser = user;
}


export let localPlayerId = null;
export const remotePlayers = {};
const permanentlyRemoved = new Set();
let latestValidIds = [];

let audioManagerInstance = null;
export let dbRefs = {};
let activeGameSlotName = null;

let playersListener = null;
let chatListener = null;
let killsListener = null;
let mapStateListener = null;
let tracersListener = null;
let soundsListener = null;
let gameConfigListener = null;


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
    } else {}
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

export function sendTracer(tracerData) {
    if (dbRefs.tracersRef) {
        dbRefs.tracersRef.push({
            ...tracerData,
            shooter: localPlayerId,
            time: firebase.database.ServerValue.TIMESTAMP
        }).catch((err) => console.error("Failed to send tracer:", err));
    } else {}
}

export function sendChatMessage(username, text) {
    if (!isMessageClean(text)) {
        console.warn("Message blocked due to profanity/slurs");
        return;
    }

    if (dbRefs.chatRef) {
        dbRefs.chatRef.push({ username, text, timestamp: Date.now() })
            .catch((err) => console.error("Failed to send chat message:", err));
    } else {
        console.warn("Attempted to send chat message before network initialized.");
    }
}
export function sendBulletHole(pos) {
    if (dbRefs.mapStateRef) {
        dbRefs.mapStateRef.child("bullets").push({
            x: pos.x,
            y: pos.y,
            z: pos.z,
            nx: pos.nx,
            ny: pos.ny,
            nz: pos.nz,
            timeCreated: Date.now()
        }).catch(err => console.error("Failed to send bullet hole:", err));
    } else {}
}

export function sendSoundEvent(soundKey, soundType, position) {
    if (dbRefs.soundsRef) {
        const soundProps = SOUND_CONFIG[soundKey]?.[soundType];
        if (!soundProps) {
            console.warn(`Sound properties for ${soundKey}:${soundType} not found in SOUND_CONFIG. Event will be sent with minimal data.`);
            dbRefs.soundsRef.push({
                soundKey,
                soundType,
                x: position.x,
                y: position.y,
                z: position.z,
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

    if (audioManagerInstance) {
        audioManagerInstance.stopAll();
        console.log("Audio manager stopped all sounds.");
    }

    if (dbRefs.playersRef && localPlayerId) {
        try {
            await dbRefs.playersRef.child(localPlayerId).remove();
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



export async function initNetwork(username, mapName, gameId, ffaEnabled) {
  console.log("[network.js] initNetwork for", username, mapName, gameId, ffaEnabled);
  await endGameCleanup();

  if (!firebaseUser || !firebaseUser.uid) {
      console.error("[network.js] Authentication Error: Firebase user not found. Cannot join game.");
      Swal.fire('Error', 'You are not authenticated. Please log in again.', 'error');
      return false;
  }

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
  
  localPlayerId = firebaseUser.uid; 
  console.log(`[network.js] Using authenticated UID as localPlayerId: ${localPlayerId}`);


  const rootRef = slotApp.database().ref("game");
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
  
  const currentPlayersSnap = await dbRefs.playersRef.once('value');
  if (currentPlayersSnap.numChildren() >= 10) {
    Swal.fire({
      icon: 'warning',
      title: 'Game Full',
      text: 'Sorry, this game slot already has 10 players.'
    });
    return false;
  }
  
  console.log(`[network.js] Game is connected to Firebase database: ${slotConfig.databaseURL}`);
  console.log("[network.js] dbRefs after claiming slot:", dbRefs);
  
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

  console.log("[network.js] Network initialization complete.");
  return true;
}


export async function fullCleanup(gameId) {
    console.log("[fullCleanup] START, gameId =", gameId);

    const initialSlotName = activeGameSlotName;
    const initialLocalPlayerId = localPlayerId;

    try {
        await endGameCleanup();
        console.log("[fullCleanup] ✓ endGameCleanup complete");
        if (gameId) {
            await gamesRef.child(gameId).remove();
            console.log(`[fullCleanup] ✓ removed lobby entry gamesRef/${gameId}`);
        } else {
            console.warn("[fullCleanup] no gameId provided, skipping lobby removal from main gamesRef");
        }

        if (window.scene) {
            if (typeof disposeThreeScene === 'function') {
                disposeThreeScene(window.scene);
            } else {
                console.warn("[fullCleanup] disposeThreeScene function not found. Skipping scene disposal.");
                window.scene.clear();
                window.scene = null;
            }
            console.log("[fullCleanup] ✓ Three.js scene disposed");
        }
        if (window.camera) {
            window.camera = null;
            console.log("[fullCleanup] ✓ camera reference cleared");
        }

        activeGameSlotName = null;
        localPlayerId = null;

        console.log("[fullCleanup] END");
        location.reload();
        return true;

    } catch (err) {
        console.error("[fullCleanup] ERROR during cleanup:", err);
        throw err;
    }
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
    if (killsListener) {
        killsRef.off("child_added", killsListener);
    }

    killsListener = killsRef
        .limitToLast(5)
        .on("child_added", (snap) => {
            const k = snap.val() || {};

            updateKillFeed(
                k.killer,
                k.victim,
                k.weapon,
                snap.key,
                Boolean(k.isHeadshot),
                Boolean(k.isPenetrationShot),
            );

            updateScoreboard(dbRefs.playersRef);
        });

    killsRef.on("child_removed", (snap) => {
        const feed = document.getElementById("kill-feed");
        const entry = feed?.querySelector(`[data-kill-id="${snap.key}"]`);
        if (entry) entry.remove();
    });

    if (window.killsCleanupInterval) {
        clearInterval(window.killsCleanupInterval);
    }
    window.killsCleanupInterval = setInterval(() => {
        const cutoff = Date.now() - 60_000;
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
