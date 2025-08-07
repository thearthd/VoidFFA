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
export let requiredGameVersion = "v1.00";

export function initializeMenuFirebase() {
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

export async function assignPlayerVersion(user, version) {
    if (!usersRef || !user || !user.uid) {
        console.error("Error: usersRef not initialized or user is missing. Cannot assign player version.");
        return;
    }
    try {
        await usersRef.child(user.uid).child("version").set(version);
        console.log(`Player ${user.uid} assigned version: ${version}`);
    } catch (error) {
        console.error("Failed to assign player version:", error);
    }
}


export async function claimGameSlot(username, map, ffaEnabled, hostUid) { // 🔍 ADD hostUid to parameters
    const playerVersion = localStorage.getItem("playerVersion");

    if (playerVersion !== requiredGameVersion) {
        Swal.fire('Update Required', `Your game version (${playerVersion || 'N/A'}) does not match the required version (${requiredGameVersion}). Please update your game.`, 'error');
        return null;
    }

    let chosenKey = null,
        chosenApp = null;

    for (let slotName in gameDatabaseConfigs) {
        if (!gameDatabaseConfigs[slotName]) {
            console.warn(`No configuration found for slot: ${slotName}`);
            continue;
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
        const app = gameApps[slotName];

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

    const rootRef = chosenApp.database().ref();

    const gameRef = rootRef.child("game");
    await gameRef.set({
        host: username,
        hostUid, // 🔍 PASS THE hostUid TO THE GAME SLOT DB ENTRY
        map,
        ffaEnabled,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        gameVersion: requiredGameVersion
    });

    const startTime = Date.now();
    const gameDuration = 60; // seconds
    const endTime = startTime + gameDuration * 1000;

    await gameRef.child("gameConfig").set({
        startTime,
        gameDuration,
        endTime
    });

    const dbRefs = {
        playersRef: gameRef.child("players"),
        chatRef: gameRef.child("chat"),
        killsRef: gameRef.child("kills"),
        mapStateRef: gameRef.child("mapState"),
        tracersRef: gameRef.child("tracers"),
        soundsRef: gameRef.child("sounds"),
        gameConfigRef: gameRef.child("gameConfig")
    };

    return {
        slotName: chosenKey,
        dbRefs
    };
}

export async function releaseGameSlot(slotName, gameId) { // 🔍 ADD gameId TO PARAMETERS
    if (!gameApps[slotName]) {
        try {
            gameApps[slotName] = firebase.app(slotName + "App");
        } catch (e) {
            if (gameDatabaseConfigs[slotName]) {
                gameApps[slotName] = firebase.initializeApp(
                    gameDatabaseConfigs[slotName],
                    slotName + "App"
                );
            } else {
                console.error(`Error: Configuration for slot '${slotName}' not found. Cannot release.`);
                return;
            }
        }
    }

    const app = gameApps[slotName];

    if (!app) {
        console.error(`Error: Firebase app for slot '${slotName}' could not be initialized. Cannot release.`);
        return;
    }

    if (slotsRef) {
        await slotsRef.child(slotName).set({
            status: "free"
        });
    } else {
        console.error("Error: slotsRef is not initialized. Call initializeMenuFirebase() first.");
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


    await app.database().ref("game").remove();


    if (gameId && gamesRef) { // 🔍 USE gameId passed to the function
        await gamesRef.child(gameId).remove();
        activeGameId = null;
    } else {
        console.warn("Warning: activeGameId or gamesRef not available when trying to remove game from lobby.");
    }
}
