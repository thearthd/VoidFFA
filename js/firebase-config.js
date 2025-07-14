// firebase-config.js

// Firebase configuration for each game instance
// Each game instance (game1, game2) will have its own Firebase project/database.
// This allows for isolated game states.
const configs = {
    // Configuration for Game Instance 1
    game1: {
        apiKey: "AIzaSyDEULlbzl5Sylo-zGHvRIOrd6AOWp4GcxA", // Replace with actual API Key for Game 1
        authDomain: "d-shooter-fa105.firebaseapp.com", // Replace with actual Auth Domain for Game 1
        databaseURL: "https://d-shooter-fa105-default-rtdb.firebaseio.com", // Replace with actual Database URL for Game 1
        projectId: "d-shooter-fa105", // Replace with actual Project ID for Game 1
        storageBucket: "d-shooter-fa105.firebasestorage.app",
        messagingSenderId: "573466540294",
        appId: "1:573466540294:web:b131bfb11220fe35848687",
        measurementId: "G-KKRN5DVEMF"
    },
    // Configuration for Game Instance 2
    game2: {
        apiKey: "AIzaSyAlp49gDO5XCQe9KvHH-yVzo1TrFUv_rGY", // Replace with actual API Key for Game 2
        authDomain: "sigmacity-27a9e.firebaseapp.com", // Replace with actual Auth Domain for Game 2
        databaseURL: "https://sigmacity-27a9e-default-rtdb.firebaseio.com", // Replace with actual Database URL for Game 2
        projectId: "sigmacity-27a9e", // Replace with actual Project ID for Game 2
        storageBucket: "sigmacity-27a9e.firebasestorage.app",
        messagingSenderId: "1056288231871",
        appId: "1:1056288231871:web:d4b35d473de14dfb98910a",
        measurementId: "G-76TZ6XF8WL"
    }
};

// Configuration for the main menu database (for managing game lobbies)
const menuConfig = {
    apiKey: "AIzaSyBmLJjnsXye8oBBpbtTZu0W9-cmEl8QM8s",
    authDomain: "voidffa-menu.firebaseapp.com",
    databaseURL: "https://voidffa-menu-default-rtdb.firebaseio.com",
    projectId: "voidffa-menu",
    storageBucket: "voidffa-menu.firebasestorage.app",
    messagingSenderId: "775839090279",
    appId: "1:775839090279:web:1dfa69158b5e2b0ce436c2",
    measurementId: "G-X9CKZX4C74"
};

// Keep track of initialized Firebase apps for game instances
const gameApps = {};
// Keep track of the initialized Firebase app for the menu
let menuApp = null;

/**
 * Initializes (or returns) a Firebase App and its Database references for a specific game instance.
 * @param {string} gameId - The ID of the game instance (e.g., "game1", "game2").
 * @returns {object} An object containing Firebase database references for the specified game.
 */
export function getGameDbRefs(gameId) {
    if (!configs[gameId]) {
        throw new Error(`Unknown game ID: ${gameId}. Please use 'game1' or 'game2'.`);
    }
    if (!gameApps[gameId]) {
        // Initialize Firebase app for this specific game instance
        const app = firebase.initializeApp(configs[gameId], gameId);
        const database = app.database();
        gameApps[gameId] = {
            playersRef: database.ref("players/"),
            chatRef: database.ref("chat/"),
            mapStateRef: database.ref("mapState/"),
            killsRef: database.ref("kills/"),
            tracersRef: database.ref("tracers/"),
            soundsRef: database.ref("sounds/"),
            // New: Reference for game settings and state
            gameDataRef: database.ref("gameData/")
        };
    }
    return gameApps[gameId];
}

/**
 * Initializes (or returns) the Firebase App and its Database references for the main menu.
 * This is used to manage the list of active games.
 * @returns {object} An object containing Firebase database references for the menu.
 */
export function getMenuDbRefs() {
    if (!menuApp) {
        menuApp = firebase.initializeApp(menuConfig, "menuApp");
    }
    const database = menuApp.database();
    return {
        gamesRef: database.ref("games/") // Reference to a collection of active games
    };
}

// Export firebase for external use if needed (e.g., ServerValue.TIMESTAMP)
export const firebase = window.firebase;
