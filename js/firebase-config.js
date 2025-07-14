// firebase-config.js

const configs = {
    game1: { // Renamed from CrocodilosConstruction
        apiKey: "AIzaSyDEULlbzl5Sylo-zGHvRIOrd6AOWp4GcxA",
        authDomain: "d-shooter-fa105.firebaseapp.com",
        databaseURL: "https://d-shooter-fa105-default-rtdb.firebaseio.com",
        projectId: "d-shooter-fa105",
        storageBucket: "d-shooter-fa105.firebasestorage.app",
        messagingSenderId: "573466540294",
        appId: "1:573466540294:web:b131bfb11220fe35848687",
        measurementId: "G-KKRN5DVEMF"
    },
    game2: { // Renamed from SigmaCity
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

export const menuConfig = { // Exported for use in menu.js
    apiKey: "AIzaSyBmLJjnsXye8oBBpbtTZu0W9-cmEl8QM8s",
    authDomain: "voidffa-menu.firebaseapp.com",
    databaseURL: "https://voidffa-menu-default-rtdb.firebaseio.com",
    projectId: "voidffa-menu",
    storageBucket: "voidffa-menu.firebasestorage.app",
    messagingSenderId: "775839090279",
    appId: "1:775839090279:web:1dfa69158b5e2b0ce436c2",
    measurementId: "G-X9CKZX4C74"
};

// Keep track of initialized apps
const apps = {};
const menuAppInitialized = false; // Flag to ensure menu app is initialized only once

/**
 * Initialize (or return) a compat App + Database for the given gameId or menu.
 * @param {string} type - "menu" or a specific gameId ("game1", "game2").
 */
export function getDbRefs(type) {
    let config;
    let appName;

    if (type === "menu") {
        config = menuConfig;
        appName = "menuApp";
    } else if (configs[type]) {
        config = configs[type];
        appName = type; // Use gameId as app name
    } else {
        throw new Error(`Unknown type: ${type}`);
    }

    if (!apps[appName]) {
        // initializeApp returns firebase.app.App
        const app = firebase.initializeApp(config, appName);
        const database = app.database();
        
        if (type === "menu") {
            apps[appName] = {
                gamesRef: database.ref("games/") // Reference to manage game lobbies
            };
        } else {
            // For specific games (game1, game2), all data is nested under its gameId
            apps[appName] = {
                playersRef: database.ref(`games/${type}/players/`),
                chatRef:    database.ref(`games/${type}/chat/`),
                mapStateRef:database.ref(`games/${type}/mapState/`),
                killsRef:   database.ref(`games/${type}/kills/`),
                tracersRef: database.ref(`games/${type}/tracers/`),
                soundsRef:  database.ref(`games/${type}/sounds/`),
                gameSettingsRef: database.ref(`games/${type}/settings/`) // To store timer, playerCount, gamemode
            };
        }
    }
    return apps[appName];
}

// Initialize the menu app once on load
if (!menuAppInitialized) {
    try {
        getDbRefs("menu"); // Initialize the menu Firebase app
        // menuAppInitialized = true; // This flag won't persist across module reloads in some environments, but it's fine for a simple guard.
    } catch (e) {
        console.error("Failed to initialize menu Firebase app:", e);
    }
}
