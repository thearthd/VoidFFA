import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import {
  addRemotePlayer,
  removeRemotePlayer as removeRemotePlayerModel,
  updateRemotePlayer,
  handleLocalDeath // Assuming this handles respawn too
} from "./game.js";
import { pruneChat, pruneKills } from "./game.js"; // pruneChat and pruneKills are not used in this snippet
import { Player } from "./player.js"; // Player class is not used in this snippet
import { getDbRefs } from "./firebase-config.js";
import { SOUND_CONFIG } from './soundConfig.js'; // Make sure the path is correct
import {
  addChatMessage,
  updateKillFeed,
  updateScoreboard,
  createTracer,
  removeTracer,
  updateHealthShieldUI,
  setUIDbRefs,
  addBulletHole, // <--- Imported addBulletHole
  removeBulletHole // <--- Imported removeBulletHole
  // setGameScene is REMOVED
} from "./ui.js";
import { WeaponController } from "./weapons.js";
import { AudioManager } from "./AudioManager.js";

const PHYSICS_SOUNDS = {
  footstep: { run: 'https://codehs.com/uploads/616ef1b61061008f9993d1ab4fa323ba' },
  landingThud: { land: 'https://codehs.com/uploads/600ab769d99d74647db55a468b19761f' }
};

export let localPlayerId = null;
export const remotePlayers = {};
const permanentlyRemoved = new Set();
let latestValidIds = [];

let audioManagerInstance = null;
export let dbRefs;

/**
 * Initializes the AudioManager with the main game camera and scene.
 * This function should be called by game.js AFTER the camera and scene
 * are fully set up and the game loop is active.
 * @param {THREE.Camera} camera The main game camera that follows the player.
 * @param {THREE.Scene} scene The main game scene.
 */
export function initializeAudioManager(camera, scene) {
  console.log("Attempting to initialize AudioManager...");
  console.log("Camera received:", camera);
  console.log("Scene received:", scene);

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

  // REMOVED: setGameScene(scene);
}

/**
 * Starts the Firebase listener for sound events.
 * This should be called AFTER initializeAudioManager has successfully run.
 */
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

export function sendPlayerUpdate(data) {
  const now = Date.now();
  if (now - lastSync < 50) return;
  lastSync = now;
  if (dbRefs && dbRefs.playersRef && localPlayerId) {
    dbRefs.playersRef.child(localPlayerId).update({
      x: data.x,
      y: data.y,
      z: data.z,
      rotY: data.rotY,
      weapon: data.weapon,
      lastUpdate: now
    }).catch(err => console.error("Failed to send player update:", err));
  } else {
    console.warn("Attempted to send player update before network initialized or localPlayerId is null.");
  }
}

let lastSync = 0;

export function updateHealth(health) {
  if (dbRefs && dbRefs.playersRef && localPlayerId) {
    dbRefs.playersRef.child(localPlayerId).update({ health }).catch(err => console.error("Failed to update health:", err));
  }
}

export function updateShield(shield) {
  if (dbRefs && dbRefs.playersRef && localPlayerId) {
    dbRefs.playersRef.child(localPlayerId).update({ shield }).catch(err => console.error("Failed to update shield:", err));
  }
}

export function applyDamageToRemote(targetId, damage, killerInfo) {
  if (!dbRefs || !dbRefs.playersRef) {
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
  if (dbRefs && dbRefs.tracersRef) {
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
  if (dbRefs && dbRefs.chatRef) {
    dbRefs.chatRef.push({ username, text, timestamp: Date.now() }).catch((err) => console.error("Failed to send chat message:", err));
  } else {
    console.warn("Attempted to send chat message before network initialized.");
  }
}

export function sendBulletHole(pos) {
  if (dbRefs && dbRefs.mapStateRef) {
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
  if (dbRefs && dbRefs.soundsRef) {
    // We will send all the relevant sound properties to Firebase
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
      // Include sound properties for the receiving end to use
      volume: soundProps.volume,
      hearingRange: soundProps.hearingRange,
      rolloffFactor: soundProps.rolloffFactor,
      distanceModel: soundProps.distanceModel,
      loop: soundProps.loop ?? false // Ensure loop status is also sent
    }).catch(err => console.error("Failed to send sound event:", err));
  } else {
    console.warn("Attempted to send sound event before network initialized or dbRefs.soundsRef is null.");
  }
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

/**
 * Disconnects a player from the game, removing their data from Firebase and local game state.
 * This function should be called when a player explicitly leaves the game or is detected as disconnected.
 * @param {string} playerId The ID of the player to disconnect.
 */
export function disconnectPlayer(playerId) {
  if (!dbRefs || !dbRefs.playersRef) {
    console.warn("Cannot disconnect player: dbRefs not initialized.");
    return;
  }

  if (playerId === localPlayerId) {
    console.log("Disconnecting local player:", playerId);
    // Remove local player's data from Firebase
    dbRefs.playersRef.child(playerId).remove()
      .then(() => {
        console.log(`Local player ${playerId} removed from Firebase.`);
        localStorage.removeItem("playerId"); // Clear local storage for a clean slate
        // Optionally, redirect or show a disconnect message
        // For now, we'll just reload as in the existing child_removed listener
        location.reload();
      })
      .catch(err => console.error("Failed to remove local player from Firebase:", err));

    // Clear local player ID
    localPlayerId = null;
  } else {
    console.log("Disconnecting remote player:", playerId);
    // Remove the remote player's model and data from local state
    removeRemotePlayerModel(playerId);
    delete remotePlayers[playerId];
    permanentlyRemoved.add(playerId); // Add to permanently removed set to prevent re-addition
  }

  // You might also want to explicitly remove any player-specific listeners here
  // For example, if you had listeners on individual player's health or other stats.
}


export function initNetwork(username, mapName) {
  return new Promise((resolve, reject) => {
    dbRefs = getDbRefs(mapName);
    setUIDbRefs(dbRefs);

    localPlayerId = localStorage.getItem("playerId");
    if (!localPlayerId) {
      localPlayerId = "p_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
      localStorage.setItem("playerId", localPlayerId);
    }

    const initial = {
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

    dbRefs.playersRef.child(localPlayerId).set(initial).catch(err => console.error("Failed to set initial player data:", err));
    // Firebase onDisconnect automatically handles removal when the client disconnects
    dbRefs.playersRef.child(localPlayerId).onDisconnect().remove();

    // Detach all existing listeners to prevent duplicates on re-initialization
    dbRefs.playersRef.off();
    dbRefs.chatRef.off();
    dbRefs.killsRef.off();
    dbRefs.tracersRef.off();
    dbRefs.soundsRef.off();
    if (dbRefs.mapStateRef) {
      dbRefs.mapStateRef.child("bullets").off();
    }

    dbRefs.playersRef.once("value").then((snapshot) => {
      const currentIds = [];
      snapshot.forEach((snap) => {
        const data = snap.val();
        currentIds.push(data.id);
        if (data.id === localPlayerId) {
          if (window.localPlayer && data.isDead) {
            handleLocalDeath();
          }
        } else if (
          !remotePlayers[data.id] &&
          !permanentlyRemoved.has(data.id)
        ) {
          addRemotePlayer(data);
        }
      });

      latestValidIds = currentIds;
      purgeNamelessPlayers(latestValidIds);

      dbRefs.playersRef.on("value", (fullSnap) => {
        const allIds = [];
        fullSnap.forEach(s => allIds.push(s.key));
        latestValidIds = allIds;
        purgeNamelessPlayers(latestValidIds);
        updateScoreboard(dbRefs.playersRef);
      });

      dbRefs.playersRef.on("child_added", (snap) => {
        const data = snap.val();
        const id = data.id;
        console.log("child_added fired for:", snap.val().id);
        if (id === localPlayerId) return;

        if (permanentlyRemoved.has(id)) {
          permanentlyRemoved.delete(id);
          console.log(`[purgeNameless] Clearing permanent removal for ${id} — they rejoined`);
        }

        if (remotePlayers[id] || !data.username) return;

        addRemotePlayer(data);
      });

      dbRefs.playersRef.on("child_changed", (snap) => {
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

      dbRefs.playersRef.on("child_removed", (snap) => {
        const id = snap.key;
        if (id === localPlayerId) {
          console.warn("Local player removed from Firebase. Handling disconnection.");
          localStorage.removeItem("playerId");
          location.reload();
          return;
        }
        permanentlyRemoved.add(id);
        removeRemotePlayerModel(id);
      });

      const chatSeenKeys = new Set();
      dbRefs.chatRef.on("child_added", (snap) => {
        const { username: u, text } = snap.val();
        const key = snap.key;
        if (chatSeenKeys.has(key)) return;
        chatSeenKeys.add(key);
        addChatMessage(u, text, key);
      });

      dbRefs.killsRef.limitToLast(5).on("child_added", (snap) => {
        const k = snap.val();
        updateKillFeed(k.killer, k.victim, k.weapon, snap.key);
        updateScoreboard(dbRefs.playersRef);
      });
      setInterval(() => {
        const cutoff = Date.now() - 60000;
        dbRefs.killsRef.orderByChild("timestamp").endAt(cutoff).once("value", (snapshot) => {
          snapshot.forEach(child => child.ref.remove());
        });
      }, 60000);

      dbRefs.tracersRef.on("child_added", (snap) => {
        const { ox, oy, oz, tx, ty, tz, shooter } = snap.val();
        const tracerRef = snap.ref;
        setTimeout(() => tracerRef.remove().catch(err => console.error("Failed to remove tracer from Firebase:", err)), 1000);
        // Removed this line: if (shooter === localPlayerId) return;
        createTracer(new THREE.Vector3(ox, oy, oz), new THREE.Vector3(tx, ty, tz), snap.key);
      });
      dbRefs.tracersRef.on("child_removed", (snap) => {
        removeTracer(snap.key);
      });

      if (dbRefs.mapStateRef) {
        dbRefs.mapStateRef.child("bullets").on("child_added", (snap) => {
          const hole = snap.val();
          const holeKey = snap.key;

          // Directly call addBulletHole from ui.js
          addBulletHole(hole, holeKey);

          // This timeout is primarily for Firebase cleanup.
          // The local bullet hole's fade out is now handled within addBulletHole in ui.js.
          setTimeout(() => {
            snap.ref.remove().catch(err => console.error("Failed to remove scheduled bullet hole from Firebase:", err));
            // removeBulletHole(holeKey); // This will now be handled by child_removed listener
          }, 5000 - (Date.now() - hole.timeCreated)); // Adjust timeout based on current age
        });

        dbRefs.mapStateRef.child("bullets").on("child_removed", (snap) => {
          // Directly call removeBulletHole from ui.js
          removeBulletHole(snap.key);
        });
      } else {
        console.warn("mapStateRef is not defined, bullet hole synchronization disabled.");
      }

      resolve();
    }).catch((error) => {
      console.error("Network init failed:", error);
      reject(error);
    });
  });
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && dbRefs && dbRefs.playersRef) {
    dbRefs.playersRef.once("value").then(snapshot => {
      const activeFirebasePlayers = new Set();
      snapshot.forEach(snap => {
        const data = snap.val();
        activeFirebasePlayers.add(data.id);
        if (data.id === localPlayerId) return;

        updateRemotePlayer(data);
      });

      Object.keys(remotePlayers).forEach(id => {
        if (!activeFirebasePlayers.has(id)) {
          removeRemotePlayerModel(id);
        }
      });
    }).catch(err => console.error("Error during visibility change resync:", err));
  }
});
