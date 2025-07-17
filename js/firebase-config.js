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
export async function claimGameSlot(username, mapName, ffaEnabled) {
    // Ensure menu Firebase is initialized before attempting to use gamesRef
    initializeMenuFirebase();

    const slotNames = Object.keys(gameDatabaseConfigs);

    for (const slotName of slotNames) {
        const slotRef = gamesRef.child(slotName);
        let snapshot;
        try {
            snapshot = await slotRef.once("value");
        } catch (error) {
            console.error(`Error fetching slot '${slotName}' from menu DB:`, error);
            // This is likely a permission_denied error for the menu DB itself.
            // If the error is permission_denied, it means the rules for the 'games' path
            // in your 'voidffa-menu' project are too restrictive.
            // Make sure your voidffa-menu rules have ".read": "true" for the "games" path.
            continue; // Try next slot
        }
        const slotData = snapshot.val();

        // If the slot is empty or considered free (e.g., game ended long ago or timed out)
        // A game is considered "inactive" and claimable if it's "active" but older than 1 hour (3600000 ms)
        if (!slotData || slotData.status === "ended" || (slotData.status === "active" && Date.now() - slotData.startTime > 3600000)) {
            try {
                let claimed = false;
                await slotRef.transaction((currentData) => {
                    // Only claim if it's currently null, ended, or timed out
                    if (currentData === null || currentData.status === "ended" || (currentData.status === "active" && Date.now() - currentData.startTime > 3600000)) {
                        return {
                            mapName: mapName,
                            status: "active", // Mark as active in the menu DB
                            startTime: firebase.database.ServerValue.TIMESTAMP,
                            hostId: firebase.auth().currentUser ? firebase.auth().currentUser.uid : 'anonymous',
                            gameName: `${username}'s Game`, // Use passed username
                            gamemode: ffaEnabled ? "FFA" : "Teams" // Use passed ffaEnabled
                        };
                    }
                    return undefined; // Abort transaction if not available
                }, (error, committed, snapshot) => {
                    if (error) {
                        console.error("Transaction failed: ", error);
                    } else if (!committed) {
                        console.log(`Slot '${slotName}' was claimed by another client or is still active. Trying next.`);
                    } else {
                        console.log(`Successfully claimed slot '${slotName}' in menu database.`);
                        claimed = true;
                    }
                }, false); // `false` for applyLocally, ensures transaction result is based on server state

                if (claimed) {
                    let gameApp = null;
                    try {
                        // --- DEBUGGER 1 ---
                        debugger; // Execution will pause here if a slot was successfully claimed in menu DB
                        // Check if the game-specific Firebase app already exists to avoid re-initializing
                        gameApp = firebase.apps.find(app => app.name === slotName);
                        if (!gameApp) {
                            // --- DEBUGGER 2 ---
                            debugger; // Execution will pause here if a NEW game app is about to be initialized
                            gameApp = firebase.initializeApp(gameDatabaseConfigs[slotName], slotName);
                            console.log(`Initialized new Firebase app for game slot '${slotName}'.`);
                        } else {
                            console.log(`Re-using existing Firebase app for game slot '${slotName}'.`);
                        }

                        // --- CONSOLE LOG ADDED HERE ---
                        console.log(`[firebase-config.js] Game data for slot '${slotName}' will be written to database URL: ${gameDatabaseConfigs[slotName].databaseURL}`);
                        // --- END CONSOLE LOG ---

                        const dbRefs = {
                            playersRef: gameApp.database().ref("players"),
                            chatRef: gameApp.database().ref("chat"),
                            killsRef: gameApp.database().ref("kills"),
                            mapStateRef: gameApp.database().ref("mapState"),
                            tracersRef: gameApp.database().ref("tracers"),
                            soundsRef: gameApp.database().ref("sounds"),
                            gameConfigRef: gameApp.database().ref("gameConfig")
                        };

                        // Set onDisconnect for the claimed slot in the *menu* database
                        // This ensures the slot is marked "ended" if the host client disconnects unexpectedly.
                        slotRef.onDisconnect().update({ status: "ended", endTime: firebase.database.ServerValue.TIMESTAMP })
                            .then(() => console.log(`onDisconnect set for slot '${slotName}' in menu DB.`))
                            .catch(err => console.error(`Error setting onDisconnect for slot '${slotName}':`, err));

                        return {
                            slotName: slotName,
                            dbRefs: dbRefs
                        };
                    } catch (appError) {
                        // --- DEBUGGER 3 ---
                        debugger; // Execution will pause here if an error occurs during game app initialization
                        console.error(`Error initializing Firebase app for game slot '${slotName}':`, appError);
                        // If game app initialization fails, attempt to release the slot in the menu DB
                        await slotRef.update({ status: "ended" })
                            .then(() => console.log(`Attempted to release slot '${slotName}' after game app init error.`));
                        return null;
                    }
                }
            } catch (err) {
                console.error(`Error during transaction or claiming process for slot '${slotName}':`, err);
            }
        }
    }

    console.warn("No free game slots available.");
    return null;
}

/**
 * Releases a claimed game slot in the menu database.
 * @param {string} slotName - The name of the slot to release.
 * @returns {Promise<void>}
 */
export async function releaseGameSlot(slotName) {
    initializeMenuFirebase(); // Ensure menu app is initialized
    if (gamesRef && slotName) {
        const slotRef = gamesRef.child(slotName);
        try {
            await slotRef.update({
                status: "ended",
                endTime: firebase.database.ServerValue.TIMESTAMP
            });
            // Cancel onDisconnect for this slot to prevent it from marking as ended again
            slotRef.onDisconnect().cancel();
            console.log(`Game slot '${slotName}' released successfully.`);
        } catch (error) {
            console.error(`Error releasing game slot '${slotName}':`, error);
        }
    } else {
        console.warn("Cannot release game slot: gamesRef or slotName is null.");
    }
}
