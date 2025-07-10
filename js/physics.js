import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { OctreeV2 } from './OctreeV2.js'; // Ensure this is OctreeV2, not the three.js Octree
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
// Removed: import { Octree } from 'three/examples/jsm/math/Octree.js'; as we're using OctreeV2
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
            currentAudio.play().catch(() => { }).then(scheduleNext).catch(() => { });
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
            new Audio("[https://codehs.com/uploads/29c8a5da333b3fd36dc9681a4a8ec865](https://codehs.com/uploads/29c8a5da333b3fd36dc9681a4a8ec865)"),
            new Audio("[https://codehs.com/uploads/616ef1b61061008f9993d1ab4fa323ba](https://codehs.com/uploads/616ef1b61061008f9993d1ab4fa323ba)")
        ];
        this.footAudios.forEach(audio => { audio.volume = 0.7; }); // Set volume
        this.footIndex = 0;
        this.footAcc = 0;
        this.baseFootInterval = 3;
        this.landAudio = new Audio("[https://codehs.com/uploads/600ab769d99d74647db55a468b19761f](https://codehs.com/uploads/600ab769d99d74647db55a468b19761f)");
        this.landAudio.volume = 0.8; // Set volume
        this.fallStartY = null; // Tracks the Y position when the player started falling
        this.prevGround = false;
        this.jumpTriggered = false; // Flag to track if the last airborne state was due to a jump
        this.fallStartTimer = null; // Timer to delay setting fallStartY for small jumps/bumps

        this.speedModifier = 0;
        this.isAim = false;
        this.currentHeight = STAND_HEIGHT;
        this.targetHeight = STAND_HEIGHT;
        this.fallDelay = 300; // Milliseconds to wait before considering a fall as "significant"

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
     * Builds the world Octree from a given Three.js group (e.g., a loaded GLTF scene).
     * @param {THREE.Group} group The group containing meshes to build the Octree from.
     * @param {function({loaded: number, total: number})} onProgress Callback for progress updates.
     * @returns {Promise<void>} A promise that resolves when the Octree is built.
     */
    buildOctree(group, onProgress = () => {}) {
        return new Promise((resolve, reject) => {
            if (!group) {
                console.warn("Attempted to build Octree with no group provided.");
                onProgress({ loaded: 1, total: 1 }); // Immediately report 100% if no group
                resolve();
                return;
            }

            console.log("Starting Octree build from group geometry...");

            // Debug Log: Check mesh count
            let meshCount = 0;
            group.traverse((obj) => {
                if (obj.isMesh) {
                    meshCount++;
                }
            });
            console.log(`DEBUG: Group passed to Octree contains ${meshCount} meshes.`);

            // Ensure we clear and rebuild the existing OctreeV2 instance
            if (!this.worldOctree) {
                this.worldOctree = new OctreeV2(); // Re-initialize if it was somehow null
            }
            this.worldOctree.clear(); // Clear existing data to ensure a fresh build

            // Call fromGraphNode on the OctreeV2 instance.
            // This method (in OctreeV2.js) now accepts the progress callback and returns a Promise.
            this.worldOctree.fromGraphNode(group, ({ loaded, total }) => {
                // Pass the progress event directly to the external onProgress callback
                onProgress({ loaded, total });
            }).then(() => {
                console.log("Octree built successfully.");

                // Optional: Add/Update OctreeHelper for visualization
                // if (this.octreeHelper) {
                //    this.scene.remove(this.octreeHelper);
                //    this.octreeHelper.dispose();
                // }
                // this.octreeHelper = new OctreeHelper(this.worldOctree, 0xff0000);
                // this.scene.add(this.octreeHelper);
                // console.log("OctreeHelper added to scene.");

                resolve(); // Resolve the promise when Octree reports completion
            }).catch(err => {
                console.error("Error building Octree:", err);
                reject(err);
            });
        });
    }

    /**
     * Sets the speed modifier for player movement.
     * @param {number} value The new speed modifier.
     */
    setSpeedModifier(value) {
        this.speedModifier = value;
    }

    /**
     * Handles player collisions with the world Octree.
     */
    playerCollisions() {
        const result = this.worldOctree.capsuleIntersect(this.playerCollider);

        // Reset each frame
        this.playerOnFloor = false;
        this.isGrounded = false;

        if (result) {
            const normal = result.normal;
            const depth = result.depth;

            // Floor if normal is "up" enough
            this.playerOnFloor = normal.y > 0.5;
            this.isGrounded = this.playerOnFloor;

            const SKIN = 0.02; // 2 cm
            if (depth > SKIN) {
                // Translate out by (penetration – SKIN), so you stay SKIN above the surface
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

    /**
     * Updates the player's velocity and position based on physics.
     * @param {number} deltaTime The time elapsed since the last frame in seconds.
     */
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

        // Apply MAX_SPEED to horizontal velocity
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

    /**
     * Gets the normalized forward vector of the camera (player's gaze direction).
     * @returns {THREE.Vector3} The forward vector.
     */
    getForwardVector() {
        this.camera.getWorldDirection(this.playerDirection);
        this.playerDirection.y = 0;
        this.playerDirection.normalize();
        return this.playerDirection;
    }

    /**
     * Gets the normalized side vector of the camera (player's right direction).
     * @returns {THREE.Vector3} The side vector.
     */
    getSideVector() {
        this.camera.getWorldDirection(this.playerDirection);
        this.playerDirection.y = 0;
        this.playerDirection.normalize();
        this.playerDirection.cross(this.camera.up);
        return this.playerDirection;
    }

    /**
     * Handles player input for movement, jumping, and crouching.
     * @param {number} deltaTime The time elapsed since the last frame in seconds.
     * @param {Object} input An object containing input states (e.g., forward, backward, jump, crouch, slow, aim).
     */
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
                this.fallStartY = null; // Clear fallStartY immediately on jump
                clearTimeout(this.fallStartTimer); // Clear any pending fall start timer
                this.fallStartTimer = null;
            }
        }

        // Crouch/Stand height transition
        const wantCrouch = input.crouch && this.isGrounded;
        // const wantSlow = input.slow && this.isGrounded && !wantCrouch; // 'wantSlow' is used to adjust speed, not height. This line is unnecessary for height logic.

        this.targetHeight = wantCrouch ? CROUCH_HEIGHT : STAND_HEIGHT;

        // Smoothly interpolate height
        this.currentHeight += (this.targetHeight - this.currentHeight) * Math.min(1, CROUCH_SPEED * deltaTime);

        // Adjust collider height based on currentHeight
        // The capsule's end point defines its top. The height is (end.y - start.y) + 2*radius
        // So, end.y should be start.y + (desired_height - 2*radius)
        this.playerCollider.end.y = this.playerCollider.start.y + (this.currentHeight - 2 * COLLIDER_RADIUS);

        // If your debug capsule mesh is active, update its scale/position here
        // if (this.debugCapsuleMesh) {
        //    // Adjust geometry size for debug mesh (CapsuleGeometry takes radius, length)
        //    // Length of the cylinder part = total height - 2 * radius
        //    const capsuleLength = Math.max(0, this.currentHeight - 2 * COLLIDER_RADIUS);
        //    this.debugCapsuleMesh.geometry.dispose(); // Dispose old geometry
        //    this.debugCapsuleMesh.geometry = new THREE.CapsuleGeometry(COLLIDER_RADIUS, capsuleLength, 10, 20);
        //    // Position the mesh based on the collider's bottom point (start.y)
        //    this.debugCapsuleMesh.position.copy(this.playerCollider.start);
        //    this.debugCapsuleMesh.position.y += (COLLIDER_RADIUS + capsuleLength / 2); // Center the mesh on the capsule axis
        // }
    }

    /**
     * Teleports the player to a safe position if they fall out of bounds.
     */
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

    /**
     * Sets the player's position and resets their state.
     * @param {THREE.Vector3} position The new position for the player.
     */
    setPlayerPosition(position) {
        // Add a small offset to ensure player is not stuck in ground initially
        const spawnY = position.y + COLLIDER_RADIUS + 0.1;

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

    /**
     * Main update loop for the physics controller.
     * @param {number} deltaTime The time elapsed since the last frame in seconds.
     * @param {Object} input An object containing current input states.
     * @returns {Object} Player's current state (position, rotation, velocity, grounded status).
     */
    update(deltaTime, input) {
        deltaTime = Math.min(0.05, deltaTime); // Cap deltaTime to prevent "explosions"

        this.prevGround = this.isGrounded; // Store previous ground state

        const currentSpeedXZ = Math.sqrt(this.playerVelocity.x * this.playerVelocity.x + this.playerVelocity.z * this.playerVelocity.z);

        // Footstep logic
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

        // Apply controls and update player physics
        this.controls(deltaTime, input);
        this.updatePlayer(deltaTime);
        this.teleportIfOob();

        // Landing sound logic
        // If just landed
        if (!this.prevGround && this.isGrounded) {
            // Check if player was previously jumping, or if they fell a significant distance
            const fallDistance = this.fallStartY !== null ? (this.fallStartY - this.camera.position.y) : 0;
            const minFallDistanceForSound = 1; // Minimum distance to trigger land sound

            if (this.jumpTriggered || fallDistance > minFallDistanceForSound) {
                this.landAudio.currentTime = 0;
                this.landAudio.play().catch(() => { });
                sendSoundEvent("landingThud", "land", this._pos());
            }

            // Reset fall related states on landing
            this.fallStartY = null;
            this.jumpTriggered = false; // Reset jump flag
            clearTimeout(this.fallStartTimer); // Clear any pending fall start timer
            this.fallStartTimer = null;

        } else if (!this.isGrounded && this.fallStartY === null && this.fallStartTimer === null) {
            // If not grounded, fallStartY hasn't been set, and no timer is active:
            // Start a timer to set fallStartY after `fallDelay`.
            // This prevents setting fallStartY if player is just hopping off a small step.
            this.fallStartTimer = setTimeout(() => {
                this.fallStartY = this.camera.position.y;
                this.fallStartTimer = null; // Clear timer ID after it fires
            }, this.fallDelay);
        }

        // Set camera position relative to the capsule's current height and position
        this.camera.position.x = this.playerCollider.start.x;
        this.camera.position.z = this.playerCollider.start.z;
        // The camera's eye level is usually around 90% of the player's current height
        this.camera.position.y = this.playerCollider.start.y + (this.currentHeight * 0.9);

        // Update debug capsule mesh position if active
        // if (this.debugCapsuleMesh) {
        //    this.debugCapsuleMesh.position.copy(this.playerCollider.start);
        //    this.debugCapsuleMesh.position.y += (this.currentHeight / 2);
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

    /**
     * Returns the player's current position as a simple object.
     * @returns {{x: number, y: number, z: number}} The player's position.
     * @private
     */
    _pos() {
        const p = this.camera.position;
        return { x: p.x, y: p.y, z: p.z };
    }
}
