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
  apiKey: "AIzaSyBmLJnsXye8oBBpbtTZu0W9-cmEl8QM8s",
  authDomain: "voidffa-menu.firebaseapp.com",
  databaseURL: "https://voidffa-menu-default-rtdb.firebaseio.com",
  projectId: "voidffa-menu",
  storageBucket: "voidffa-menu.firebasestorage.app",
  messagingSenderId: "775839090279",
  appId: "1:775839090279:web:1dfa69158b5e2b0ce436c2",
  measurementId: "G-X9CKZX4C74"
};

const apps = {};

// Initialize (or return) the Firebase app for the menu
let menuApp;
let gamesRef;
try {
  menuApp = firebase.app("menuApp");
  console.log("Re‑using existing menuApp");
} catch (err) {
  console.log("menuApp not found — initializing new Firebase app");
  menuApp = firebase.initializeApp(menuConfig, "menuApp");
}
gamesRef = menuApp.database().ref("games");

// Exported function to initialize or return map‐specific apps
export function getDbRefs(mapName) {
  if (!configs[mapName]) throw new Error(`Unknown mapName: ${mapName}`);
  if (!apps[mapName]) {
    let app;
    try {
      app = firebase.app(mapName);
      console.log(`Re‑using existing Firebase app for ${mapName}`);
    } catch {
      console.log(`No existing app for ${mapName} — initializing`);
      app = firebase.initializeApp(configs[mapName], mapName);
    }
    const db = app.database();
    apps[mapName] = {
      playersRef:  db.ref("players/"),
      chatRef:     db.ref("chat/"),
      mapStateRef: db.ref("mapState/"),
      killsRef:    db.ref("kills/"),
      tracersRef:  db.ref("tracers/"),
      soundsRef:   db.ref("sounds/")
    };
  }
  return apps[mapName];
}

export { gamesRef };
