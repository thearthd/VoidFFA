import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'; // For player visual mesh
import { sendSoundEvent } from "./network.js";

// Constants for player physics and dimensions
const PLAYER_MASS = 70;
const GRAVITY = 27.5; // Gravity strength
const JUMP_VELOCITY = 12.3; // Initial upward velocity for jumps

// Player capsule dimensions (matching the provided example's player setup)
const PLAYER_CAPSULE_RADIUS = 0.5;
const PLAYER_CAPSULE_SEGMENT_LENGTH = 1.0; // Length of the cylindrical part of the capsule
const PLAYER_TOTAL_HEIGHT = PLAYER_CAPSULE_SEGMENT_LENGTH + 2 * PLAYER_CAPSULE_RADIUS; // Total height of the standing player (2.0)

const PLAYER_ACCEL_GROUND = 25; // Acceleration when on the ground
const PLAYER_ACCEL_AIR = 8; // Acceleration when in the air
const MAX_SPEED = 10; // Maximum horizontal speed

const FOOT_DISABLED_THRESHOLD = 0.2; // Speed threshold below which footsteps stop

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

export class PhysicsController {
    constructor(camera, scene) {
        this.camera = camera;
        this.scene = scene;

        // Player mesh and capsule information, matching the provided example
        this.player = new THREE.Mesh(
            new RoundedBoxGeometry(
                PLAYER_CAPSULE_RADIUS * 2, // Width
                PLAYER_TOTAL_HEIGHT,        // Height
                PLAYER_CAPSULE_RADIUS * 2,  // Depth
                10,                         // Segments
                PLAYER_CAPSULE_RADIUS       // Radius for rounded corners
            ),
            new THREE.MeshStandardMaterial()
        );
        // Translate the geometry so the player's origin (player.position) is at the top of the capsule
        this.player.geometry.translate(0, -PLAYER_CAPSULE_RADIUS, 0);

        // Define the capsule for collision detection relative to the player's local origin
        this.player.capsuleInfo = {
            radius: PLAYER_CAPSULE_RADIUS,
            // Segment starts at (0,0,0) (top of capsule) and goes down by segment length
            segment: new THREE.Line3(
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(0, -PLAYER_CAPSULE_SEGMENT_LENGTH, 0.0)
            )
        };
        this.player.castShadow = true;
        this.player.receiveShadow = true;
        this.player.material.shadowSide = 2; // Render shadows on both sides of the material

        // Physics state variables
        this.playerVelocity = new THREE.Vector3();
        this.playerIsOnGround = false; // Tracks if the player is currently on the ground

        // Helper vectors and objects to avoid re-allocations during calculations
        this.upVector = new THREE.Vector3(0, 1, 0);
        this.tempVector = new THREE.Vector3();
        this.tempVector2 = new THREE.Vector3();
        this.tempBox = new THREE.Box3();
        this.tempMat = new THREE.Matrix4();
        this.tempSegment = new THREE.Line3();

        // The MeshBVH collider, set externally by map.js
        this.collider = null;

        // Input and camera setup
        this.mouseTime = 0;
        const container = document.getElementById('container') || document.body;
        container.addEventListener('mousedown', () => {
            document.body.requestPointerLock();
            this.mouseTime = performance.now();
        });
        this.camera.rotation.order = 'YXZ'; // Ensure correct camera rotation order

        // Audio setup
        this.footAudios = [
            new Audio("https://codehs.com/uploads/29c8a5da333b3fd36dc9681a4a8ec865"),
            new Audio("https://codehs.com/uploads/616ef1b61061008f9993d1ab4fa323ba")
        ];
        this.footAudios.forEach(audio => { audio.volume = 0.7; });
        this.footIndex = 0;
        this.footAcc = 0;
        this.baseFootInterval = 3;
        this.landAudio = new Audio("https://codehs.com/uploads/600ab769d99d74647db55a468b19761f");
        this.landAudio.volume = 0.8;
        this.fallStartY = null;
        this.prevPlayerIsOnGround = false; // Store previous ground state for landing sound
        this.jumpTriggered = false; // Flag to track if the last airborne state was due to a jump
        this.fallDelay = 300; // Delay before considering a fall initiated
        this.fallStartTimer = null; // Timer for fall delay

        // Speed and aim modifiers (kept from original physics.js)
        this.speedModifier = 0;
        this.isAim = false;
    }

    /**
     * Sets the MeshBVH collider for collision detection. This is called by map.js.
     * @param {THREE.Mesh} colliderMesh The mesh with the computed MeshBVH boundsTree.
     */
    setCollider(colliderMesh) {
        this.collider = colliderMesh;
        console.log("MeshBVH collider set in PhysicsController.");
    }

    /**
     * Sets the speed modifier for player movement.
     * @param {number} value The speed modifier value.
     */
    setSpeedModifier(value) {
        this.speedModifier = value;
    }

    /**
     * Gets the forward vector based on the camera's direction, flattened to the XZ plane.
     * @returns {THREE.Vector3} The normalized forward vector.
     */
    getForwardVector() {
        this.camera.getWorldDirection(this.tempVector);
        this.tempVector.y = 0;
        this.tempVector.normalize();
        return this.tempVector;
    }

    /**
     * Gets the side (right) vector based on the camera's direction, flattened to the XZ plane.
     * @returns {THREE.Vector3} The normalized side vector.
     */
    getSideVector() {
        this.camera.getWorldDirection(this.tempVector);
        this.tempVector.y = 0;
        this.tempVector.normalize();
        this.tempVector.cross(this.upVector); // Cross with world up to get side vector
        return this.tempVector;
    }

    /**
     * Handles player input and updates player velocity.
     * @param {number} deltaTime The time elapsed since the last frame.
     * @param {object} input An object containing input states (e.g., forward, backward, jump, crouch, slow, aim).
     */
    controls(deltaTime, input) {
        // Determine acceleration based on whether player is on ground or in air
        const acceleration = this.playerIsOnGround ? PLAYER_ACCEL_GROUND : PLAYER_ACCEL_AIR;

        // Apply speed modifiers (crouch, slow, aim)
        const effectiveAcceleration = acceleration * this.speedModifier * (input.crouch ? 0.3 : input.slow ? 0.5 : this.isAim ? 0.65 : 1);

        // Calculate desired movement direction based on input
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

        // Normalize movement direction to prevent faster diagonal movement
        if (moveDirection.lengthSq() > 0) {
            moveDirection.normalize();
            // Add acceleration to player velocity
            this.playerVelocity.add(moveDirection.multiplyScalar(effectiveAcceleration * deltaTime));
        }

        // Handle jumping
        if (this.playerIsOnGround && input.jump) {
            this.playerVelocity.y = JUMP_VELOCITY; // Apply upward jump velocity
            this.playerIsOnGround = false; // Player is no longer on the ground
            this.jumpTriggered = true; // Set jump flag
        }

        // Note: Crouching logic (changing player height) is not implemented here
        // to strictly adhere to the provided example's fixed player hitbox.
        // If crouching is desired, player.capsuleInfo.segment and player.geometry.translate
        // would need to be dynamically adjusted based on currentHeight.
    }

    /**
     * Updates the player's position and resolves collisions using MeshBVH.
     * @param {number} delta The time elapsed since the last frame.
     */
    updatePlayer(delta) {
        // Apply gravity
        if (this.playerIsOnGround) {
            // When on ground, gravity pushes down. This helps with slopes.
            this.playerVelocity.y = -GRAVITY * delta;
        } else {
            // When in air, gravity continuously accelerates downwards
            this.playerVelocity.y -= GRAVITY * delta;
        }

        // Apply damping to horizontal velocity
        let damping = Math.exp(-4 * delta) - 1;
        this.playerVelocity.x += this.playerVelocity.x * damping;
        this.playerVelocity.z += this.playerVelocity.z * damping;

        // Cap horizontal speed
        const horizontalSpeed = Math.sqrt(this.playerVelocity.x * this.playerVelocity.x + this.playerVelocity.z * this.playerVelocity.z);
        if (horizontalSpeed > MAX_SPEED) {
            const ratio = MAX_SPEED / horizontalSpeed;
            this.playerVelocity.x *= ratio;
            this.playerVelocity.z *= ratio;
        }

        // Move the player's visual mesh by the current velocity
        this.player.position.addScaledVector(this.playerVelocity, delta);
        this.player.updateMatrixWorld(); // Update player's world matrix for correct collision checks

        // --- Collision Resolution using MeshBVH shapecast ---
        const capsuleInfo = this.player.capsuleInfo;
        this.tempBox.makeEmpty();
        // Invert the collider's world matrix to transform capsule into collider's local space
        this.tempMat.copy(this.collider.matrixWorld).invert();
        this.tempSegment.copy(capsuleInfo.segment); // Copy the player's capsule segment

        // Transform the capsule segment into the collider's local space
        this.tempSegment.start.applyMatrix4(this.player.matrixWorld).applyMatrix4(this.tempMat);
        this.tempSegment.end.applyMatrix4(this.player.matrixWorld).applyMatrix4(this.tempMat);

        // Get the axis-aligned bounding box of the capsule in collider's local space
        this.tempBox.expandByPoint(this.tempSegment.start);
        this.tempBox.expandByPoint(this.tempSegment.end);
        this.tempBox.min.addScalar(-capsuleInfo.radius);
        this.tempBox.max.addScalar(capsuleInfo.radius);

        // Perform shapecast collision check if collider is available
        if (this.collider && this.collider.geometry && this.collider.geometry.boundsTree) {
            this.collider.geometry.boundsTree.shapecast({
                intersectsBounds: box => box.intersectsBox(this.tempBox), // Optimize by checking AABB intersection first
                intersectsTriangle: tri => {
                    // Check if the triangle is intersecting the capsule and adjust position
                    const triPoint = this.tempVector;
                    const capsulePoint = this.tempVector2;

                    // Find the closest points between the triangle and the capsule segment
                    const distance = tri.closestPointToSegment(this.tempSegment, triPoint, capsulePoint);

                    if (distance < capsuleInfo.radius) {
                        const depth = capsuleInfo.radius - distance; // Calculate penetration depth
                        const direction = capsulePoint.sub(triPoint).normalize(); // Direction to push out

                        // Push the capsule segment out of the collision
                        this.tempSegment.start.addScaledVector(direction, depth);
                        this.tempSegment.end.addScaledVector(direction, depth);
                    }
                }
            });
        } else {
            console.warn("Collider or boundsTree not available for shapecast. Skipping collision detection.");
        }

        // Get the adjusted position of the capsule segment in world space after collision resolution
        const newPosition = this.tempVector;
        newPosition.copy(this.tempSegment.start).applyMatrix4(this.collider.matrixWorld);

        // Calculate how much the player's position was adjusted by collision
        const deltaVector = this.tempVector2;
        deltaVector.subVectors(newPosition, this.player.position);

        // Determine if the player is on the ground based on vertical adjustment
        // If the player was primarily adjusted vertically upwards (against gravity), they are on ground
        this.playerIsOnGround = deltaVector.y > Math.abs(delta * this.playerVelocity.y * 0.25);

        // Apply the collision adjustment to the player's actual position
        const offset = Math.max(0.0, deltaVector.length() - 1e-5);
        deltaVector.normalize().multiplyScalar(offset);
        this.player.position.add(deltaVector);

        // Adjust player velocity based on collision response
        if (!this.playerIsOnGround) {
            // If not on ground, project velocity onto the collision normal to slide
            deltaVector.normalize();
            this.playerVelocity.addScaledVector(deltaVector, -deltaVector.dot(this.playerVelocity));
        } else {
            // If on ground, zero out all velocity to prevent sliding on flat surfaces
            this.playerVelocity.set(0, 0, 0);
        }

        // Update camera position to follow the player
        this.camera.position.copy(this.player.position);
        // The camera's eye level is typically at the player's origin (top of capsule)
        // If you want the camera to be slightly above the player's head, add a small offset.
        // For this setup, player.position is the top of the capsule.
    }

    /**
     * Teleports the player to a safe position if they fall out of bounds.
     */
    teleportIfOob() {
        // Check player's Y position relative to the bottom of the capsule
        const bottomOfCapsuleY = this.player.position.y + this.player.capsuleInfo.segment.end.y - this.player.capsuleInfo.radius;
        if (bottomOfCapsuleY < -25) { // If player falls below a certain threshold
            console.warn("Player OOB detected! Teleporting...");
            this.setPlayerPosition(new THREE.Vector3(0, 5, 0)); // Teleport to a safe, elevated position
            this.playerVelocity.set(0, 0, 0); // Clear velocity
            this.playerIsOnGround = false;
            this.jumpTriggered = false; // Reset jump flag on teleport
            this.fallStartY = null; // Reset fall start Y on teleport
        }
    }

    /**
     * Sets the player's and camera's position.
     * @param {THREE.Vector3} position The new position for the player.
     */
    setPlayerPosition(position) {
        // Set player mesh position
        this.player.position.copy(position);

        // Reset velocities and flags
        this.playerVelocity.set(0, 0, 0);
        this.playerIsOnGround = false;
        this.jumpTriggered = false;
        this.fallStartY = null;

        // Update camera position to match the player's new position
        this.camera.position.copy(this.player.position);
        this.camera.rotation.set(0, 0, 0); // Optionally reset camera rotation
        console.log(`Player and camera teleported to: (${this.camera.position.x}, ${this.camera.position.y}, ${this.camera.position.z})`);
    }

    /**
     * Main update loop for the physics controller.
     * @param {number} deltaTime The time elapsed since the last frame.
     * @param {object} input An object containing input states.
     * @returns {object} An object containing current player state information.
     */
    update(deltaTime, input) {
        deltaTime = Math.min(0.05, deltaTime); // Cap deltaTime to prevent "explosions"

        this.prevPlayerIsOnGround = this.playerIsOnGround; // Store previous ground state for landing sound

        // Calculate horizontal speed for footstep sounds
        const currentSpeedXZ = Math.sqrt(this.playerVelocity.x * this.playerVelocity.x + this.playerVelocity.z * this.playerVelocity.z);

        // Footstep sound logic
        if (currentSpeedXZ > FOOT_DISABLED_THRESHOLD && this.playerIsOnGround && !input.slow && !input.crouch) {
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
        } else if (this.playerIsOnGround && currentSpeedXZ <= FOOT_DISABLED_THRESHOLD) {
            this.footAcc = 0; // Reset footstep accumulator when stopped
        }

        // Process controls and update player physics
        this.controls(deltaTime, input);
        this.updatePlayer(deltaTime);
        this.teleportIfOob();

        // Landing sound logic
        if (!this.prevPlayerIsOnGround && this.playerIsOnGround) {
            // Play landing sound if falling distance was significant or it was a jump
            if ((this.fallStartY !== null && (this.fallStartY - this.player.position.y) > 1) || (this.jumpTriggered && (this.fallStartY - this.player.position.y) > 1)) {
                this.landAudio.currentTime = 0;
                this.landAudio.play().catch(() => { });
                sendSoundEvent("landingThud", "land", this._pos());
            }
            this.fallStartY = null; // Reset fall start Y
            if (this.fallStartTimer) {
                clearTimeout(this.fallStartTimer);
                this.fallStartTimer = null;
            }
        } else if (!this.playerIsOnGround && this.fallStartY === null) {
            // If not grounded and fallStartY hasn't been set yet, start a timer
            if (!this.fallStartTimer) {
                this.fallStartTimer = setTimeout(() => {
                    this.fallStartY = this.player.position.y; // Set fallStartY after delay
                    this.fallStartTimer = null;
                }, this.fallDelay);
            }
        }

        // Player model rotation to align with camera direction when grounded
        if (this.playerIsOnGround) {
            const smoothingFactor = 0.15;
            const playerWorldForward = new THREE.Vector3();
            this.camera.getWorldDirection(playerWorldForward);
            playerWorldForward.y = 0;
            playerWorldForward.normalize();

            const targetQuaternion = new THREE.Quaternion().setFromUnitVectors(this.player.getWorldDirection(this.tempVector), playerWorldForward);
            this.player.quaternion.slerp(targetQuaternion, smoothingFactor);
        } else {
            // If not grounded, smoothly return to upright (or keep previous horizontal rotation)
            // This prevents the model from staying tilted after leaving a slope.
            const upAlignmentQuaternion = new THREE.Quaternion();
            upAlignmentQuaternion.setFromUnitVectors(this.player.up, new THREE.Vector3(0, 1, 0));
            this.player.quaternion.slerp(upAlignmentQuaternion, 0.05);
        }

        // Return current player state
        return {
            x: this.player.position.x,
            y: this.player.position.y,
            z: this.player.position.z,
            rotY: this.camera.rotation.y, // Camera rotation is still the primary rotation for view
            isGrounded: this.playerIsOnGround,
            velocity: this.playerVelocity.clone(),
            velocityY: this.playerVelocity.y
        };
    }

    /**
     * Returns the current player position as a simple object.
     * @returns {object} Player position {x, y, z}.
     */
    _pos() {
        const p = this.player.position; // Use player.position
        return { x: p.x, y: p.y, z: p.z };
    }
}
