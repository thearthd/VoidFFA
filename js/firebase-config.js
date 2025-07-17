// firebase-config.js

// Ensure Firebase is loaded before this script, e.g., via <script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js"></script>
// and <script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-database.js"></script>
// and SweetAlert2: <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

const configs = {
    CrocodilosConstruction: {
        apiKey: "AIzaSyDEULlbzl5Sylo-zGHvRIOrd6AOWp4GcxA",
        authDomain: "d-shooter-fa105.firebaseapp.com",
        databaseURL: "https://d-shooter-fa105-default-rtdb.firebaseio.com",
        projectId: "d-shooter-fa105",
        storageBucket: "d-shooter-fa105.firebasestorage.app",
        messagingSenderId: "573466540294",
        appId: "1:573466540294:web:b131bfb11220fe35848687",
        measurementId: "G-KKRN5DVEMF"
    },
    SigmaCity: {
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

const menuConfig = {
    apiKey: "AIzaSyBmLJjnsXye8oBBpbtTZu0W9-cmEl8QM8s",
    authDomain: "voidffa-menu.firebaseapp.com",
    databaseURL: "https://voidffa-menu-default-rtdb.firebaseio.com",
    projectId: "voidffa-menu",
    storageBucket: "voidffa-menu.firebasestorage.app",
    messagingSenderId: "775839090279",
    appId: "1:775839090279:web:1dfa69158b5e2b0ce436c2",
    measurementId: "G-X9CKZX4C74"
}

// Keep track of initialized apps
const apps = {};

// Initialize (or return) the Firebase app for the menu
let menuApp = null;
export let gamesRef = null; // Export directly here so it's accessible by other modules

try {
    // Attempt to get an already initialized app instance named "menuApp"
    menuApp = firebase.app("menuApp");
    console.log("Menu Firebase app 'menuApp' already initialized.");
} catch (e) {
    // If "menuApp" is not found, initialize it
    // The error code for no app found is typically 'app/no-app' or 'app/no-app-found'
    if (e.code === 'app/no-app' || e.code === 'app/no-app-found') {
        console.log("Menu Firebase app 'menuApp' not found, initializing...");
        menuApp = firebase.initializeApp(menuConfig, "menuApp");
    } else {
        console.error("Error with menu Firebase app:", e);
    }
}

// Ensure gamesRef is set *after* menuApp is definitely initialized
// This block runs regardless of whether menuApp was newly initialized or retrieved
if (menuApp) {
    gamesRef = menuApp.database().ref("games");
    console.log("gamesRef initialized for menuApp.");
} else {
    console.error("Firebase menuApp failed to initialize, gamesRef will not be available.");
}

/**
 * Initialize (or return) a compat App + Database for the given mapName.
 * @param {"CrocodilosConstruction"|"SigmaCity"} mapName
 */
export function getDbRefs(mapName) {
    if (!configs[mapName]) {
        throw new Error(`Unknown mapName: ${mapName}`);
    }
    if (!apps[mapName]) {
        try {
            const app = firebase.app(mapName); // Try to get existing app
            const database = app.database();
            apps[mapName] = {
                playersRef: database.ref("players/"),
                chatRef:    database.ref("chat/"),
                mapStateRef:database.ref("mapState/"),
                killsRef:   database.ref("kills/"),
                tracersRef: database.ref("tracers/"),
                soundsRef:  database.ref("sounds/")
            };
            console.log(`Map Firebase app '${mapName}' already initialized.`);
        } catch (e) {
            if (e.code === 'app/no-app' || e.code === 'app/no-app-found') {
                console.log(`Map Firebase app '${mapName}' not found, initializing...`);
                const app = firebase.initializeApp(configs[mapName], mapName);
                const database = app.database();
                apps[mapName] = {
                    playersRef: database.ref("players/"),
                    chatRef:    database.ref("chat/"),
                    mapStateRef:database.ref("mapState/"),
                    killsRef:   database.ref("kills/"),
                    tracersRef: database.ref("tracers/"),
                    soundsRef:  database.ref("sounds/")
                };
            } else {
                console.error(`Error with map Firebase app '${mapName}':`, e);
            }
        }
    }
    return apps[mapName];
}

// No need for a redundant export { gamesRef }; at the bottom if it's already `export let gamesRef = null;`
