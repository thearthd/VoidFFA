// firebase-config.js


// Configuration for your Firebase projects
// Make sure these match your actual Firebase project configurations
export const menuConfig = {
    apiKey: "AIzaSyBmLJnsXye8oBBpbtTZu0W9-cmEl8QM8s", // Replace with your menu project's API key
    authDomain: "voidffa-menu.firebaseapp.com",
    databaseURL: "https://voidffa-menu-default-rtdb.firebaseio.com",
    projectId: "voidffa-menu",
    storageBucket: "voidffa-menu.firebasestorage.app",
    messagingSenderId: "775839090279",
    appId: "1:775839090279:web:1dfa69158b5e2b0ce436c2",
    measurementId: "G-X9CKZX4C74"
};

export const gameDatabaseConfigs = {
    gameSlot1: {
        apiKey: "AIzaSyDEULlbzl5Sylo-zGHvRIOrd6AOWp4GcxA", // Replace with Game Slot 1 API key
        authDomain: "d-shooter-fa105.firebaseapp.com",
        databaseURL: "https://d-shooter-fa105-default-rtdb.firebaseio.com",
        projectId: "d-shooter-fa105",
        storageBucket: "d-shooter-fa105.firebasestorage.app",
        messagingSenderId: "573466540294",
        appId: "1:573466540294:web:b131bfb11220fe35848687",
        measurementId: "G-KKRN5DVEMF"
    },
    gameSlot2: {
        apiKey: "AIzaSyAlp49gDO5XCQe9KvHH-yVzo1TrFUv_rGY", // Replace with Game Slot 2 API key
        authDomain: "sigmacity-27a9e.firebaseapp.com",
        databaseURL: "https://sigmacity-27a9e-default-rtdb.firebaseio.com",
        projectId: "sigmacity-27a9e",
        storageBucket: "sigmacity-27a9e.firebasestorage.app",
        messagingSenderId: "1056288231871",
        appId: "1:1056288231871:web:d4b35d473de14dfb98910a",
        measurementId: "G-76TZ6XF8WL"
    }
    // Add more gameSlot configs if you add more Firebase projects for games
};

const gameApps = {}; // Stores initialized game Firebase apps (e.g., gameSlot1App)
let menuApp = null;
export let gamesRef = null; // Reference in the menu database to track active games

// Initialize the menu app once
export function initializeMenuFirebase() {
    if (!menuApp) {
        try {
            // Check if app already exists to avoid re-initializing if called multiple times
            menuApp = firebase.app("menuApp");
            console.log("Re-using existing menuApp");
        } catch (err) {
            console.log("menuApp not found — initializing new Firebase app");
            menuApp = firebase.initializeApp(menuConfig, "menuApp");
        }
        gamesRef = menuApp.database().ref("games"); // 'games' path in the menu database
    }
}

// Ensure menu Firebase is initialized when this module is loaded
initializeMenuFirebase();

/**
 * Finds and claims the next available game slot.
 * @param {string} username - The username of the player attempting to claim the slot.
 * @param {string} mapName - The map name for the new game.
 * @param {boolean} ffaEnabled - True if FFA mode is enabled, false otherwise.
 * @returns {Promise<{slotName: string, dbRefs: object}|null>} - Resolves with the Firebase app instance and its refs if successful, null otherwise.
 */
export const slotsRef = firebase.database().ref('slots');

/**
 * Claim the first slot whose status is 'free'.
 * Returns { slotName, dbRefs } or null if none free.
 */
export async function claimGameSlot(username, map, ffaEnabled) {
  const slotsSnap = await slotsRef.once('value');
  let chosenKey = null;
  slotsSnap.forEach(s => {
    if (!chosenKey && s.val().status === 'free') {
      chosenKey = s.key;
    }
  });
  if (!chosenKey) return null;

  // Mark claimed
  await slotsRef.child(chosenKey).update({
    status:     'claimed',
    host:       username,
    map,
    ffaEnabled,
    claimedAt:  firebase.database.ServerValue.TIMESTAMP
  });

  // Build per‑slot refs
  const baseRef = firebase.database().ref(`slots/${chosenKey}`);
  const dbRefs = {
    playersRef:    baseRef.child('players'),
    chatRef:       baseRef.child('chat'),
    killsRef:      baseRef.child('kills'),
    mapStateRef:   baseRef.child('mapState'),
    tracersRef:    baseRef.child('tracers'),
    soundsRef:     baseRef.child('sounds'),
    gameConfigRef: baseRef.child('gameConfig'),
  };

  return { slotName: chosenKey, dbRefs };
}

/**
 * Release a previously claimed slot back to 'free'.
 */
export async function releaseGameSlot(slotName) {
  await slotsRef.child(slotName).update({ status: 'free', host: null, map: null });
}
