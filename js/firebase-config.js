// firebase-config.js


// Configuration for your Firebase projects
// Make sure these match your actual Firebase project configurations
export const menuConfig = {
  apiKey:            "AIzaSyBmLJnsXye8oBBpbtTZu0W9-cmEl8QM8s",
  authDomain:        "voidffa-menu.firebaseapp.com",
  databaseURL:       "https://voidffa-menu-default-rtdb.firebaseio.com",
  projectId:         "voidffa-menu",
  storageBucket:     "voidffa-menu.firebasestorage.app",
  messagingSenderId: "775839090279",
  appId:              "1:775839090279:web:1dfa69158b5e2b0ce436c2",
  measurementId:     "G-X9CKZX4C74"
};

// Per‑slot game DB configs
export const gameDatabaseConfigs = {
  gameSlot1: {
    apiKey:            "AIzaSyDEULlbzl5Sylo-zGHvRIOrd6AOWp4GcxA",
    authDomain:        "d-shooter-fa105.firebaseapp.com",
    databaseURL:       "https://d-shooter-fa105-default-rtdb.firebaseio.com",
    projectId:         "d-shooter-fa105",
    storageBucket:     "d-shooter-fa105.firebasestorage.app",
    messagingSenderId: "573466540294",
    appId:              "1:573466540294:web:b131bfb11220fe35848687",
    measurementId:     "G-KKRN5DVEMF"
  },
  gameSlot2: {
    apiKey:            "AIzaSyAlp49gDO5XCQe9KvHH-yVzo1TrFUv_rGY",
    authDomain:        "sigmacity-27a9e.firebaseapp.com",
    databaseURL:       "https://sigmacity-27a9e-default-rtdb.firebaseio.com",
    projectId:         "sigmacity-27a9e",
    storageBucket:     "sigmacity-27a9e.firebasestorage.app",
    messagingSenderId: "1056288231871",
    appId:              "1:1056288231871:web:d4b35d473de14dfb98910a",
    measurementId:     "G-76TZ6XF8WL"
  }
};

let menuApp = null;
export let gamesRef = null;
export let usersRef = null;   // ← add this

export function initializeMenuFirebase() {
  if (menuApp) return;
  try {
    menuApp = firebase.app("menuApp");
  } catch {
    menuApp = firebase.initializeApp(menuConfig, "menuApp");
  }
  const db = menuApp.database();
  gamesRef = db.ref("games");
  usersRef = db.ref("users");   // ← initialize it here
}
initializeMenuFirebase();

// Metadata of slots in the lobby DB
export const slotsRef = menuApp.database().ref("slots");

export let activeGameId = null;

// inside initNetwork(), after you do:
//   const slotSnap = await gamesRef.child(gameId).child('slot').once('value');


const gameApps = {};

/**
 * Claim the first free slot by inspecting its own /game node.
 */
export async function claimGameSlot(username, map, ffaEnabled) {
  let chosenKey = null, chosenApp = null;

  // Find the first free slot by checking its own /game node
  for (let slotName in gameDatabaseConfigs) {
    if (!gameApps[slotName]) {
      gameApps[slotName] = firebase.initializeApp(
        gameDatabaseConfigs[slotName],
        slotName + "App"
      );
    }
    const app = gameApps[slotName];
    const gameSnap = await app.database().ref("game").once("value");
    if (!gameSnap.exists() || Object.keys(gameSnap.val() || {}).length === 0) {
      chosenKey = slotName;
      chosenApp = app;
      break;
    }
  }

  if (!chosenKey) return null;

  const rootRef = chosenApp.database().ref();

  // Create game entry
  const gameRef = rootRef.child("game");
  await gameRef.set({
    host: username,
    map,
    ffaEnabled,
    createdAt: firebase.database.ServerValue.TIMESTAMP
  });

  // Create gameConfig inside the /game node
  const startTime = Date.now();
  const gameDuration = 600; // seconds
  const endTime = startTime + gameDuration * 1000;

  await gameRef.child("gameConfig").set({
    startTime,
    gameDuration,
    endTime
  });

  // Return useful database references
  const dbRefs = {
    playersRef: gameRef.child("players"),
    chatRef: gameRef.child("chat"),
    killsRef: gameRef.child("kills"),
    mapStateRef: gameRef.child("mapState"),
    tracersRef: gameRef.child("tracers"),
    soundsRef: gameRef.child("sounds"),
    gameConfigRef: gameRef.child("gameConfig")
  };

  return { slotName: chosenKey, dbRefs };
}
/**
 * Release the slot by clearing /game in its own DB and marking it free in lobby.
 */
export async function releaseGameSlot(slotName) {
  // 1) Mark the slot free
  await slotsRef.child(slotName).set({ status: "free" });

  // 2) Clear the per‑slot game data
  const app = gameApps[slotName];
  if (app) {
    await app.database().ref("game").remove();
  }

  // 3) Also remove the lobby node under /games/{activeGameId}
  if (activeGameId) {
    await gamesRef.child(activeGameId).remove();
    activeGameId = null;
  }
}
