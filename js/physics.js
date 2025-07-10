import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { OctreeV2 } from './OctreeV2.js';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import { Octree } from 'three/examples/jsm/math/Octree.js';
// Uncomment for debugging:
// import { OctreeHelper } from 'three/examples/jsm/helpers/OctreeHelper.js';

import { sendSoundEvent } from "./network.js";

// seamless audio-loop helper (UNCHANGED)
function createSeamlessLoop(src, leadTimeMs = 50, volume = 1) {
    let timerId = null, currentAudio = null;
    function scheduleNext() {
        const durationMs = currentAudio.duration * 1000;
        const delay = Math.max(durationMs - leadTimeMs, 0);
        timerId = setTimeout(() => {
            if (currentAudio) currentAudio.removeEventListener('ended', scheduleNext);
            currentAudio = new Audio(src);
            currentAudio.volume = volume;
            currentAudio.addEventListener('ended', scheduleNext);
            currentAudio.play().catch(() => { });
        }, delay);
    }
    return {
        start() {
            this.stop();
            currentAudio = new Audio(src);
            currentAudio.volume = volume;
            currentAudio.addEventListener('ended', scheduleNext);
            currentAudio.play().catch(console.error).then(scheduleNext).catch(console.error); // Added catch for play().then()
        },
        stop() {
            clearTimeout(timerId);
            timerId = null;
            if (currentAudio) {
                currentAudio.pause();
                currentAudio.currentTime = 0;
                currentAudio.removeEventListener('ended', scheduleNext);
                currentAudio = null;
            }
        }
    };
}

// --- NEW HELPER FUNCTION FOR DOWNLOADING JSON ---
/**
 * Initiates a file download of JSON data in the browser.
 * @param {Object} data - The JavaScript object to be stringified and downloaded.
 * @param {string} filename - The name of the file to download (e.g., 'octree_data.json').
 */
function downloadJSON(data, filename) {
    if (!data) {
        console.error("No data provided for download.");
        return;
    }
    try {
        // This is the point where the RangeError might still occur if the 'data' object
        // itself is too large to be stringified into a single JavaScript string in memory.
        const jsonString = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url); // Clean up the URL object

        console.log(`Octree data download initiated for ${filename}`);
    } catch (e) {
        console.error("Error preparing Octree data for download:", e);
        if (e instanceof RangeError && e.message.includes("Invalid string length")) {
            console.error("The Octree data is too large to stringify into a single JavaScript string. Consider optimizing your Octree's data, or explore streaming/binary serialization if saving this large of data is critical.");
        }
    }
}
// --- END NEW HELPER FUNCTION ---

const PLAYER_MASS = 70;
const STAND_HEIGHT = 2.2;
const CROUCH_HEIGHT = 1.0;
const COLLIDER_RADIUS = 0.35;
const JUMP_VELOCITY = 12.3;

const GRAVITY = 27.5; // Increased gravity for more decisive falling

const CROUCH_SPEED = 8;
const FOOT_DISABLED_THRESHOLD = 0.2; // Keep as is, or slightly increase if footsteps play when perfectly still

const PLAYER_ACCEL_GROUND = 25;
const PLAYER_ACCEL_AIR = 8;
const MAX_SPEED = 10; // New constant for maximum horizontal speed

// Vector helpers to avoid re-allocations
const _vector1 = new THREE.Vector3();
const _vector2 = new THREE.Vector3();
const _vector3 = new THREE.Vector3();

export class PhysicsController {
    constructor(camera, scene) {
        this.camera = camera;
        this.scene = scene;

        this.playerCollider = new Capsule(
            new THREE.Vector3(0, COLLIDER_RADIUS, 0),
            new THREE.Vector3(0, STAND_HEIGHT - COLLIDER_RADIUS, 0),
            COLLIDER_RADIUS
        );
        
        this.playerVelocity = new THREE.Vector3();
        this.playerDirection = new THREE.Vector3();
        this.playerOnFloor = false;
        this.isGrounded = false; // More descriptive, often used for general ground checks

        this.worldOctree = new OctreeV2(); // Ensure this is OctreeV2

        this.mouseTime = 0;

        const container = document.getElementById('container') || document.body;
        container.addEventListener('mousedown', () => {
            document.body.requestPointerLock();
            this.mouseTime = performance.now();
        });

        this.camera.rotation.order = 'YXZ';

        this.footAudios = [
            new Audio("https://codehs.com/uploads/29c8a5da333b3fd36dc9681a4a8ec865"),
            new Audio("https://codehs.com/uploads/616ef1b61061008f9993d1ab4fa323ba")
        ];
        this.footAudios.forEach(audio => { audio.volume = 0.7; }); // Set volume
        this.footIndex = 0;
        this.footAcc = 0;
        this.baseFootInterval = 3;
        this.landAudio = new Audio("https://codehs.com/uploads/600ab769d99d74647db5468b19761f");
        this.landAudio.volume = 0.8; // Set volume
        this.fallStartY = null;
        this.prevGround = false;
        this.jumpTriggered = false; // ADDED: Flag to track if the last airborne state was due to a jump
        this.fallStartTimer = null; // ADDED: To manage delay for fallStartY

        this.speedModifier = 0;
        this.isAim = false;
        this.currentHeight = STAND_HEIGHT;
        this.targetHeight = STAND_HEIGHT;
        this.fallDelay = 300; // Half a second in milliseconds

        // Debugging Helpers (Optional, but highly recommended for collision issues)
        // Uncomment these to visualize the Octree and Player Capsule
        // this.octreeHelper = new OctreeHelper(this.worldOctree);
        // this.scene.add(this.octreeHelper);

        // const capsuleGeometry = new THREE.CapsuleGeometry(COLLIDER_RADIUS, STAND_HEIGHT - 2 * COLLIDER_RADIUS, 10, 20);
        // const capsuleMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true, transparent: true, opacity: 0.5 });
        // this.debugCapsuleMesh = new THREE.Mesh(capsuleGeometry, capsuleMaterial);
        // this.scene.add(this.debugCapsuleMesh);
    }

    /**
     * Builds the Octree from a Three.js group of meshes.
     * This method now triggers a download of the Octree data after successful build.
     * @param {THREE.Group} group - The Three.js group containing meshes to build the Octree from.
     * @param {Function} onProgress - Callback function for build progress updates ({loaded, total}).
     * @returns {Promise<OctreeV2>} A promise that resolves with the built OctreeV2 instance.
     */
    buildOctree(group, onProgress = () => {}) {
        return new Promise((resolve, reject) => {
            if (!group) {
                console.warn("Attempted to build Octree with no group provided.");
                onProgress({ loaded: 1, total: 1 });
                resolve();
                return;
            }

            console.log("Starting Octree build from group geometry...");

            let meshCount = 0;
            group.traverse((obj) => {
                if (obj.isMesh) {
                    meshCount++;
                }
            });
            console.log(`DEBUG: Group passed to Octree contains ${meshCount} meshes.`);

            if (this.worldOctree) {
                this.worldOctree.clear();
            } else {
                this.worldOctree = new OctreeV2();
            }

            this.worldOctree.fromGraphNode(group, ({ loaded, total }) => {
                onProgress({ loaded, total });
            }).then(() => {
                console.log("Octree built successfully.");
                
                // --- MODIFIED: Call downloadJSON instead of console.log ---
                try {
                    const octreeData = this.worldOctree.toJSON(); // Get the serializable plain JS object
                    console.log("Octree object prepared for serialization. Initiating download...");
                    downloadJSON(octreeData, 'world_octree.json'); // Trigger the download
                } catch (e) {
                    console.error("Error getting Octree data for serialization (likely toJSON issue):", e);
                }
                // --- END MODIFIED ---

                resolve(this.worldOctree); // Resolve with the built octree instance
            }).catch(err => {
                console.error("Error building Octree:", err);
                reject(err);
            });
        });
    }

    /**
     * Loads Octree data from a JSON string.
     * @param {string} jsonString - The JSON string representing the Octree data.
     * @returns {OctreeV2 | null} The reconstructed OctreeV2 instance, or null if an error occurs.
     */
    loadOctreeFromJson(jsonString) {
        try {
            const octreeData = JSON.parse(jsonString);
            this.worldOctree = OctreeV2.fromJSON(octreeData);
            console.log("Octree loaded from JSON successfully.");
            return this.worldOctree;
        } catch (e) {
            console.error("Error loading Octree from JSON:", e);
            return null;
        }
    }

    setSpeedModifier(value) {
        this.speedModifier = value;
    }

    playerCollisions() {
        const result = this.worldOctree.capsuleIntersect(this.playerCollider);

        // Reset each frame
        this.playerOnFloor = false;
        this.isGrounded = false;

        if (result) {
            const normal = result.normal;
            const depth = result.depth;

            // Floor if normal is “up” enough
            this.playerOnFloor = normal.y > 0.5;
            this.isGrounded = this.playerOnFloor;

            const SKIN = 0.02; // 2 cm
            if (depth > SKIN) {
                // translate out by (penetration – SKIN), so you stay SKIN above the surface
                this.playerCollider.translate(
                    _vector1.copy(normal).multiplyScalar(depth - SKIN)
                );
            }
            // Slide along walls / surfaces
            if (this.playerVelocity.dot(normal) < 0) {
                _vector2.copy(this.playerVelocity).projectOnPlane(normal);
                this.playerVelocity.copy(_vector2);
            }

            // Kill tiny downward drift when grounded
            if (this.playerOnFloor && Math.abs(this.playerVelocity.y) < 0.05) {
                this.playerVelocity.y = 0;
            }
        }
    }

    updatePlayer(deltaTime) {
        let damping = Math.exp(-4 * deltaTime) - 1; // Standard damping

        if (!this.playerOnFloor) {
            // Apply gravity
            this.playerVelocity.y -= GRAVITY * deltaTime;
            damping *= 0.1; // Less damping when in air
        } else {
            // When on floor, if there's residual downward velocity, it should be handled
            // by the collision response now, but as a fallback, ensure it's not sinking.
            if (this.playerVelocity.y < 0) {
                this.playerVelocity.y = 0;
            }
        }

        // Apply damping to horizontal velocity
        this.playerVelocity.x += this.playerVelocity.x * damping;
        this.playerVelocity.z += this.playerVelocity.z * damping;

        // **Apply MAX_SPEED to horizontal velocity**
        const horizontalSpeed = Math.sqrt(this.playerVelocity.x * this.playerVelocity.x + this.playerVelocity.z * this.playerVelocity.z);
        if (horizontalSpeed > MAX_SPEED) {
            const ratio = MAX_SPEED / horizontalSpeed;
            this.playerVelocity.x *= ratio;
            this.playerVelocity.z *= ratio;
        }

        const deltaPosition = _vector1.copy(this.playerVelocity).multiplyScalar(deltaTime);
        this.playerCollider.translate(deltaPosition);

        this.playerCollisions(); // Perform collisions after moving
    }

    getForwardVector() {
        this.camera.getWorldDirection(this.playerDirection);
        this.playerDirection.y = 0;
        this.playerDirection.normalize();
        return this.playerDirection;
    }

    getSideVector() {
        this.camera.getWorldDirection(this.playerDirection);
        this.playerDirection.y = 0;
        this.playerDirection.normalize();
        this.playerDirection.cross(this.camera.up);
        return this.playerDirection;
    }

    controls(deltaTime, input) {
        // Now using deltaTime directly for acceleration calculation
        const acceleration = this.playerOnFloor ? PLAYER_ACCEL_GROUND : PLAYER_ACCEL_AIR;

        // The speedModifier is applied directly to the acceleration for movement
        const effectiveAcceleration = acceleration * this.speedModifier * (input.crouch ? 0.3 : input.slow ? 0.5 : this.isAim ? 0.65 : 1);

        // Create a movement vector based on input
        const moveDirection = new THREE.Vector3();

        if (input.forward) {
            moveDirection.add(this.getForwardVector());
        }
        if (input.backward) {
            moveDirection.add(this.getForwardVector().multiplyScalar(-1));
        }
        if (input.left) {
            moveDirection.add(this.getSideVector().multiplyScalar(-1));
        }
        if (input.right) {
            moveDirection.add(this.getSideVector());
        }

        // Normalize the movement direction to prevent faster diagonal movement
        if (moveDirection.lengthSq() > 0) {
            moveDirection.normalize();
            // Apply acceleration based on the normalized direction and effective acceleration
            this.playerVelocity.add(moveDirection.multiplyScalar(effectiveAcceleration * deltaTime));
        }

        if (this.playerOnFloor) {
            if (input.jump) {
                this.playerVelocity.y = JUMP_VELOCITY;
                this.playerOnFloor = false; // Player is no longer on the floor after jumping
                this.isGrounded = false;
                this.jumpTriggered = true; // Set this flag when a jump is initiated
            }
        }

        // Crouch/Stand height transition
        const wantCrouch = input.crouch && this.isGrounded;
        const wantSlow = input.slow && this.isGrounded && !wantCrouch; // `wantSlow` is not directly used for height, but kept from original logic

        this.targetHeight = wantCrouch ? CROUCH_HEIGHT : STAND_HEIGHT;

        // Smoothly interpolate height
        this.currentHeight += (this.targetHeight - this.currentHeight) * Math.min(1, CROUCH_SPEED * deltaTime);

        // Adjust collider height based on currentHeight
        this.playerCollider.end.y = this.playerCollider.start.y + (this.currentHeight - 2 * COLLIDER_RADIUS);

        // If your debug capsule mesh is active, update its scale/position here
        // if (this.debugCapsuleMesh) {
        //  // Adjust geometry size for debug mesh (CapsuleGeometry takes radius, length)
        //  // Length of the cylinder part = total height - 2 * radius
        //  const capsuleLength = Math.max(0, this.currentHeight - 2 * COLLIDER_RADIUS);
        //  this.debugCapsuleMesh.geometry.dispose(); // Dispose old geometry
        //  this.debugCapsuleMesh.geometry = new THREE.CapsuleGeometry(COLLIDER_RADIUS, capsuleLength, 10, 20);
        //  // Position the mesh based on the collider's bottom point (start.y)
        //  this.debugCapsuleMesh.position.copy(this.playerCollider.start);
        //  this.debugCapsuleMesh.position.y += (COLLIDER_RADIUS + capsuleLength / 2); // Center the mesh on the capsule axis
        // }
    }

    teleportIfOob() {
        if (this.playerCollider.end.y < -30 || this.playerCollider.start.y < -30) {
            console.warn("Player OOB detected! Teleporting...");
            this.setPlayerPosition(new THREE.Vector3(0, 5, 0)); // Teleport to a safe, elevated position
            this.playerVelocity.set(0, 0, 0); // Clear velocity
            this.playerOnFloor = false;
            this.isGrounded = false;
            this.jumpTriggered = false; // Reset jump flag on teleport
            this.fallStartY = null; // Reset fall start Y on teleport
            clearTimeout(this.fallStartTimer); // Clear any pending fall start timer
            this.fallStartTimer = null;
        }
    }

    setPlayerPosition(position) {
        const spawnY = position.y + 0.1; // Add a small offset to ensure player is not stuck in ground initially

        this.playerCollider.start.set(position.x, spawnY, position.z);
        this.playerCollider.end.set(
            position.x,
            spawnY + (this.currentHeight - 2 * COLLIDER_RADIUS),
            position.z
        );
        this.playerCollider.radius = COLLIDER_RADIUS;

        this.playerVelocity.set(0, 0, 0);
        this.playerOnFloor = false;
        this.isGrounded = false;
        this.jumpTriggered = false; // Reset jump flag on setting position
        this.fallStartY = null; // Reset fall start Y on setting position
        clearTimeout(this.fallStartTimer); // Clear any pending fall start timer
        this.fallStartTimer = null;

        // Update camera position to match the new player collider position.
        // Camera eye level is typically slightly above the capsule's start.y.
        this.camera.position.copy(this.playerCollider.start);
        this.camera.position.y += (this.currentHeight * 0.9); // 90% of current height for eye level

        this.camera.rotation.set(0, 0, 0); // Optionally reset camera rotation
        console.log(`Player and camera teleported to: (${this.camera.position.x}, ${this.camera.position.y}, ${this.camera.position.z})`);
    }

    update(deltaTime, input) {
        deltaTime = Math.min(0.05, deltaTime); // Cap deltaTime to prevent "explosions"

        this.prevGround = this.isGrounded; // Store previous ground state

        const currentSpeedXZ = Math.sqrt(this.playerVelocity.x * this.playerVelocity.x + this.playerVelocity.z * this.playerVelocity.z);

        if (currentSpeedXZ > FOOT_DISABLED_THRESHOLD && this.isGrounded && !input.slow && !input.crouch) {
            const interval = this.baseFootInterval / currentSpeedXZ;
            this.footAcc += deltaTime;
            if (this.footAcc >= interval) {
                this.footAcc -= interval;
                const audio = this.footAudios[this.footIndex];
                audio.currentTime = 0;
                audio.play().catch(() => { });
                sendSoundEvent("footstep", "run", this._pos());
                this.footIndex = 1 - this.footIndex;
            }
        } else if (this.isGrounded && currentSpeedXZ <= FOOT_DISABLED_THRESHOLD) {
            this.footAcc = 0; // Reset footstep accumulator when stopped
        }

        // Now calling controls and updatePlayer once per frame with deltaTime
        this.controls(deltaTime, input);
        this.updatePlayer(deltaTime);
        this.teleportIfOob();

        // Landing sound logic
        if (!this.prevGround && this.isGrounded) {
            // Player just landed.
            // Check if falling distance was significant before playing land sound
            const fallDistance = this.fallStartY !== null ? (this.fallStartY - this.camera.position.y) : 0;
            
            // Play land sound if it was a significant fall OR if it was a jump and then a land
            if (fallDistance > 1 || (this.jumpTriggered && fallDistance > 0.1)) { // Adjusted fallDistance check for jump land
                this.landAudio.currentTime = 0;
                this.landAudio.play().catch(() => { });
                sendSoundEvent("landingThud", "land", this._pos());
            }
            this.fallStartY = null; // Reset fall start Y
            this.jumpTriggered = false; // Reset jump flag after landing
            // Clear any pending fall start timer if we land
            if (this.fallStartTimer) {
                clearTimeout(this.fallStartTimer);
                this.fallStartTimer = null;
            }
        } else if (!this.isGrounded && this.fallStartY === null && !this.jumpTriggered) {
            // If not grounded and fallStartY hasn't been set yet, AND we didn't just jump,
            // start a timer to set it after the delay. This prevents setting fallStartY immediately after a jump.
            if (!this.fallStartTimer) { // Only set a new timer if one isn't already active
                this.fallStartTimer = setTimeout(() => {
                    this.fallStartY = this.camera.position.y; // Set fallStartY after delay
                    this.fallStartTimer = null; // Reset the timer ID
                }, this.fallDelay);
            }
        } else if (this.isGrounded && this.fallStartTimer) {
            // If we somehow became grounded while a fallStartTimer was active, clear it.
            clearTimeout(this.fallStartTimer);
            this.fallStartTimer = null;
        }


        // Set camera position relative to the capsule's current height and position
        this.camera.position.x = this.playerCollider.start.x;
        this.camera.position.z = this.playerCollider.start.z;
        this.camera.position.y = this.playerCollider.start.y + (this.currentHeight * 0.9); // 90% of current height for eye level

        // Update debug capsule mesh position if active
        // if (this.debugCapsuleMesh) {
        //  this.debugCapsuleMesh.position.copy(this.playerCollider.start);
        //  this.debugCapsuleMesh.position.y += (this.currentHeight / 2);
        // }


        return {
            x: this.camera.position.x,
            y: this.camera.position.y,
            z: this.camera.position.z,
            rotY: this.camera.rotation.y,
            isGrounded: this.isGrounded,
            velocity: this.playerVelocity.clone(),
            velocityY: this.playerVelocity.y
        };
    }

    _pos() {
        const p = this.camera.position;
        return { x: p.x, y: p.y, z: p.z };
    }
}
