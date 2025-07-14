// firebase-config.js

// Firebase v8 compatibility imports (assuming you're using v8 syntax for new features)
// Make sure firebase is loaded globally, e.g., via <script src="https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js"></script>
// and <script src="https://www.gstatic.com/firebasejs/8.10.0/firebase-database.js"></script>

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

// Map configurations will now be referenced by mapName, not gameId
// Their details (like GLB URL, scale, spawn points) are hardcoded here.
const mapConfigs = {
    "SigmaCity": {
        mapName: "SigmaCity",
        GLB_MODEL_URL: 'https://raw.githubusercontent.com/thearthd/3d-models/main/sigmaCITYPLEASE.glb',
        SCALE: 2,
        spawnPoints: [
            new THREE.Vector3(0, 15, 0),
        ],
    },
    "CrocodilosConstruction": {
        mapName: "CrocodilosConstruction",
        GLB_MODEL_URL: 'https://raw.githubusercontent.com/thearthd/3d-models/main/croccodilosconstruction.glb',
        SCALE: 5,
        spawnPoints: [
            new THREE.Vector3(-14, 7, -36), // 1
            new THREE.Vector3(-2, 2, 37), // 2
            new THREE.Vector3(0, 2, 0), // 3
            new THREE.Vector3(2, 7, 34), // 4
            new THREE.Vector3(-5, 2, -38), // 5
            new THREE.Vector3(-18, 2, 12), // 6
            new THREE.Vector3(11, 2, 23), // 7
            new THREE.Vector3(-7, 7, -1), // 8
        ],
    }
};

// Keep track of initialized apps
let menuAppInstance = null; // For the menu database connection

/**
 * Initializes (or returns) the Firebase App + Database for the menu.
 * This app instance will be used for all game lobby and game-specific data.
 */
export function getMenuDbRefs() {
    if (!menuAppInstance) {
        menuAppInstance = firebase.initializeApp(menuConfig, "menuApp");
    }
    const database = menuAppInstance.database();
    return {
        gamesRef: database.ref("games/"), // Root collection for all game lobbies
    };
}

/**
 * Initialize (or return) Firebase database references for a specific game instance.
 * These references point to paths under /games/{gameId}/ within the menu database.
 * @param {string} gameId - The ID of the game (e.g., "game1", "game2")
 */
export function getDbRefs(gameId) {
    // Ensure the menu app is initialized first to get the database instance
    const menuDbRefs = getMenuDbRefs();
    const database = menuAppInstance.database(); // Use the database from the menu app instance

    // Construct game-specific references
    return {
        playersRef: database.ref(`games/${gameId}/players/`),
        chatRef: database.ref(`games/${gameId}/chat/`),
        mapStateRef: database.ref(`games/${gameId}/mapState/`),
        killsRef: database.ref(`games/${gameId}/kills/`),
        tracersRef: database.ref(`games/${gameId}/tracers/`),
        soundsRef: database.ref(`games/${gameId}/sounds/`),
        gameSettingsRef: database.ref(`games/${gameId}/settings/`), // Reference to game settings (timer, kill limit, gamemode, mapName)
        gameWinnerRef: database.ref(`games/${gameId}/winner/`),     // Reference to store game winner
    };
}

/**
 * Retrieves map configuration details based on the mapName.
 * @param {string} mapName - The name of the map (e.g., "SigmaCity", "CrocodilosConstruction")
 * @returns {object} The map configuration object.
 */
export function getMapConfig(mapName) {
    return mapConfigs[mapName];
}

