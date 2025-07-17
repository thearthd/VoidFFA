// firebase-config.js

// Ensure Firebase is loaded before this script, e.g., via <script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js"></script>
// and <script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-database.js"></script>
// and SweetAlert2: <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

import firebase from "firebase/app"; // Ensure you're importing firebase
import "firebase/database"; // Ensure you're importing database module

const gameDatabaseConfigs = {
    gameSlot1: { // Use generic names for slots
        apiKey: "AIzaSyDEULlbzl5Sylo-zGHvRIOrd6AOWp4GcxA",
        authDomain: "d-shooter-fa105.firebaseapp.com",
        databaseURL: "https://d-shooter-fa105-default-rtdb.firebaseio.com",
        projectId: "d-shooter-fa105",
        storageBucket: "d-shooter-fa105.firebasestorage.app",
        messagingSenderId: "573466540294",
        appId: "1:573466540294:web:b131bfb11220fe35848687",
        measurementId: "G-KKRN5DVEMF"
    },
    gameSlot2: { // This would be your SigmaCity config
        apiKey: "AIzaSyAlp49gDO5XCQe9KvHH-yVzo1TrFUv_rGY",
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

const menuConfig = {
    apiKey: "AIzaSyBmLJnsXye8oBBpbtTZu0W9-cmEl8QM8s",
    authDomain: "voidffa-menu.firebaseapp.com",
    databaseURL: "https://voidffa-menu-default-rtdb.firebaseio.com",
    projectId: "voidffa-menu",
    storageBucket: "voidffa-menu.firebasestorage.app",
    messagingSenderId: "775839090279",
    appId: "1:775839090279:web:1dfa69158b5e2b0ce436c2",
    measurementId: "G-X9CKZX4C74"
};

const gameApps = {}; // Stores initialized game Firebase apps (e.g., gameSlot1App)
let menuApp;
export let gamesRef; // Reference in the menu database to track active games

// Initialize the menu app once
try {
    menuApp = firebase.app("menuApp");
    console.log("Re-using existing menuApp");
} catch (err) {
    console.log("menuApp not found — initializing new Firebase app");
    menuApp = firebase.initializeApp(menuConfig, "menuApp");
}
gamesRef = menuApp.database().ref("games"); // 'games' path in the menu database

/**
 * Finds and claims the next available game slot.
 * @param {string} mapName - The map name for the new game.
 * @returns {Promise<{appInstance: firebase.app.App, slotName: string, dbRefs: object}|null>} - Resolves with the Firebase app instance and its refs if successful, null otherwise.
 */
export async function claimGameSlot(mapName) {
    const slotNames = Object.keys(gameDatabaseConfigs);

    for (const slotName of slotNames) {
        const slotRef = gamesRef.child(slotName);
        const snapshot = await slotRef.once("value");
        const slotData = snapshot.val();

        // If the slot is empty or considered free (e.g., game ended long ago)
        // For simplicity, we consider it free if it doesn't exist or doesn't have an 'active' flag.
        // A more robust system would check a 'lastActivity' timestamp and a 'status' field.
        if (!slotData || slotData.status === "ended") { // Or check if slotData.lastActivity is very old
            try {
                // Attempt to claim the slot using a transaction to prevent race conditions
                let claimed = await slotRef.transaction((currentData) => {
                    if (!currentData || currentData.status === "ended") {
                        return {
                            mapName: mapName,
                            status: "active",
                            startTime: firebase.database.ServerValue.TIMESTAMP,
                            hostId: firebase.auth().currentUser ? firebase.auth().currentUser.uid : 'anonymous', // If using auth
                            // Potentially add a placeholder for gameEndTime for FFA
                            gameEndTime: null // Set initially to null
                        };
                    }
                    return undefined; // Abort the transaction if someone else claimed it
                });

                if (claimed.committed) {
                    console.log(`Successfully claimed game slot: ${slotName} for map: ${mapName}`);

                    // Initialize the specific Firebase app for this slot if not already
                    if (!gameApps[slotName]) {
                        let app;
                        try {
                            app = firebase.app(slotName);
                            console.log(`Re-using existing Firebase app for ${slotName}`);
                        } catch {
                            console.log(`No existing app for ${slotName} — initializing`);
                            app = firebase.initializeApp(gameDatabaseConfigs[slotName], slotName);
                        }
                        const db = app.database();
                        gameApps[slotName] = {
                            appInstance: app, // Store the app instance itself
                            playersRef: db.ref("players/"),
                            chatRef: db.ref("chat/"),
                            mapStateRef: db.ref("mapState/"),
                            killsRef: db.ref("kills/"),
                            tracersRef: db.ref("tracers/"),
                            soundsRef: db.ref("sounds/"),
                            gameConfigRef: db.ref("gameConfig/"), // General config for the active game
                            slotRef: slotRef // Reference to its entry in the menu database
                        };

                        // Set up onDisconnect for the game slot in the menu database
                        // If the host client disconnects, mark the slot as ended.
                        // This assumes the host is the one calling claimGameSlot.
                        slotRef.onDisconnect().update({
                            status: "ended",
                            endTime: firebase.database.ServerValue.TIMESTAMP
                        }).catch(err => console.error("Error setting onDisconnect for game slot:", err));
                    }
                    return { appInstance: gameApps[slotName].appInstance, slotName: slotName, dbRefs: gameApps[slotName] };
                } else {
                    console.log(`Slot ${slotName} was claimed by another client. Trying next.`);
                }
            } catch (error) {
                console.error(`Error claiming slot ${slotName}:`, error);
            }
        }
    }

    console.warn("No free game slots available.");
    return null; // No slot found
}

/**
 * Releases a claimed game slot.
 * @param {string} slotName - The name of the slot to release (e.g., 'gameSlot1').
 * @returns {Promise<void>}
 */
export async function releaseGameSlot(slotName) {
    console.log(`Attempting to release game slot: ${slotName}`);
    if (gamesRef && slotName) {
        const slotRef = gamesRef.child(slotName);
        try {
            await slotRef.update({
                status: "ended",
                endTime: firebase.database.ServerValue.TIMESTAMP
            });
            // Cancel onDisconnect for this slot to prevent it from marking as ended again
            slotRef.onDisconnect().cancel();
            console.log(`Game slot ${slotName} released successfully.`);
        } catch (error) {
            console.error(`Error releasing game slot ${slotName}:`, error);
        }
    }
}
