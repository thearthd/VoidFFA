// js/menu.js
// f


import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js"; // Moved from main.js

// Import createGameUI and initBulletHoles from ui.js
import { createGameUI, initBulletHoles } from "./ui.js"; // Moved from main.js

// Import startGame and toggleSceneDetails from game.js
import { startGame, toggleSceneDetails } from "game.jss"; // Moved from main.js
import { initNetwork } from "./network.js"; // Moved from main.js

// Global window properties (less is more in main.js now)
// These are declarations that other files might expect to exist on 'window'.
// Their actual instantiation happens within game.js's initScene functions.
window.scene = new THREE.Scene();
window.renderer = {
    shadowMap: { enabled: true },
    setClearColor: () => {} // Placeholder
};
window.dirLight = null;
window.originalFogParams = {
    type: "exp2",
    color: 0x87ceeb,
    density: 0.05,
    near: 1,
    far: 1000
};
window.originalBloomStrength = 3;
window.bloomPass = null;


/**
 * Initializes the main menu UI, handling username entry, map selection,
 * sensitivity settings, and the details toggle.
 *
 * This function is now the primary entry point for the menu page.
 * It also handles the redirection to game.html and subsequent game initialization.
 */
export function initMenuUI() { // No longer needs startGameCallback, toggleDetailsCallback as args
    const menuOverlay = document.getElementById("menu-overlay");
    const usernamePrompt = document.getElementById("username-prompt");
    const mapSelect = document.getElementById("map-menu");
    const controlsMenu = document.getElementById("controls-menu");

    const playButton = document.getElementById("play-button");
    const settingsButton = document.getElementById("settings-button");
    const careerButton = document.getElementById("career-button");

    const saveUsernameBtn = document.getElementById("save-username-btn");
    const usernameInput = document.getElementById("username-input");

    const sensitivityRange = document.getElementById("sensitivity-range");
    const sensitivityInput = document.getElementById("sensitivity-input");
    const toggleDetailsBtn = document.getElementById("toggle-details-btn");

    const mapButtons = document.querySelectorAll(".map-btn");

    let username = localStorage.getItem("username");
    let currentDetailsEnabled = localStorage.getItem("detailsEnabled") === "false" ? false : true;

    // --- Helper function to show a specific panel and hide others ---
    function showPanel(panelToShow) {
        // Hide all potential panels first
        [usernamePrompt, mapSelect, controlsMenu].forEach(panel => {
            if (panel) panel.classList.add("hidden");
        });
        // Show the desired panel
        if (panelToShow) {
            panelToShow.classList.remove("hidden");
            // Ensure display is set to flex for panels that use it for centering
            panelToShow.style.display = 'flex';
        }
    }

    // --- Initial Menu State Setup ---
    function initializeMenuDisplay() {
        showPanel(null); // Ensure all sub-panels are hidden on initial load
    }

    // --- Event Listeners for Main Menu Buttons ---
    if (playButton) {
        playButton.addEventListener("click", () => {
            console.log("you idiot lol");
            console.log("Play button clicked (showing map selection)");
            // No mapName here, as it's selected on the next panel
          showPanel(mapSelect);
        });
    }

    if (settingsButton) {
        settingsButton.addEventListener("click", () => {
            showPanel(controlsMenu);
        });
    }

    if (careerButton) {
        careerButton.addEventListener("click", () => {
            console.log("Career button clicked!");
        });
    }

    // --- Username Prompt Logic (now accessed via Settings) ---
    if (usernameInput && username) {
        usernameInput.value = username;
    }

    if (saveUsernameBtn) {
        saveUsernameBtn.addEventListener("click", () => {
            const val = usernameInput.value.trim();
            if (val.length > 0) {
                localStorage.setItem("username", val);
                username = val;
                showPanel(controlsMenu);
            } else {
                console.warn("Username cannot be empty!");
            }
        });
    }

    // --- Sensitivity Slider Logic ---
    function setSensitivity(newVal) {
        const v = Math.min(parseFloat(sensitivityRange.max), Math.max(parseFloat(sensitivityRange.min), newVal)).toFixed(2);
        sensitivityRange.value = v;
        sensitivityInput.value = v;
        localStorage.setItem("sensitivity", v);
        document.dispatchEvent(new CustomEvent("updateSensitivity", { detail: parseFloat(v) }));
    }

    const savedSens = localStorage.getItem("sensitivity") || "5.00";
    if (sensitivityRange && sensitivityInput) {
        setSensitivity(parseFloat(savedSens));
        sensitivityRange.addEventListener('input', () => {
            setSensitivity(sensitivityRange.value);
        });
        sensitivityInput.addEventListener('change', () => {
            setSensitivity(parseFloat(sensitivityInput.value));
        });
    }

    // --- Details Toggle Logic ---
    if (toggleDetailsBtn) { // Removed typeof check as it's now internal
        toggleDetailsBtn.textContent = currentDetailsEnabled ? "Details: On" : "Details: Off";

        toggleDetailsBtn.addEventListener("click", () => {
            currentDetailsEnabled = !currentDetailsEnabled;
            localStorage.setItem("detailsEnabled", currentDetailsEnabled.toString());

            toggleDetailsBtn.textContent = currentDetailsEnabled
                ? "Details: On"
                : "Details: Off";

            // Directly call toggleSceneDetails from game.js
            toggleSceneDetails(currentDetailsEnabled);
        });
    }

    // --- Map Selection Logic ---
    mapButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            username = localStorage.getItem("username");
            if (!username) {
                showPanel(usernamePrompt);
                return;
            }

            const mapName = btn.dataset.map;
            // Removed: localStorage.setItem("selectedMap", mapName);
            localStorage.setItem("detailsEnabled", currentDetailsEnabled.toString());

            console.log(`Player clicked play for map: ${mapName}, Username: ${username}, Details Enabled: ${currentDetailsEnabled}`);

            // Direct redirection and game initialization setup
            // Instead of redirecting and then trying to get mapName, pass it via URL
            // or better yet, trigger startGame directly if on game.html.
            // Since you're redirecting, you can pass it as a URL parameter.
            window.location.href = `game.html?map=${mapName}`;
        });
    });

    initializeMenuDisplay();

    // The return value for initialDetailsEnabled is no longer strictly needed here
    // as the menu itself manages the state and redirection.
}

// --- Main execution logic (formerly in main.js) ---
document.addEventListener('DOMContentLoaded', () => {
    // Check if we are on the game.html page
    if (window.location.pathname.endsWith('index.html')) {
        // If on game.html, immediately set up the game UI and start the game.
        const gameWrapper = document.getElementById('game-wrapper');
        if (gameWrapper) {
            createGameUI(gameWrapper);

            const username = localStorage.getItem("username") || "Guest";
            // Get mapName from URL parameter
            const urlParams = new URLSearchParams(window.location.search);
            const mapName = urlParams.get('map'); // 'map' is the key we set in the URL

            if (mapName) {
                // Call startGame with the retrieved mapName
                startGame(username, mapName, localStorage.getItem("detailsEnabled") === "true"); // Pass currentDetailsEnabled
                initNetwork(username, mapName);
                console.log(`Game UI and game initialized on game.html for map: ${mapName}.`);
            } else {
                console.warn("No map specified in URL. Starting with a default map or showing an error.");
                // Handle case where no map is in URL, e.g., redirect back to menu or use a default map
                // For now, let's just log it and assume startGame can handle a null/undefined mapName if needed
                // or you might want to redirect back to the menu: window.location.href = 'index.html';
                startGame(username, "defaultMap", localStorage.getItem("detailsEnabled") === "true"); // Example default
                initNetwork(username, "defaultMap"); // Example default
            }

        } else {
            console.error("game-wrapper element not found in game.html!");
        }
    } else {
        // We are on index.html (the menu page)
        console.log("Attempting to initialize Menu UI on index.html...");
        // Call initMenuUI directly without passing callbacks, as it now contains the logic
        initMenuUI();
        console.log("Menu UI initialization process started.");
    }
});
