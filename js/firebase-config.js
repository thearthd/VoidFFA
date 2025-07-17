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

// 2) Per‑slot game database configs
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
  // Add more slots here if you expand
};

// Cache for each game slot’s Firebase app
const gameApps = {};

// 3) Initialize or re-use your named menuApp
let menuApp = null;
export let gamesRef = null;
export function initializeMenuFirebase() {
  if (menuApp) return;
  try {
    menuApp = firebase.app("menuApp");
  } catch {
    menuApp = firebase.initializeApp(menuConfig, "menuApp");
  }
  gamesRef = menuApp.database().ref("games");
}
initializeMenuFirebase();

// 4) Slot‐scoped metadata in your menu DB
export const slotsRef = menuApp.database().ref("slots");

/**
 * Claim the first free slot by scanning each slot’s own /game path.
 * A slot is “free” if its /game node has no children.
 * Returns { slotName, dbRefs } or null if none free.
 */
export async function claimGameSlot(username, map, ffaEnabled) {
  let chosenKey = null;
  let chosenApp = null;

  // Scan in config order for a free slot
  for (let slotName in gameDatabaseConfigs) {
    // Lazy‐init this slot’s Firebase app
    if (!gameApps[slotName]) {
      gameApps[slotName] = firebase.initializeApp(
        gameDatabaseConfigs[slotName],
        slotName + "App"
      );
    }
    const app = gameApps[slotName];

    // Check its /game node
    const gameSnap = await app.database().ref("game").once("value");
    if (!gameSnap.exists() || Object.keys(gameSnap.val() || {}).length === 0) {
      chosenKey = slotName;
      chosenApp = app;
      break;
    }
  }

  if (!chosenKey) {
    // all slots occupied
    return null;
  }

  // Mark claimed in your menu DB
  await slotsRef.child(chosenKey).set({
    status:     "claimed",
    host:       username,
    map,
    ffaEnabled,
    claimedAt:  firebase.database.ServerValue.TIMESTAMP
  });

  // Create a stub under the slot’s own /game to lock it
  await chosenApp.database().ref("game").set({ createdAt: firebase.database.ServerValue.TIMESTAMP });

  // Build your per‑slot refs for game state in its own DB
  const baseRef = chosenApp.database().ref("");
  const dbRefs = {
    playersRef:    baseRef.child("players"),
    chatRef:       baseRef.child("chat"),
    killsRef:      baseRef.child("kills"),
    mapStateRef:   baseRef.child("mapState"),
    tracersRef:    baseRef.child("tracers"),
    soundsRef:     baseRef.child("sounds"),
    gameConfigRef: baseRef.child("gameConfig"),
  };

  return { slotName: chosenKey, dbRefs };
}

/**
 * Release a slot: clear its stub in menu DB and its own /game node.
 */
export async function releaseGameSlot(slotName) {
  // Clear menu metadata
  await slotsRef.child(slotName).set({ status: "free" });

  // Clear the slot’s own /game so it becomes free again
  if (gameApps[slotName]) {
    await gameApps[slotName].database().ref("game").remove();
  }
}
