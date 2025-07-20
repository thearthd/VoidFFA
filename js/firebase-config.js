// firebase-config.js

// Configuration for your Firebase projects
// Make sure these match your actual Firebase project configurations
export const menuConfig = {
    apiKey: "AIzaSyBmLJnsXye8oBBpbtTZu0W9-cmEl8QM8s",
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
    }
};

let menuApp = null;
export let gamesRef = null;
export let slotsRef; // Declared here, initialized in initializeMenuFirebase

export function initializeMenuFirebase() {
    if (menuApp) return;
    try {
        menuApp = firebase.app("menuApp");
    } catch {
        menuApp = firebase.initializeApp(menuConfig, "menuApp");
    }
    gamesRef = menuApp.database().ref("games");
    // Ensure slotsRef is also initialized after menuApp is
    if (menuApp) {
        slotsRef = menuApp.database().ref("slots");
    }
}
initializeMenuFirebase(); // Call this to ensure menuApp and gamesRef are initialized

// Metadata of slots in the lobby DB (moved here for clarity, assumes menuApp is ready)


export let activeGameSlotName = null; // Global variable for the active slot name
export let currentGameEndTime = null; // Global variable for the game's end time
export let globalGameTimerInterval = null; // Global variable for the timer's setInterval
export let currentGameSlotDbRefs = null; // Global variable for the current game slot's dbRefs

// --- Global Timer Backbone Functions (Moved/Consolidated for export) ---
// Note: These functions depend on `dbRefs`, `firebase`, `document`, etc.,
// so ensure proper imports and scope in your actual main app.js or similar.

/**
 * Sets up or re-configures the global game timer listener based on activeGameSlotName.
 * This function should be called at app startup and whenever activeGameSlotName changes.
 */
export function setupGlobalGameTimerListener() {
    // Detach any existing gameEndTime listener first
    if (window.currentActiveGameSlotRefListener) {
        window.currentActiveGameSlotRefListener.off('value');
        window.currentActiveGameSlotRefListener = null;
    }
    // Clear any existing display interval
    if (globalGameTimerInterval) {
        clearInterval(globalGameTimerInterval);
        globalGameTimerInterval = null;
    }

    // Only set up a listener if there's an active game slot AND its dbRefs are available
    if (activeGameSlotName && currentGameSlotDbRefs && currentGameSlotDbRefs.gameConfigRef) {
        const gameEndTimeRef = currentGameSlotDbRefs.gameConfigRef.child('gameEndTime');
        window.currentActiveGameSlotRefListener = gameEndTimeRef; // Store ref to detach later

        gameEndTimeRef.on('value', snapshot => {
            currentGameEndTime = snapshot.val();
            console.log(`Game slot ${activeGameSlotName} end time updated:`, currentGameEndTime ? new Date(currentGameEndTime).toLocaleString() : 'N/A');

            if (currentGameEndTime === null) {
                if (globalGameTimerInterval) {
                    clearInterval(globalGameTimerInterval);
                    globalGameTimerInterval = null;
                }
                const gameTimerElement = document.getElementById("game-timer");
                if (gameTimerElement) {
                    gameTimerElement.textContent = "Game Ended!";
                    // Further actions if game ends (e.g., show game over screen)
                }
            } else {
                if (!globalGameTimerInterval) {
                    startGlobalGameTimerDisplay();
                }
            }
        });

    } else {
        // No active game slot, ensure timer is stopped and display is reset
        const gameTimerElement = document.getElementById("game-timer");
        if (gameTimerElement) {
            gameTimerElement.textContent = "Time: --:--"; // Or hide it
        }
    }
}

/**
 * Starts the setInterval to update the timer display.
 */
function startGlobalGameTimerDisplay() {
    if (globalGameTimerInterval) {
        clearInterval(globalGameTimerInterval);
    }

    let now = Date.now();
    let delayToNextSecond = 1000 - (now % 1000);

    globalGameTimerInterval = setTimeout(() => {
        updateTimerDisplay(); // Initial update on the whole second
        globalGameTimerInterval = setInterval(updateTimerDisplay, 1000);
    }, delayToNextSecond);
}

/**
 * Updates the text content of the game timer UI element.
 */
function updateTimerDisplay() {
    const gameTimerElement = document.getElementById("game-timer");
    if (!gameTimerElement) return;

    if (currentGameEndTime === null) {
        gameTimerElement.textContent = "Time: Syncing…";
        return;
    }

    const timeLeftMs = currentGameEndTime - Date.now();

    if (timeLeftMs <= 0) {
        clearInterval(globalGameTimerInterval);
        globalGameTimerInterval = null;
        gameTimerElement.textContent = "TIME UP!";
        // Trigger game end logic
        if (typeof determineWinnerAndEndGame === 'function') { // Assuming this is defined elsewhere
            determineWinnerAndEndGame();
        }
        // Clean up database entry for the timer in the active slot's DB
        if (activeGameSlotName && currentGameSlotDbRefs) {
            currentGameSlotDbRefs.gameConfigRef.child('gameEndTime').remove();
            // You might want to also update the status of the game in the lobby DB here
            // This would require the lobbyGameId to be globally accessible or passed.
        }
        return;
    }

    const totalSecsRemaining = Math.max(0, Math.floor(timeLeftMs / 1000));
    const mins = Math.floor(totalSecsRemaining / 60);
    const secs = totalSecsRemaining % 60;

    gameTimerElement.textContent = `Time: ${mins}:${secs < 10 ? "0" : ""}${secs}`;
}


const gameApps = {}; // Stores initialized Firebase app instances for game slots

/**
 * Claim the first free slot by inspecting its own /game node.
 * This function now also initializes the gameConfig in the slot's database.
 */
export async function claimGameSlot(username, map, ffaEnabled) {
    let chosenKey = null, chosenApp = null;

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
    await rootRef.child("game").set({
        host: username,
        map,
        ffaEnabled,
        createdAt: firebase.database.ServerValue.TIMESTAMP
    });

    const defaultGameDurationSeconds = 10 * 60; // 10 minutes
    await rootRef.child("gameConfig").set({
        gameStartTime: firebase.database.ServerValue.TIMESTAMP,
        gameLengthSeconds: defaultGameDurationSeconds,
        gameEndTime: Date.now() + (defaultGameDurationSeconds * 1000)
    });

    const dbRefs = {
        rootRef: rootRef,
        playersRef: rootRef.child("players"),
        chatRef: rootRef.child("chat"),
        killsRef: rootRef.child("kills"),
        mapStateRef: rootRef.child("mapState"),
        tracersRef: rootRef.child("tracers"),
        soundsRef: rootRef.child("sounds"),
        gameConfigRef: rootRef.child("gameConfig"),
    };

    return { slotName: chosenKey, dbRefs };
}

/**
 * Release the slot by clearing /game in its own DB and marking it free in lobby.
 */
export async function releaseGameSlot(slotName) {
    // 1) Mark the slot free in the lobby DB
    await slotsRef.child(slotName).set({ status: "free" });

    // 2) Clear the per-slot game data in its dedicated DB
    const app = gameApps[slotName];
    if (app) {
        const rootRef = app.database().ref();
        await rootRef.child("game").remove();
        await rootRef.child("gameConfig").remove(); // Also remove the gameConfig
        // You might want to remove other game-specific nodes here as well (players, chat, etc.)
    }

    // 3) Also remove the corresponding game entry from the lobby's /games node
    // This part requires knowing the lobbyGameId. If releaseGameSlot is called
    // without the lobbyGameId, you might need to find it first (e.g., by slotName).
    // For now, assuming you'll have a mechanism to get the lobbyGameId here
    // when calling releaseGameSlot in a real scenario.
    // Example: find lobbyGameId by slotName, then:
    // const lobbyGameId = await findLobbyGameIdBySlotName(slotName);
    // if (lobbyGameId) {
    //     await gamesRef.child(lobbyGameId).remove();
    // }

    // Clear global timer state if the released slot was the active one
    if (activeGameSlotName === slotName) {
        activeGameSlotName = null;
        currentGameSlotDbRefs = null;
        setupGlobalGameTimerListener(); // Stop the global listener
    }
}
