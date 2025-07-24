// js/ui.js

import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { sendChatMessage } from "./network.js";
import { AnimatedTracer } from "./weapons.js";


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

    // --- Create and append Crosshair ---
    const crosshair = document.createElement('crosshair');
    crosshair.style.display = 'block'; // Or 'none' if dynamically shown
    gameWrapper.appendChild(crosshair);

    // --- Create and append Scope Overlay ---
    const scopeOverlay = document.createElement('div');
    scopeOverlay.id = 'scopeOverlay';
    scopeOverlay.innerHTML = `
        <div class="reticle">
            <div class="circle"></div>
            <div class="line horizontal left"></div>
            <div class="line horizontal right"></div>
            <div class="line vertical up"></div>
            <div class="line vertical down"></div>
        </div>
    `;
    gameWrapper.appendChild(scopeOverlay);

    // --- Create and append Buy Menu ---
    const buyMenu = document.createElement('div');
    buyMenu.id = 'buy-menu';
    buyMenu.classList.add('hidden'); // Start hidden
    buyMenu.innerHTML = `
        <h2>Buy Menu (FREE)</h2>
        <button id="buy-deagle">Get Deagle</button>
        <button id="buy-ak">Get AK-47</button>
        <button id="close-buy">Close</button>
    `;
    gameWrapper.appendChild(buyMenu);

    // --- Create and append HUD elements container ---
    const hud = document.createElement('div');
    hud.id = 'hud';
    Object.assign(hud.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none', // Allow clicks to pass through by default
        zIndex: '500',
    });
    gameWrapper.appendChild(hud);

    // --- Append Kill Feed to HUD ---
    const killFeed = document.createElement('kill-feed');
    hud.appendChild(killFeed);

    // --- Append Chat Box to HUD ---
    const chatBox = document.createElement('chat-box');
    hud.appendChild(chatBox);


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

    // --- Create and append Health and Shield Display to HUD ---
    const healthShieldDisplay = document.createElement('div');
    healthShieldDisplay.id = 'health-shield-display';
    Object.assign(healthShieldDisplay.style, {
        position: 'absolute',
        bottom: '60px', // Positioned above inventory, adjust as needed
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start', // Align items to the start for bars
        zIndex: '1000',
        pointerEvents: 'none',
        color: 'white',
        fontFamily: 'Arial, sans-serif',
        textShadow: '1px 1px 2px black',
    });

    // Reverted to original bar structure
    healthShieldDisplay.innerHTML = `
        <div style="display: flex; align-items: center; margin-bottom: 5px;">
            <span style="margin-right: 5px;">HP:</span>
            <div style="width: 100px; height: 15px; background-color: #555; border-radius: 3px; overflow: hidden; position: relative;">
                <div id="health-bar-fill" style="height: 100%; width: 100%; background-color: #0f0; transition: width 0.1s linear;"></div>
            </div>
            <span id="health-text" style="margin-left: 5px;">100 / 100</span>
        </div>
        <div style="display: flex; align-items: center;">
            <span style="margin-right: 5px;">SHIELD:</span>
            <div style="width: 100px; height: 15px; background-color: #555; border-radius: 3px; overflow: hidden; position: relative;">
                <div id="shield-bar-fill" style="height: 100%; width: 100%; background-color: #00f; transition: width 0.1s linear;"></div>
            </div>
            <span id="shield-text" style="margin-left: 5px;">50 / 50</span>
        </div>
    `;
    hud.appendChild(healthShieldDisplay);

    // --- Create and append Ammo Display to HUD ---
    const ammoDiv = document.createElement("div");
    ammoDiv.id = "ammo-display";
    Object.assign(ammoDiv.style, {
        position: "absolute",
        bottom: "20px", // Same bottom as inventory to be on its right
        // Left positioning will be relative to inventory
        color: "white",
        fontSize: "1.2rem",
        fontFamily: "Arial, sans-serif",
        textShadow: "1px 1px 2px black",
        zIndex: "1000",
        pointerEvents: "none",
        // Added some padding/background for clarity
        padding: '5px 10px',
        backgroundColor: 'rgba(0,0,0,0.5)',
        borderRadius: '5px'
    });
    hud.appendChild(ammoDiv); // Append to hud


    // Initialize listeners for interactive UI elements
    initChatUI();
    initBuyMenuEvents();
}
/* —————————————————————————————————————————————————————————————————————
    HEALTH + SHIELD BAR (Three.js version – unchanged from your ui.js)
    ————————————————————————————————————————————————————————————————————— */
export function createHealthBar() {
    const width = 1.5;     // X size (horizontal length)
    const height = 0.2;  // Y size (vertical height of each bar)
    const depth = 0.05;  // Z size (thickness of each bar)

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

    const paragraphs = splitIntoParagraphs(fullText);

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
                console.warn("Firebase chat reference not initialized in UI for pruning. Chat message not removed from Firebase.");
            }
        }
    }

    chatMessages.scrollTop = chatMessages.scrollHeight;
}


// Kill Feed: show last 5 entries
export function updateKillFeed(killer, victim, weapon, killId) {
    const feed = document.getElementById("kill-feed");
    if (!feed) {
        console.error("Kill feed container not found! ID: 'kill-feed'");
        return;
    }

    // 1) Create & append the new entry
    const entry = document.createElement("div");
    entry.textContent = `${killer} → ${victim} [${weapon}]`;
    entry.dataset.killId = killId;
    feed.appendChild(entry);

    // 2) If this pushes us over 5 entries, remove the oldest immediately
    if (feed.children.length > 5) {
        const oldest = feed.firstElementChild;
        const oldId = oldest.dataset.killId;
        if (oldest) { // Ensure oldest exists before removing
            oldest.remove();         // remove from UI
            // Check if uiDbRefs and killsRef are available before attempting to remove from Firebase
            if (uiDbRefs && uiDbRefs.killsRef) {
                uiDbRefs.killsRef.child(oldId).remove().catch(err => console.error("Failed to remove old kill entry from Firebase:", err)); // remove from Firebase
            } else {
                console.warn("Firebase kills reference not initialized in UI for pruning. Kill entry not removed from Firebase.");
            }
        }
    }

    // 3) Still auto-expire this entry after 10 seconds if it's still present
    setTimeout(() => {
        if (entry.parentNode) { // Check if it's still in the DOM
            entry.remove();
            // Check if uiDbRefs and killsRef are available before attempting to remove from Firebase
            if (uiDbRefs && uiDbRefs.killsRef) {
                uiDbRefs.killsRef.child(killId).remove().catch(err => console.error("Failed to remove timed-out kill entry from Firebase:", err));
            } else {
                console.warn("Firebase kills reference not initialized in UI for removal. Kill entry not removed from Firebase.");
            }
        }
    }, 10000);
}

// Scoreboard: populate with players’ username, kills, deaths, ks
export function updateScoreboard(dbRefPlayers) {
    const tbody = document.querySelector("#score-table tbody");
    if (!tbody) {
        console.error("Scoreboard table body not found! Selector: '#score-table tbody'");
        return;
    }
    tbody.innerHTML = "";
    // dbRefPlayers is already passed correctly from network.js
    dbRefPlayers.once("value", (snapshot) => {
        snapshot.forEach((child) => {
            const data = child.val();
            const row = document.createElement("tr");
            row.innerHTML = `<td>${data.username}</td><td>${data.kills}</td><td>${data.deaths}</td><td>${data.ks}</td>`;
            tbody.appendChild(row);
        });
    }).catch(err => console.error("Failed to update scoreboard:", err));
}

// Show/hide scoreboard with custom events
document.addEventListener("showScoreboard", () => {
    document.getElementById("scoreboard")?.classList.remove("hidden");
});
document.addEventListener("hideScoreboard", () => {
    document.getElementById("scoreboard")?.classList.add("hidden");
});

// Buy Menu & Buttons
function initBuyMenuEvents() {
    document.addEventListener("toggleBuy", () => {
        const buyMenu = document.getElementById("buy-menu");
        buyMenu?.classList.toggle("hidden");
        // Ensure pointer events are re-enabled when visible
        if (buyMenu && !buyMenu.classList.contains('hidden')) {
            buyMenu.style.pointerEvents = 'auto';
        } else if (buyMenu) {
            buyMenu.style.pointerEvents = 'none';
        }
    });

    document.getElementById("buy-deagle")?.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("buyWeapon", { detail: "deagle" }));
        document.getElementById("buy-menu")?.classList.add("hidden");
    });

    document.getElementById("buy-ak")?.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("buyWeapon", { detail: "ak-47" }));
        document.getElementById("buy-menu")?.classList.add("hidden");
    });

    document.getElementById("close-buy")?.addEventListener("click", () => {
        document.getElementById("buy-menu")?.classList.add("hidden");
    });
}

// Respawn UI
// ----------------------------

// Create the respawn overlay element (hidden by default)
export function createRespawnOverlay(parentEl) {
    const existing = document.getElementById("respawn-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "respawn-overlay";
    overlay.classList.add("hidden");
    Object.assign(overlay.style, {
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        zIndex: "1000",
        fontFamily: "Arial, sans-serif",
        color: "white",
        pointerEvents: 'none', // By default, not interactive when hidden
    });

    const deathMsg = document.createElement("div");
    deathMsg.textContent = "You Died";
    deathMsg.style.fontSize = "48px";
    deathMsg.style.marginBottom = "20px";
    overlay.appendChild(deathMsg);

    const promptMsg = document.createElement("div");
    promptMsg.id = "respawn-prompt";
    promptMsg.textContent = "Press SPACE to respawn";
    promptMsg.style.fontSize = "24px";
    overlay.appendChild(promptMsg);

    const respawnBtn = document.createElement("button");
    respawnBtn.id = "respawn-btn";
    respawnBtn.textContent = "Respawn Now";
    Object.assign(respawnBtn.style, {
        padding: '10px 20px',
        fontSize: '18px',
        backgroundColor: '#6a0dad',
        color: 'white',
        border: 'none',
        borderRadius: '5px',
        cursor: 'pointer',
        marginTop: '15px',
    });
    respawnBtn.addEventListener('click', () => {
        hideRespawn();
        if (typeof window.respawnPlayer === "function") {
            window.respawnPlayer();
        }
    });
    overlay.appendChild(respawnBtn);


    parentEl.appendChild(overlay); // Append to the gameWrapper
}

// Show the respawn overlay
export function showRespawn() {
    const overlay = document.getElementById("respawn-overlay");
    if (overlay) {
        overlay.classList.remove("hidden");
        overlay.style.pointerEvents = 'auto'; // Make it interactive
    }
}

// Hide the respawn overlay
export function hideRespawn() {
    const overlay = document.getElementById("respawn-overlay");
    if (overlay) {
        overlay.classList.add("hidden");
        overlay.style.pointerEvents = 'none'; // Make it non-interactive
    }
}

const DEFAULT_PRIMARY = 'ak-47';
const DEFAULT_SECONDARY = 'm79';

/* —————————————————————————————————————————————————————————————————————
    INVENTORY + HEALTH & SHIELD BARS (HTML version)
    ————————————————————————————————————————————————————————————————————— */
function getSavedLoadout() {
    return {
        primary: localStorage.getItem('loadout_primary') || DEFAULT_PRIMARY,
        secondary: localStorage.getItem('loadout_secondary') || DEFAULT_SECONDARY,
    };
}

export function initInventory(currentWeaponKey) {
    const inv = document.getElementById("inventory");
    if (!inv) return;
    inv.innerHTML = "";

    const parent = inv.parentNode;
    if (getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative';
    }

    const { primary, secondary } = getSavedLoadout();
    const weaponKeys = ['knife'];
    if (primary) weaponKeys.push(primary);
    if (secondary) weaponKeys.push(secondary);

    for (const key of weaponKeys) {
        const slot = document.createElement("div");
        slot.classList.add("inventory-slot");
        slot.id = `inv-${key}`;
        Object.assign(slot.style, {
            backgroundColor: '#333',
            color: '#fff',
            padding: '8px 12px',
            border: '1px solid #555',
            borderRadius: '4px',
            cursor: 'pointer',
            transition: 'background-color 0.2s, border-color 0.2s',
            pointerEvents: 'auto',
        });
        const nameAbbrev = document.createElement("span");
        switch (key) {
            case "knife": nameAbbrev.textContent = "KNIFE"; break;
            case "deagle": nameAbbrev.textContent = "DEAG"; break;
            case "ak-47": nameAbbrev.textContent = "AK47"; break;
            case "marshal": nameAbbrev.textContent = "MARL"; break;
            case "m79": nameAbbrev.textContent = "M79"; break;
        }
        slot.appendChild(nameAbbrev);
        if (key === currentWeaponKey) {
            slot.classList.add("selected");
            slot.style.borderColor = '#0f0';
            slot.style.backgroundColor = '#444';
        }
        inv.appendChild(slot);
    }
}


export function updateInventory(currentWeaponKey) {
    const slots = document.querySelectorAll(".inventory-slot");
    slots.forEach((s) => {
        s.classList.remove("selected");
        s.style.borderColor = '#555'; // Reset border color
        s.style.backgroundColor = '#333'; // Reset background color
    });
    const currentSlot = document.getElementById(`inv-${currentWeaponKey}`);
    if (currentSlot) {
        currentSlot.classList.add("selected");
        currentSlot.style.borderColor = '#0f0'; // Highlight selected
        currentSlot.style.backgroundColor = '#444';
    }
}

let lastValidHp = 100;
let lastValidShield = 50;

export function updateHealthShieldUI(hp, shield) {
    const validHp = typeof hp === 'number' && !Number.isNaN(hp);
    const validShield = typeof shield === 'number' && !Number.isNaN(shield);

    const rawHp = validHp ? hp : lastValidHp;
    const rawShield = validShield ? shield : lastValidShield;

    const clampedHp = Math.max(0, Math.min(rawHp, 100));
    const clampedShield = Math.max(0, Math.min(rawShield, 50));

    lastValidHp = clampedHp;
    lastValidShield = clampedShield;

    const healthFrac = clampedHp / 100;
    const shieldFrac = clampedShield / 50;

    const healthFill = document.getElementById("health-bar-fill");
    const healthText = document.getElementById("health-text");
    if (healthFill) {
        healthFill.style.width = `${healthFrac * 100}%`;
    }
    if (healthText) {
        healthText.textContent = `${clampedHp} / 100`;
    }

    const shieldFill = document.getElementById("shield-bar-fill");
    const shieldText = document.getElementById("shield-text");
    if (shieldFill) {
        shieldFill.style.width = `${shieldFrac * 100}%`;
    }
    if (shieldText) {
        shieldText.textContent = `${clampedShield} / 50`;
    }
}

const activeTracers = {};
const bulletHoles = {}; // Keep this map to track active bullet hole meshes

/* —————————————————————————————————————————————————————————————————————
    BULLET TRACERS & HOLES (updated to export add/remove functions)
    ————————————————————————————————————————————————————————————————————— */

export function createTracer(fromVec, toVec, weaponKey) {
    if (!window.scene) {
        console.warn("UI: window.scene not set, cannot create tracer.");
        return;
    }

    const dist = fromVec.distanceTo(toVec);
    if (dist < 0.001) {
        console.warn("⚠️ Tracer distance is extremely small—skipping draw.");
        return;
    }

    // Pass the weaponKey to AnimatedTracer
    new AnimatedTracer(fromVec, toVec, 250, weaponKey);
}

export function removeTracer(key) {
    const line = activeTracers[key];
    if (!line) return;

    if (line.parent) window.scene.remove(line);
    if (line.geometry) line.geometry.dispose();
    if (line.material) line.material.dispose();

    delete activeTracers[key];
}

// Exported function to add a bullet hole (logic moved from initBulletHoles's event listener)
export function addBulletHole(holeData, firebaseKey) {
    // Rely on window.scene existing
    if (!window.scene) {
        console.warn("UI: window.scene not set, cannot add bullet hole.");
        return;
    }
    // Prevent adding duplicates if somehow triggered multiple times for the same key
    if (bulletHoles[firebaseKey]) return;

    const { x, y, z, nx, ny, nz, timeCreated } = holeData;

    const holeGeom = new THREE.CircleGeometry(0.15, 16);
    const holeMat = new THREE.MeshBasicMaterial({
        color: 0x111111,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
    });
    const hole = new THREE.Mesh(holeGeom, holeMat);
    hole.position.set(x, y, z); // Set position directly from data

    // Orient the bullet hole to face along its normal
    const normal = new THREE.Vector3(nx, ny, nz);
    hole.lookAt(new THREE.Vector3().addVectors(hole.position, normal));

    // Offset slightly along the normal to prevent Z-fighting with map geometry
    hole.position.addScaledVector(normal, 0.001);

    window.scene.add(hole);
    bulletHoles[firebaseKey] = hole;

    // Local visual fade out for bullet holes
    const fadeDuration = 5; // seconds
    // Calculate how much time has already passed since creation (for existing holes fetched on join)
    const age = (Date.now() - timeCreated) / 1000;
    const startTime = performance.now() / 1000 - age; // Adjust start time based on age

    const animateFade = () => {
        // Only proceed if the hole still exists in our local tracking and scene
        if (!bulletHoles[firebaseKey] || !hole.parent) return;

        const now = performance.now() / 1000;
        const elapsed = now - startTime;
        if (elapsed >= fadeDuration) {
            // Ensure removal and cleanup if fade is complete
            if (hole.parent) window.scene.remove(hole);
            hole.geometry.dispose();
            hole.material.dispose();
            delete bulletHoles[firebaseKey];
        } else {
            // Apply opacity based on elapsed time
            hole.material.opacity = THREE.MathUtils.lerp(0.8, 0, elapsed / fadeDuration);
            requestAnimationFrame(animateFade);
        }
    };
    requestAnimationFrame(animateFade);
}

// Exported function to remove a bullet hole (logic moved from initBulletHoles's event listener)
export function removeBulletHole(firebaseKey) {
    const hole = bulletHoles[firebaseKey];
    if (hole) {
        if (hole.parent) window.scene.remove(hole);
        hole.geometry.dispose();
        hole.material.dispose();
        delete bulletHoles[firebaseKey];
    }
}

// initBulletHoles no longer needs to listen for custom events, as network.js will call functions directly.
// It can be removed or repurposed if there are other initialization needs for bullet holes.
// For now, it will simply log a message.
export function initBulletHoles() {
    console.log("UI: initBulletHoles called. Direct calls from network.js for add/remove expected.");
}


/* —————————————————————————————————————————————————————————————————————
    AMMO DISPLAY (unchanged)
    ————————————————————————————————————————————————————————————————————— */
let ammoDiv = null;
export function initAmmoDisplay(weaponKey, maxAmmo) {
    ammoDiv = document.getElementById("ammo-display");
    if (!ammoDiv) {
        console.warn("Ammo display div not found after UI creation.");
        return;
    }
    // Only display numbers
    ammoDiv.innerText = `${maxAmmo} / ${maxAmmo}`;
    // Position it to the right of the inventory
    positionAmmoDisplay();
}

export function updateAmmoDisplay(currentAmmo, maxAmmo) {
    if (!ammoDiv) return;
    // Only display numbers
    ammoDiv.innerText = `${currentAmmo} / ${maxAmmo}`;
    // Re-position in case inventory shifts (though unlikely in real-time)
    positionAmmoDisplay();
}

function positionAmmoDisplay() {
    const inventory = document.getElementById('inventory');
    const ammoDisplay = document.getElementById('ammo-display');
    if (inventory && ammoDisplay) {
        const invRect = inventory.getBoundingClientRect();
        // Calculate position based on inventory's right edge + a small gap
        ammoDisplay.style.left = `${invRect.right + 10}px`; // 10px gap
        ammoDisplay.style.transform = `translateX(0)`; // Remove transform if it was centered
    }
}
