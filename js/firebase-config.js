// firebase-config.js

// Configuration for your Firebase projects
// Make sure these match your actual Firebase project configurations
export const menuConfig = {
    apiKey: "AIzaSyBmLJjnsXye8oBBpbtTZu0W9-cmEl8QM8s",
    authDomain: "voidffa-menu.firebaseapp.com",
    databaseURL: "https://voidffa-menu-default-rtdb.firebaseio.com",
    projectId: "voidffa-menu",
    storageBucket: "voidffa-menu.firebasestorage.app",
    messagingSenderId: "775839090279",
    appId: "1:775839090279:web:1dfa69158b5e2b0ce436c2",
    measurementId: "G-X9CKZX4C74"
};

// Per-slot game DB configs
export const gameDatabaseConfigs = {
    gameSlot1: {
        apiKey: "AIzaSyDEULlbzl5Sylo-zGHvRIOrd6AOWp4GcxA",
        authDomain: "d-shooter-fa105.firebaseapp.com",
        databaseURL: "https://d-shooter-fa105-default-rtdb.firebaseio.com",
        projectId: "d-shooter-fa105",
        storageBucket: "d-shooter-fa105.firebasestorage.app",
        messagingSenderId: "573466540294",
        appId: "1:573466540294:web:b131bfb11220fe35848687",
        measurementId: "G-KKRN5DVEMF"
    },
    gameSlot2: {
        apiKey: "AIzaSyAlp49gDO5XCQe9KvHH-yVzo1TrFUv_rGY",
        authDomain: "sigmacity-27a9e.firebaseapp.com",
        databaseURL: "https://sigmacity-27a9e-default-rtdb.firebaseio.com",
        projectId: "sigmacity-27a9e",
        storageBucket: "sigmacity-27a9e.firebasestorage.app",
        messagingSenderId: "1056288231871",
        appId: "1:1056288231871:web:d4b35d473de14dfb98910a",
        measurementId: "G-76TZ6XF8WL"
    },
    gameSlot3: {
        apiKey: "AIzaSyDYc1sVr5sp6YGDZsDs3AN-FXhZGkaZAvA",
        authDomain: "voidffa-slot3.firebaseapp.com",
        databaseURL: "https://voidffa-slot3-default-rtdb.firebaseio.com",
        projectId: "voidffa-slot3",
        storageBucket: "voidffa-slot3.firebasestorage.app",
        messagingSenderId: "280677059064",
        appId: "1:280677059064:web:d632d5638624eca47d2e0d",
        measurementId: "G-1SHC771L86"
    },
    gameSlot4: {
        apiKey: "AIzaSyBSZApwBTq7TbRvCZBYUQEqkWBvF7QyZzY",
        authDomain: "voidffa-slot4.firebaseapp.com",
        databaseURL: "https://voidffa-slot4-default-rtdb.firebaseio.com",
        projectId: "voidffa-slot4",
        storageBucket: "voidffa-slot4.firebasestorage.app",
        messagingSenderId: "91754867706",
        appId: "1:91754867706:web:7632336bc2399ce19c1243",
        measurementId: "G-8DRX8BW3D1"
    },
    gameSlot5: {
        apiKey: "AIzaSyASSE5gkgoQcdMfHnRdNK8jsFBBOc7ad2Y",
        authDomain: "voidffa-slot5.firebaseapp.com",
        databaseURL: "https://voidffa-slot5-default-rtdb.firebaseio.com",
        projectId: "voidffa-slot5",
        storageBucket: "voidffa-slot5.firebasestorage.app",
        messagingSenderId: "811056373450",
        appId: "1:811056373450:web:174676c2c3a20e1e725e33",
        measurementId: "G-QLR780287C"
    },
};

let menuApp = null;
export let gamesRef = null;
export let usersRef = null;
export let slotsRef = null;
export let menuConfigRef = null;
export let menuChatRef = null;
export let requiredGameVersion = "v1.00"; // Default version, will be updated from DB

export function initializeMenuFirebase() {
    if (firebase.apps.length === 0) {
        // Initialize the default app first
        firebase.initializeApp(menuConfig);
        console.log("Initialized DEFAULT Firebase App.");
    }
    
    if (menuApp) return;

    try {
        menuApp = firebase.app("menuApp");
    } catch {
        menuApp = firebase.initializeApp(menuConfig, "menuApp");
    }

    const db = menuApp.database();
    gamesRef = db.ref("games");
    usersRef = db.ref("users");
    slotsRef = db.ref("slots");
    menuConfigRef = db.ref("menu");
    menuChatRef = db.ref("chat");

    // Fetch the required game version from the database
    menuConfigRef.child("gameVersion").on("value", (snapshot) => {
        if (snapshot.exists()) {
            requiredGameVersion = snapshot.val();
            console.log("Required Game Version:", requiredGameVersion);
        } else {
            console.warn("No 'gameVersion' found in menu database. Defaulting to", requiredGameVersion);
        }
    });
}



initializeMenuFirebase();

export let activeGameId = null;
const gameApps = {};


export async function authenticateToAllSlotApps() {
  const slotNames = Object.keys(gameDatabaseConfigs);
  for (const slotName of slotNames) {
    const cfg = gameDatabaseConfigs[slotName];
    if (!cfg) continue;

    // initialize app instance for slot if missing
    if (!gameApps[slotName]) {
      try {
        gameApps[slotName] = firebase.app(slotName + "App");
      } catch (e) {
        try {
          gameApps[slotName] = firebase.initializeApp(cfg, slotName + "App");
        } catch (initErr) {
          console.warn(`[authAll] Failed to initialize app for ${slotName}:`, initErr);
          continue;
        }
      }
    }

    const slotApp = gameApps[slotName];
    if (!slotApp) continue;

    try {
      const slotAuth = slotApp.auth();

      // If already signed in, reuse that user
      if (!slotAuth.currentUser) {
        const cred = await slotAuth.signInAnonymously();
        const uid = cred.user?.uid;
        if (uid) {
          localStorage.setItem(`playerId-${slotName}`, uid);
          console.log(`[authAll] Signed into ${slotName}, uid: ${uid}`);
        } else {
          console.warn(`[authAll] Sign-in returned no uid for ${slotName}`);
        }
      } else {
        // already signed in for this slot
        const uid = slotAuth.currentUser.uid;
        localStorage.setItem(`playerId-${slotName}`, uid);
        console.log(`[authAll] Already signed into ${slotName}, uid: ${uid}`);
      }
    } catch (err) {
      console.warn(`[authAll] Anonymous sign-in failed for ${slotName}:`, err);
    }
  }
}


/**
 * Initializes the Firebase app for a given game slot and authenticates the player anonymously.
 * @param {string} slotName The name of the game slot (e.g., 'gameSlot1').
 * @returns {Promise<{slotApp: firebase.app.App, userId: string, dbRefs: object}>} An object with the slot's app, the player's userId, and the database references.
 */
export async function initGameFirebaseApp(slotName) {
    if (!gameDatabaseConfigs[slotName]) {
        console.error(`No configuration found for slot: ${slotName}`);
        return null;
    }

    if (!gameApps[slotName]) {
        try {
            gameApps[slotName] = firebase.app(slotName + "App");
        } catch (e) {
            gameApps[slotName] = firebase.initializeApp(
                gameDatabaseConfigs[slotName],
                slotName + "App"
            );
        }
    }
    const slotApp = gameApps[slotName];
    if (!slotApp) {
        console.error(`Failed to initialize Firebase app for slot: ${slotName}`);
        return null;
    }

    // Authenticate the player anonymously
    const auth = slotApp.auth();
    let user;
    try {
        const userCredential = await auth.signInAnonymously();
        user = userCredential.user;
        console.log(`[auth] Successfully signed in anonymously to game slot "${slotName}". User ID: ${user.uid}`);
    } catch (error) {
        console.error(`[auth] Failed to sign in anonymously to game slot "${slotName}":`, error);
        return null;
    }

    const db = slotApp.database();
    const dbRefs = {
        playersRef: db.ref('players'),
        chatRef: db.ref('chat'),
        killsRef: db.ref('kills'),
        mapStateRef: db.ref('mapState'),
        tracersRef: db.ref('tracers'),
        soundsRef: db.ref('sounds'),
        gameConfigRef: db.ref('gameConfig'),
    };

    return { slotApp, userId: user.uid, dbRefs };
}


/**
 * Assigns the player's current game version to their user profile in the menu database.
 * This function should be called when the player logs in or their profile is loaded.
 * @param {string} username The current player's username.
 * @param {string} version The client's current game version (e.g., "v1.00").
 */
export async function assignPlayerVersion(username, version) {
    if (!usersRef) {
        console.error("Error: usersRef not initialized. Cannot assign player version.");
        return;
    }
    try {
        await usersRef.child(username).child("version").set(version);
        console.log(`Player ${username} assigned version: ${version}`);
    } catch (error) {
        console.error("Failed to assign player version:", error);
    }
}


/**
 * Claim the first free slot by inspecting its own /game node.
 */
export async function claimGameSlot(username, map, ffaEnabled) {
    // Before claiming a slot, check if the player's version matches the required version
    // The clientVersion is now passed explicitly or accessed via a shared mechanism.
    const playerVersion = localStorage.getItem("playerVersion"); // Assuming it's still stored here.

    if (playerVersion !== requiredGameVersion) {
        Swal.fire('Update Required', `Your game version (${playerVersion || 'N/A'}) does not match the required version (${requiredGameVersion}). Please update your game.`, 'error');
        return null;
    }


    let chosenKey = null,
        chosenApp = null;

    // Find the first free slot by checking its own /game node
    for (let slotName in gameDatabaseConfigs) {
        if (!gameDatabaseConfigs[slotName]) {
            console.warn(`No configuration found for slot: ${slotName}`);
            continue;
        }

        if (!gameApps[slotName]) {
            try {
                // Try to get an existing app instance if it was initialized elsewhere
                gameApps[slotName] = firebase.app(slotName + "App");
            } catch (e) {
                // If not found, initialize it
                gameApps[slotName] = firebase.initializeApp(
                    gameDatabaseConfigs[slotName],
                    slotName + "App"
                );
            }
        }
        const app = gameApps[slotName];

        // Ensure the app is correctly initialized before proceeding
        if (!app) {
            console.error(`Failed to initialize Firebase app for slot: ${slotName}`);
            continue;
        }

        const gameSnap = await app.database().ref("game").once("value");
        if (!gameSnap.exists() || Object.keys(gameSnap.val() || {}).length === 0) {
            chosenKey = slotName;
            chosenApp = app;
            break;
        }
    }

    if (!chosenKey) {
        console.log("No free game slots available.");
        return null;
    }

    const db = chosenApp.database();
    const gameRef = db.ref("game");

    // Create game entry
    await gameRef.set({
        host: username,
        map,
        ffaEnabled,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        gameVersion: requiredGameVersion // Assign the current required game version to the game instance
    });

    // Create gameConfig inside the /game node
    const startTime = Date.now();
    const gameDuration = 60; // seconds
    const endTime = startTime + gameDuration * 1000;

    await gameRef.child("gameConfig").set({
        startTime,
        gameDuration,
        endTime
    });

    // Return useful database references
    const dbRefs = {
        playersRef: db.ref("game/players"),
        chatRef: db.ref("game/chat"),
        killsRef: db.ref("game/kills"),
        mapStateRef: db.ref("game/mapState"),
        tracersRef: db.ref("game/tracers"),
        soundsRef: db.ref("game/sounds"),
        gameConfigRef: db.ref("game/gameConfig")
    };

    return {
        slotName: chosenKey,
        dbRefs
    };
}
/**
 * Release the slot by clearing /game in its own DB and marking it free in lobby.
 */
export async function releaseGameSlot(slotName) {
    // Ensure the Firebase app for this slot is initialized if it hasn't been already in this session.
    if (!gameApps[slotName]) {
        try {
            // Try to get an existing app instance if it was initialized elsewhere
            gameApps[slotName] = firebase.app(slotName + "App");
        } catch (e) {
            // If not found, initialize it, but only if config exists
            if (gameDatabaseConfigs[slotName]) {
                gameApps[slotName] = firebase.initializeApp(
                    gameDatabaseConfigs[slotName],
                    slotName + "App"
                );
            } else {
                console.error(`Error: Configuration for slot '${slotName}' not found. Cannot release.`);
                return; // Cannot proceed without config
            }
        }
    }

    const app = gameApps[slotName];

    // If after all checks, app is still null/undefined, something is fundamentally wrong
    if (!app) {
        console.error(`Error: Firebase app for slot '${slotName}' could not be initialized. Cannot release.`);
        return;
    }

    const db = app.database();

    // 1) Mark the slot free in the menu database
    // Ensure slotsRef is initialized. It depends on menuApp, which is initialized by initializeMenuFirebase().
    // The user's code calls initializeMenuFirebase() at the end, so this should be fine.
    if (slotsRef) {
        await slotsRef.child(slotName).set({
            status: "free"
        });
    } else {
        console.error("Error: slotsRef is not initialized. Call initializeMenuFirebase() first.");
        // Attempt to initialize if it's not. This might be redundant if the initial call is reliable.
        initializeMenuFirebase();
        if (slotsRef) {
            await slotsRef.child(slotName).set({
                status: "free"
            });
        } else {
            console.error("Error: Failed to initialize slotsRef even after attempting to re-initialize menu Firebase.");
            return;
        }
    }


    // 2) Clear the per-slot game data in its own database
    await db.ref("game").remove();


    // 3) Also remove the lobby node under /games/{activeGameId} in the menu database
    if (activeGameId && gamesRef) {
        await gamesRef.child(activeGameId).remove();
        activeGameId = null;
    } else {
        console.warn("Warning: activeGameId or gamesRef not available when trying to remove game from lobby.");
    }
}
