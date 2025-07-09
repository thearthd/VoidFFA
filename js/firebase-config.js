// firebase-config.js

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

// Keep track of initialized apps
const apps = {};

/**
 * Initialize (or return) a compat App + Database for the given mapName.
 * @param {"LobotomyLinework"|"SigmaCity"} mapName
 */
export function getDbRefs(mapName) {
  if (!configs[mapName]) {
    throw new Error(`Unknown mapName: ${mapName}`);
  }
  if (!apps[mapName]) {
    // initializeApp returns firebase.app.App
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
  }
  return apps[mapName];
}

