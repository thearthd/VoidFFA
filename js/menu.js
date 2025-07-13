// js/menu.js
// f


import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js"; // Moved from main.js

// Import createGameUI and initBulletHoles from ui.js
import { createGameUI, initBulletHoles } from "./ui.js"; // Moved from main.js

// Import startGame and toggleSceneDetails from game.js
import { startGame, toggleSceneDetails } from "./game.js"; // Corrected import path for game.js (removed extra 's')
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
            console.log("Play button clicked (showing map selection)");
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
    if (toggleDetailsBtn) {
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
            localStorage.setItem("detailsEnabled", currentDetailsEnabled.toString());

            console.log(`Player clicked play for map: ${mapName}, Username: ${username}, Details Enabled: ${currentDetailsEnabled}`);

            // Hide the menu overlay to reveal the game
            if (menuOverlay) {
                menuOverlay.classList.add("hidden");
            }

            // Initialize game UI (if not already done) and start the game
            const gameWrapper = document.getElementById('game-container');
            if (gameWrapper) {
                // Ensure createGameUI is only called once if it creates permanent elements
                // If it appends to gameWrapper, it's fine to call it here.
                // If your game UI is already part of index.html, you might not need this call here.
                createGameUI(gameWrapper);
              initNetwork(username, mapName);
                startGame(username, mapName, localStorage.getItem("detailsEnabled") === "true");
               
                console.log(`Game UI and game initialized directly on index.html for map: ${mapName}.`);
            } else {
                console.error("game-container element not found in index.html! Make sure your game elements are present.");
            }
        });
    });

    initializeMenuDisplay();
}

// --- Main execution logic ---
document.addEventListener('DOMContentLoaded', () => {
    // Always initialize the menu UI if we are on index.html
    if (window.location.pathname.endsWith('index.html') || window.location.pathname === '/') {
        console.log("Attempting to initialize Menu UI on index.html...");
        initMenuUI();
        console.log("Menu UI initialization process started.");
    } else {
        // This block would typically handle game.html, but since we're no longer redirecting,
        // it might not be strictly necessary if index.html is the only entry point.
        // However, keeping it for robustness if game.html could still be accessed directly.
        const gameWrapper = document.getElementById('game-container');
        if (gameWrapper) {
            createGameUI(gameWrapper);

            const username = localStorage.getItem("username") || "Guest";
            const urlParams = new URLSearchParams(window.location.search);
            const mapName = urlParams.get('map');
        } else {
            console.error("game-container element not found!");
        }
    }
});


    var circle = new Circle(250);
    circle.setPosition(415, 300);
    circle.setOpacity(0);
    circle.setColor(color);
    add(circle);
    circle.layer = 11;
