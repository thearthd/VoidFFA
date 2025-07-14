// js/ui.js

import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { sendChatMessage } from "./network.js"; // Assuming sendChatMessage is in network.js
import { AnimatedTracer } from "./weapons.js"; // Assuming AnimatedTracer is in weapons.js


// Global variable to hold the Firebase database references for UI operations
let uiDbRefs = null;

/**
 * Sets the Firebase database references for UI operations.
 * This function should be called once from a main initialization point
 * (e.g., from network.js after it has initialized the Firebase app).
 * @param {object} dbRefsObject - The object containing all database references
 * (e.g., playersRef, chatRef, mapStateRef, etc.)
 */
export function setUIDbRefs(dbRefsObject) {
    uiDbRefs = dbRefsObject;
    console.log("uiDbRefs set:", uiDbRefs); // Confirm it's set
}

/* —————————————————————————————————————————————————————————————————————
    GAME UI ELEMENTS (dynamically created)
    ————————————————————————————————————————————————————————————————————— */

/**
 * Dynamically creates and appends all necessary in-game UI elements
 * to the provided game wrapper element.
 * Call this function from your `main.js` or `game.js` after the DOM is ready.
 * @param {HTMLElement} gameWrapper - The DOM element to append game UI to.
 */
export function createGameUI(gameWrapper) {
    if (!gameWrapper) {
        console.error("Game wrapper not found! Cannot create game UI elements.");
        return;
    }

    // Clear existing UI elements from gameWrapper to prevent duplicates on re-entry
    while (gameWrapper.firstChild) {
        gameWrapper.removeChild(gameWrapper.firstChild);
    }

    // --- Create and append Crosshair ---
    // The crosshair div is now part of the HTML directly, so we just ensure it's visible.
    // It's managed by game.js's updateCrosshair and visibility.

    // --- Create and append Scope Overlay ---
    // The scopeOverlay div is now part of the HTML directly.

    // --- Create and append Buy Menu ---
    // The buy-menu div is now part of the HTML directly.

    // --- Create and append HUD elements container ---
    // The hud div is now part of the HTML directly.
    const hud = document.getElementById('hud');
    if (!hud) {
        console.error("HUD element not found! Cannot append UI elements.");
        return;
    }
    // Ensure HUD is cleared too if it's reused
    while (hud.firstChild) {
        hud.removeChild(hud.firstChild);
    }

    // --- Append Kill Feed to HUD ---
    const killFeed = document.createElement('div'); // Changed to div as per HTML
    killFeed.id = 'kill-feed';
    hud.appendChild(killFeed);

    // --- Append Chat Box to HUD ---
    const chatBox = document.createElement('div'); // Changed to div as per HTML
    chatBox.id = 'chat-box';
    chatBox.innerHTML = `
        <div id="chat-messages"></div>
        <input type="text" id="chat-input" maxlength="100" placeholder="(` + '`' + `) to Chat | (C) to Open/Close" />
    `;
    hud.appendChild(chatBox);
    // Initial state: hidden, will be toggled by input.js
    chatBox.style.display = 'none'; // Initially hidden, as per your HTML style

    // --- Append Scoreboard to HUD ---
    const scoreboard = document.createElement('div');
    scoreboard.id = 'scoreboard';
    scoreboard.classList.add('hidden'); // Start hidden
    Object.assign(scoreboard.style, {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        backgroundColor: 'rgba(0,0,0,0.8)',
        color: 'white',
        padding: '20px',
        borderRadius: '8px',
        zIndex: '1000',
        minWidth: '300px',
        pointerEvents: 'auto', // Scoreboard should be interactive for scrolling
    });
    scoreboard.innerHTML = `
        <h3>Scoreboard</h3>
        <table id="score-table" style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr>
                    <th style="padding: 8px; border-bottom: 1px solid #444; text-align: left;">Player</th>
                    <th style="8px; border-bottom: 1px solid #444; text-align: left;">K</th>
                    <th style="padding: 8px; border-bottom: 1px solid #444; text-align: left;">D</th>
                    <th style="padding: 8px; border-bottom: 1px solid #444; text-align: left;">KS</th>
                </tr>
            </thead>
            <tbody></tbody>
        </table>
    `;
    hud.appendChild(scoreboard);


    // --- Append Inventory to HUD ---
    const inventory = document.createElement('div');
    inventory.id = 'inventory';
    Object.assign(inventory.style, {
        position: 'absolute',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: '5px',
        zIndex: '1000',
        pointerEvents: 'none', // Inventory elements should not block interaction
    });
    hud.appendChild(inventory); // Append to hud

    // --- Create and append Respawn Overlay ---
    // The respawn-overlay div is now part of the HTML directly.
    // It's managed by game.js's showRespawn/hideRespawn

    // --- Create and append Loading Progress ---
    // The loading-progress div is now part of the HTML directly.

    // --- Create and append Damage Overlay ---
    // The damage-overlay div is now part of the HTML directly.

    // --- Create and append Ammo Display ---
    const ammoDiv = document.createElement("div");
    ammoDiv.id = "ammo-display";
    Object.assign(ammoDiv.style, {
        position: "absolute",
        bottom: "20px",
        right: "20px",
        color: "white",
        fontSize: "1.2rem",
        fontFamily: "Arial, sans-serif",
        textShadow: "1px 1px 2px black",
        zIndex: "1000",
        pointerEvents: "none",
    });
    hud.appendChild(ammoDiv); // Append to hud, not gameWrapper

    // Initialize listeners for interactive UI elements
    initChatUI();
    initBuyMenuEvents();
    // Re-initialize respawn overlay as it's created dynamically in game.js
    // createRespawnOverlay(gameWrapper); // This is now done in game.js
}
/* —————————————————————————————————————————————————————————————————————
    HEALTH + SHIELD BAR (Three.js version – unchanged from your ui.js)
    ————————————————————————————————————————————————————————————————————— */
export function createHealthBar() {
    const width = 1.5;    // X size (horizontal length)
    const height = 0.2;  // Y size (vertical height of each bar)
    const depth = 0.05;  // Z size (thickness of each bar)

    const group = new THREE.Group();

    // ── 1) BACKGROUND BOX ──
    const bgGeom = new THREE.BoxGeometry(width, height, depth);
    const bgMat = new THREE.MeshBasicMaterial({
        color: 0x222222,
        side: THREE.DoubleSide,
    });
    const bgBox = new THREE.Mesh(bgGeom, bgMat);

    // ── 2) HEALTH BAR BOX ──
    const healthGeom = new THREE.BoxGeometry(width, height * 0.9, depth * 0.9);
    const healthMat = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        side: THREE.DoubleSide,
    });
    const healthBar = new THREE.Mesh(healthGeom, healthMat);
    healthBar.position.z = depth / 2 + (depth * 0.9) / 2 + 0.001;
    healthBar.position.y = 0;
    healthBar.scale.set(1, 1, 1);
    group.add(healthBar);

    // ── 3) SHIELD BAR BOX ──
    const shieldGeom = new THREE.BoxGeometry(width, height * 0.9, depth * 0.9);
    const shieldMat = new THREE.MeshBasicMaterial({
        color: 0x0000ff,
        side: THREE.DoubleSide,
    });
    const shieldBar = new THREE.Mesh(shieldGeom, shieldMat);
    shieldBar.position.z = depth / 2 + (depth * 0.9) / 2 + 0.001;
    const gap = 0.01;
    shieldBar.position.y = (height * 0.9) / 2 + (height * 0.9) / 2 + gap;
    shieldBar.scale.set(1, 1, 1);
    group.add(shieldBar);

    // ── 4) UPDATE FUNCTION ──
    return {
        group,
        update: function (hp, shield) {
            const fullWidth = width;

            // Health fraction (0 → 1)
            const hpFrac = Math.max(hp, 0) / 100;
            healthBar.scale.x = hpFrac;
            healthBar.position.x = -fullWidth / 2 + (hpFrac * fullWidth) / 2;

            // Shield fraction (0 → 1)
            const shieldFrac = Math.max(shield, 0) / 50;
            shieldBar.scale.x = shieldFrac;
            shieldBar.position.x = -fullWidth / 2 + (shieldFrac * fullWidth) / 2;
        },
    };
}

/* —————————————————————————————————————————————————————————————————————
    CHAT, KILLFEED, SCOREBOARD, RESPAWN, BUY MENU, INVENTORY, AMMO
    ————————————————————————————————————————————————————————————————————— */

// Chat UI: send on Enter (with 2-second cooldown)
export function initChatUI() {
    const chatInput = document.getElementById("chat-input");
    const chatBox = document.getElementById("chat-box"); // Reference to the full chat box
    let chatCooldown = false;

    // Toggle chat input visibility
    // This is now handled by input.js directly, but the event listener needs to be here
    // to ensure chatBox is correctly referenced.
    // The 'C' key logic is in input.js, which toggles 'display: none' for #chat-box.

    if (chatInput) {
        chatInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !chatCooldown) {
                const text = chatInput.value.trim().substring(0, 50);
                if (text.length > 0) {
                    const user = localStorage.getItem("username");
                    console.log("Sending chat message:", user, text); // Debugging
                    sendChatMessage(user, text);
                    chatInput.value = "";
                    chatCooldown = true;
                    setTimeout(() => (chatCooldown = false), 2000);
                }
                e.preventDefault(); // Prevent default Enter key behavior (e.g., submitting a form)
            }
        });
    }
}


export function addChatMessage(username, text, chatId) {
    const chatMessages = document.getElementById("chat-messages");
    if (!chatMessages) {
        console.error("Chat messages container not found! ID: 'chat-messages'");
        return;
    }

    const fullText = `${username}: ${text}`;

    function splitIntoParagraphs(input) {
        if (!/\s/.test(input) && input.length > 50) {
            const mid = Math.ceil(input.length / 2);
            return [
                input.slice(0, mid),
                input.slice(mid)
            ];
        }
        if (input.length <= 50) {
            return [input];
        }
        let splitPos = input.lastIndexOf(' ', 50);
        if (splitPos === -1) splitPos = 50;
        const first = input.slice(0, splitPos);
        const second = input.slice(splitPos + 1);
        return [first, second];
    }

    const wrapper = document.createElement('div');
    wrapper.dataset.chatId = chatId;
    wrapper.classList.add('chat-message');

    paragraphs.forEach(pText => {
        const p = document.createElement('p');
        p.textContent = pText;
        wrapper.appendChild(p);
    });

    chatMessages.appendChild(wrapper);

    // Enforce max 10 messages, removing oldest both in UI and in Firebase
    if (chatMessages.childElementCount > 10) {
        const oldest = chatMessages.firstElementChild;
        const oldId = oldest.dataset.chatId;
        if (oldest) { // Ensure oldest exists before removing
            chatMessages.removeChild(oldest);
            // Check if uiDbRefs and chatRef are available before attempting to remove from Firebase
            if (uiDbRefs && uiDbRefs.chatRef) {
                uiDbRefs.chatRef.child(oldId).remove().catch(err => console.error("Failed to remove old chat message from Firebase:", err));
            } else {
                console.warn("uiDbRefs or chatRef not available for pruning old chat messages.");
            }
        }
    }
    chatMessages.scrollTop = chatMessages.scrollHeight; // Scroll to bottom
}

export function updateKillFeed(killer, victim, weapon, killId) {
    const killFeed = document.getElementById("kill-feed");
    if (!killFeed) {
        console.error("Kill feed container not found! ID: 'kill-feed'");
        return;
    }

    const killEntry = document.createElement("div");
    killEntry.dataset.killId = killId;
    killEntry.textContent = `${killer} killed ${victim} with ${weapon}`;
    killEntry.style.opacity = "0"; // Start invisible for fade-in
    killEntry.style.transition = "opacity 0.5s ease-in";
    killFeed.appendChild(killEntry);

    // Trigger fade-in
    setTimeout(() => {
        killEntry.style.opacity = "1";
    }, 10); // Small delay to ensure transition applies

    // Fade out and remove after 5 seconds
    setTimeout(() => {
        killEntry.style.transition = "opacity 1s ease-out";
        killEntry.style.opacity = "0";
        killEntry.addEventListener("transitionend", () => {
            if (killEntry.parentNode) {
                killFeed.removeChild(killEntry);
            }
        });
    }, 5000); // 5 seconds display time

    // Enforce max 5 kill feed entries
    while (killFeed.childElementCount > 5) {
        const oldest = killFeed.firstElementChild;
        if (oldest) {
            killFeed.removeChild(oldest);
        }
    }
}

export function updateScoreboard(playersRef) {
    const scoreboardBody = document.getElementById("score-table")?.querySelector("tbody");
    if (!scoreboardBody) {
        console.error("Scoreboard body not found!");
        return;
    }

    playersRef.once("value", (snapshot) => {
        const players = [];
        snapshot.forEach((snap) => {
            const d = snap.val();
            if (d && d.username) {
                players.push({
                    name: d.username,
                    kills: d.kills || 0,
                    deaths: d.deaths || 0,
                    ks: d.ks || 0,
                    id: d.id // Include player ID
                });
            }
        });
        players.sort((a, b) => b.kills - a.kills || b.ks - a.ks); // Sort by kills, then killstreak

        scoreboardBody.innerHTML = ""; // Clear existing rows
        if (players.length === 0) {
            const row = document.createElement("tr");
            row.innerHTML = `<td colspan="4" style="text-align: center;">No players in game</td>`;
            scoreboardBody.appendChild(row);
        } else {
            players.forEach((p) => {
                const row = document.createElement("tr");
                // Highlight local player
                if (window.localPlayer && p.id === window.localPlayer.id) {
                    row.style.backgroundColor = "rgba(0, 255, 0, 0.2)"; // Light green highlight
                }
                row.innerHTML = `
                    <td style="padding: 8px; border-bottom: 1px solid #444; text-align: left;">${p.name}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #444; text-align: left;">${p.kills}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #444; text-align: left;">${p.deaths}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #444; text-align: left;">${p.ks}</td>
                `;
                scoreboardBody.appendChild(row);
            });
        }
    });
}


export function updateHealthShieldUI(health, shield) {
    const healthBarFill = document.getElementById("health-bar-fill");
    const shieldBarFill = document.getElementById("shield-bar-fill");

    if (healthBarFill) {
        healthBarFill.style.width = `${Math.max(0, health)}%`;
        healthBarFill.style.backgroundColor = health > 20 ? "#0f0" : "#f00"; // Green for high, red for low
    }
    if (shieldBarFill) {
        shieldBarFill.style.width = `${Math.max(0, shield * 2)}%`; // Assuming 50 shield max, so 100% width for 50 shield
        shieldBarFill.style.backgroundColor = "#00f"; // Blue for shield
    }
}

export function initInventory(initialWeaponKey) {
    const inventoryContainer = document.getElementById("inventory");
    if (!inventoryContainer) {
        console.error("Inventory container not found!");
        return;
    }

    // Clear existing slots before re-initializing
    inventoryContainer.innerHTML = '';

    const weaponOrder = ["knife", "deagle", "ak-47", "marshal"]; // Define the order

    weaponOrder.forEach((weaponKey, index) => {
        const slot = document.createElement("div");
        slot.classList.add("inventory-slot");
        slot.dataset.weapon = weaponKey;
        slot.textContent = `${index + 1}: ${weaponKey.toUpperCase()}`; // Display number and name

        // Add click listener for weapon switching (only if not pointer-events: none)
        slot.addEventListener('click', () => {
            // Dispatch a custom event that game.js can listen to for weapon switching
            window.dispatchEvent(new CustomEvent('buyWeapon', { detail: weaponKey }));
        });

        inventoryContainer.appendChild(slot);
    });

    // Set initial selection
    updateInventory(initialWeaponKey);
}

export function updateInventory(currentWeaponKey) {
    const slots = document.querySelectorAll(".inventory-slot");
    slots.forEach(slot => {
        if (slot.dataset.weapon === currentWeaponKey) {
            slot.classList.add("selected");
        } else {
            slot.classList.remove("selected");
        }
    });
}

export function initAmmoDisplay(initialWeaponKey, maxAmmo) {
    const ammoDisplay = document.getElementById("ammo-display");
    if (ammoDisplay) {
        ammoDisplay.textContent = `${maxAmmo}/${maxAmmo}`; // Initial display
    }
}

export function updateAmmoDisplay(currentAmmo, maxAmmo) {
    const ammoDisplay = document.getElementById("ammo-display");
    if (ammoDisplay) {
        ammoDisplay.textContent = `${currentAmmo}/${maxAmmo}`;
    }
}

// Bullet Holes
const bulletHoleMeshes = {}; // Store references to bullet hole meshes

export function initBulletHoles() {
    // This function is now mainly a placeholder.
    // The actual Firebase listener for bullet holes is in network.js,
    // which calls addBulletHole and removeBulletHole in this ui.js.
    console.log("Bullet hole UI initialized. Listening for Firebase events.");
}

export function removeTracer(key) {
    const line = activeTracers[key];
    if (!line) return;

    if (line.parent) window.scene.remove(line);
    if (line.geometry) line.geometry.dispose();
    if (line.material) line.material.dispose();

    delete activeTracers[key];
}

export function addBulletHole(holeData, holeId) {
    if (!window.scene) {
        console.warn("Cannot add bullet hole: Three.js scene not available.");
        return;
    }

    // Create a small cylinder or plane for the bullet hole
    const geometry = new THREE.CylinderGeometry(0.02, 0.02, 0.001, 8); // Small flat cylinder
    const material = new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 1 }); // Dark grey

    const bulletHoleMesh = new THREE.Mesh(geometry, material);
    bulletHoleMesh.position.set(holeData.x, holeData.y, holeData.z);

    // Orient the bullet hole to face away from the normal (nx, ny, nz)
    // The normal indicates the direction the surface is facing.
    // We want the bullet hole to lie flat on that surface.
    // The cylinder's default orientation is along the Y-axis.
    // We need to rotate it so its Y-axis aligns with the surface normal.
    const normal = new THREE.Vector3(holeData.nx, holeData.ny, holeData.nz);
    const upVector = new THREE.Vector3(0, 1, 0); // Default cylinder 'up'
    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(upVector, normal);
    bulletHoleMesh.applyQuaternion(quaternion);

    // Slightly offset the bullet hole along its normal to avoid z-fighting
    bulletHoleMesh.position.addScaledVector(normal, 0.001); // Small offset

    bulletHoleMesh.userData.holeId = holeId; // Store ID for removal
    window.scene.add(bulletHoleMesh);
    bulletHoleMeshes[holeId] = bulletHoleMesh;

    // Fade out over time
    const fadeDuration = 4000; // 4 seconds fade out
    const fadeStart = Date.now();

    function animateFade() {
        const elapsed = Date.now() - fadeStart;
        if (elapsed < fadeDuration) {
            const opacity = 1 - (elapsed / fadeDuration);
            bulletHoleMesh.material.opacity = opacity;
            if (bulletHoleMeshes[holeId]) { // Ensure it still exists before requesting next frame
                requestAnimationFrame(animateFade);
            }
        } else {
            // Fully faded, remove it
            removeBulletHole(holeId);
        }
    }
    animateFade(); // Start fading
}

export function removeBulletHole(holeId) {
    const mesh = bulletHoleMeshes[holeId];
    if (mesh && mesh.parent) {
        mesh.parent.remove(mesh);
        mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
            mesh.material.forEach(m => m.dispose());
        } else {
            mesh.material.dispose();
        }
        delete bulletHoleMeshes[holeId];
        // console.log(`Bullet hole ${holeId} removed and disposed.`);
    }
}


export function createTracer(start, end, tracerId) {
    if (!window.scene) {
        console.warn("Cannot create tracer: Three.js scene not available.");
        return;
    }
    const tracer = new AnimatedTracer(start, end, window.scene, tracerId);
    // AnimatedTracer manages its own addition/removal from scene
    return tracer;
}


function initBuyMenuEvents() {
    const buyMenu = document.getElementById("buy-menu");
    const buyDeagleBtn = document.getElementById("buy-deagle");
    const buyAk47Btn = document.getElementById("buy-ak47");
    const buyArmorBtn = document.getElementById("buy-armor");

    if (buyMenu) {
        // Initially hide the buy menu as per HTML
        buyMenu.style.display = 'none';
    }

    if (buyDeagleBtn) {
        buyDeagleBtn.addEventListener('click', () => {
            window.dispatchEvent(new CustomEvent('buyWeapon', { detail: 'deagle' }));
            buyMenu.style.display = 'none'; // Hide menu after purchase
        });
    }
    if (buyAk47Btn) {
        buyAk47Btn.addEventListener('click', () => {
            window.dispatchEvent(new CustomEvent('buyWeapon', { detail: 'ak-47' }));
            buyMenu.style.display = 'none'; // Hide menu after purchase
        });
    }
    if (buyArmorBtn) {
        buyArmorBtn.addEventListener('click', () => {
            // Logic for buying armor (e.g., dispatch an event for game.js to handle)
            console.log("Buy Armor clicked!");
            buyMenu.style.display = 'none'; // Hide menu after purchase
        });
    }

    // Toggle buy menu visibility with 'B' key (or whatever key you choose)
    document.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'b' && document.activeElement !== document.getElementById('chat-input')) {
            if (buyMenu.style.display === 'none') {
                buyMenu.style.display = 'block'; // Show if hidden
            } else {
                buyMenu.style.display = 'none'; // Hide if visible
            }
        }
    });
}

// Initial call to set up buy menu events
document.addEventListener('DOMContentLoaded', initBuyMenuEvents);
