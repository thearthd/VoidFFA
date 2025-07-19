import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { sendSoundEvent } from "./network.js";

// Constants for player physics and dimensions
const PLAYER_MASS = 70;
const GRAVITY = 27.5; // Gravity strength
const JUMP_VELOCITY = 12.3; // Initial upward velocity for jumps

// Player capsule dimensions (matching the provided example's player setup)
const PLAYER_CAPSULE_RADIUS = 0.5;
const PLAYER_CAPSULE_SEGMENT_LENGTH = 1.0; // Length of the cylindrical part of the capsule
const PLAYER_TOTAL_HEIGHT = PLAYER_CAPSULE_SEGMENT_LENGTH + 2 * PLAYER_CAPSULE_RADIUS; // Total height of the standing player (2.0)

// NEW: Constants for controlled movement and crouching
const PLAYER_ACCEL_GROUND = 25; // How quickly player reaches max speed on ground
const PLAYER_DECEL_GROUND = 40; // How quickly player stops on ground (faster than accel)
const PLAYER_ACCEL_AIR = 15;    // How quickly player reaches max speed in air (slower)
const PLAYER_DECEL_AIR = 20;     // How quickly player stops in air (slower than ground decel)
const CROUCH_HEIGHT_RATIO = 0.6; // Player height when crouched (e.g., 60% of original)
const CROUCH_SPEED = 8;        // Speed at which player crouches/stands

const MAX_SPEED = 10; // Maximum horizontal speed, now directly used for movement

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
                PLAYER_TOTAL_HEIGHT,       // Height
                PLAYER_CAPSULE_RADIUS * 2, // Depth
                10,                        // Segments
                PLAYER_CAPSULE_RADIUS      // Radius for rounded corners
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
        this.scene.add(this.player); // Add the player mesh to the scene

        // Physics state variables
        this.playerVelocity = new THREE.Vector3();
        this.isGrounded = false; // Tracks if the player is currently on the ground

        // NEW: Crouching state variables
        this.isCrouching = false;
        this.targetPlayerHeight = PLAYER_TOTAL_HEIGHT;
        this.originalCapsuleSegmentLength = PLAYER_CAPSULE_SEGMENT_LENGTH;
        this.originalCapsuleRadius = PLAYER_CAPSULE_RADIUS;

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
        // Calculate desired movement speed based on MAX_SPEED and modifiers
        const baseSpeed = MAX_SPEED;
        const currentMoveSpeed = baseSpeed * this.speedModifier * (input.crouch ? 0.3 : input.slow ? 0.5 : this.isAim ? 0.65 : 1);

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

        // Normalize the movement direction if there's input
        if (moveDirection.lengthSq() > 0) {
            moveDirection.normalize();
        }

        // Calculate the target horizontal velocity
        const targetVelocityX = moveDirection.x * currentMoveSpeed;
        const targetVelocityZ = moveDirection.z * currentMoveSpeed;

        // Determine acceleration/deceleration rate based on grounded state and input
        let accelRateX, accelRateZ;

        if (this.isGrounded) {
            accelRateX = input.forward || input.backward || input.left || input.right ? PLAYER_ACCEL_GROUND : PLAYER_DECEL_GROUND;
            accelRateZ = input.forward || input.backward || input.left || input.right ? PLAYER_ACCEL_GROUND : PLAYER_DECEL_GROUND;
        } else {
            accelRateX = input.forward || input.backward || input.left || input.right ? PLAYER_ACCEL_AIR : PLAYER_DECEL_AIR;
            accelRateZ = input.forward || input.backward || input.left || input.right ? PLAYER_ACCEL_AIR : PLAYER_DECEL_AIR;
        }

        // Apply acceleration/deceleration to horizontal velocity components
        this.playerVelocity.x = THREE.MathUtils.lerp(this.playerVelocity.x, targetVelocityX, accelRateX * deltaTime);
        this.playerVelocity.z = THREE.MathUtils.lerp(this.playerVelocity.z, targetVelocityZ, accelRateZ * deltaTime);

        // Handle jumping
        if (this.isGrounded && input.jump) {
            this.playerVelocity.y = JUMP_VELOCITY; // Apply upward jump velocity
            this.isGrounded = false; // Player is no longer on the ground
            this.jumpTriggered = true; // Set jump flag
        }

        // Crouching logic
        const currentCrouchHeight = PLAYER_TOTAL_HEIGHT * CROUCH_HEIGHT_RATIO;
        const standingHeight = PLAYER_TOTAL_HEIGHT;

        if (input.crouch) {
            this.isCrouching = true;
            this.targetPlayerHeight = currentCrouchHeight;
        } else {
            // Before standing up, check if there's enough space above the player
            const standingCheckHeight = standingHeight - this.player.capsuleInfo.radius * 2; // Approximate standing segment
            const canStandUp = this.checkCeilingCollision(standingCheckHeight); // Implement this check
            
            if (canStandUp) {
                this.isCrouching = false;
                this.targetPlayerHeight = standingHeight;
            } else {
                // If cannot stand up due to ceiling, remain crouched
                this.isCrouching = true;
                this.targetPlayerHeight = currentCrouchHeight;
            }
        }
    }

    /**
     * Checks if the player can stand up without hitting a ceiling.
     * This is a simplified check. A more robust solution might involve another shapecast.
     * @param {number} checkHeight The height to check for a ceiling.
     * @returns {boolean} True if the player can stand up, false otherwise.
     */
    checkCeilingCollision(checkHeight) {
        if (!this.collider || !this.collider.geometry || !this.collider.geometry.boundsTree) {
            return true; // If no collider, assume no ceiling
        }

        const currentCapsuleSegment = this.player.capsuleInfo.segment;
        const currentRadius = this.player.capsuleInfo.radius;

        // Create a temporary capsule segment representing the standing height
        const standingSegment = new THREE.Line3(
            new THREE.Vector3(0, currentCapsuleSegment.start.y + (checkHeight - (this.originalCapsuleSegmentLength + 2 * this.originalCapsuleRadius)), 0),
            new THREE.Vector3(0, currentCapsuleSegment.end.y + (checkHeight - (this.originalCapsuleSegmentLength + 2 * this.originalCapsuleRadius)), 0)
        );
        standingSegment.start.add(this.player.position);
        standingSegment.end.add(this.player.position);

        const tempBox = new THREE.Box3();
        const tempMat = new THREE.Matrix4();
        const transformedSegment = new THREE.Line3();

        tempMat.copy(this.collider.matrixWorld).invert();
        transformedSegment.copy(standingSegment);
        transformedSegment.start.applyMatrix4(tempMat);
        transformedSegment.end.applyMatrix4(tempMat);

        tempBox.expandByPoint(transformedSegment.start);
        tempBox.expandByPoint(transformedSegment.end);
        tempBox.min.addScalar(-currentRadius);
        tempBox.max.addScalar(currentRadius);

        let hitCeiling = false;
        this.collider.geometry.boundsTree.shapecast({
            intersectsBounds: box => box.intersectsBox(tempBox),
            intersectsTriangle: tri => {
                const triPoint = new THREE.Vector3();
                const capsulePoint = new THREE.Vector3();
                const distance = tri.closestPointToSegment(transformedSegment, triPoint, capsulePoint);
                if (distance < currentRadius) {
                    // Check if the collision is above the player (a ceiling)
                    const normal = tri.getNormal(new THREE.Vector3());
                    if (normal.dot(this.upVector) < -0.1) { // If normal points mostly downwards, it's a ceiling
                        hitCeiling = true;
                        return true; // Stop iterating
                    }
                }
                return false;
            }
        });
        return !hitCeiling; // Return true if no ceiling was hit
    }


    /**
     * Updates the player's position and resolves collisions using MeshBVH.
     * @param {number} delta The time elapsed since the last frame.
     */
    updatePlayer(delta) {
        // Apply gravity
        // When on ground, apply a small downward velocity to keep player "stuck" to it.
        // This is crucial for reliable ground detection with shapecast.
        if (this.isGrounded) {
            this.playerVelocity.y = -GRAVITY * delta * 0.1; // Small downward push
        } else {
            // When in air, gravity continuously accelerates downwards
            this.playerVelocity.y -= GRAVITY * delta; // Full gravity in air
        }

        // Cap horizontal speed. This is mostly for robustness now as velocity is set directly.
        const horizontalSpeed = Math.sqrt(this.playerVelocity.x * this.playerVelocity.x + this.playerVelocity.z * this.playerVelocity.z);
        if (horizontalSpeed > MAX_SPEED * this.speedModifier) { // Cap based on current speed modifier
            const ratio = (MAX_SPEED * this.speedModifier) / horizontalSpeed;
            this.playerVelocity.x *= ratio;
            this.playerVelocity.z *= ratio;
        }

        // Smoothly adjust player height for crouching
        const currentScaleY = this.player.scale.y;
        const targetScaleY = this.targetPlayerHeight / PLAYER_TOTAL_HEIGHT;

        if (Math.abs(currentScaleY - targetScaleY) > 0.001) {
            const newScaleY = THREE.MathUtils.lerp(currentScaleY, targetScaleY, CROUCH_SPEED * delta);
            const oldHeight = PLAYER_TOTAL_HEIGHT * currentScaleY;
            const newHeight = PLAYER_TOTAL_HEIGHT * newScaleY;

            this.player.scale.y = newScaleY;

            // Adjust player's y position so the bottom of the capsule stays on the ground
            const heightDifference = oldHeight - newHeight;
            this.player.position.y -= heightDifference;

            // Update capsuleInfo segment based on new height
            this.player.capsuleInfo.segment.end.y = -(PLAYER_CAPSULE_SEGMENT_LENGTH * newScaleY);
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
        // Also, if player's y velocity is significantly positive (moving upwards), they are not grounded.
        this.isGrounded = (deltaVector.y > Math.abs(delta * this.playerVelocity.y * 0.25)) && (this.playerVelocity.y <= 0.05);

        // Apply the collision adjustment to the player's actual position
        const offset = Math.max(0.0, deltaVector.length() - 1e-5);
        deltaVector.normalize().multiplyScalar(offset);
        this.player.position.add(deltaVector);

        // Adjust player velocity based on collision response
        if (!this.isGrounded) {
            // If not on ground, project velocity onto the collision normal to slide
            deltaVector.normalize();
            this.playerVelocity.addScaledVector(deltaVector, -deltaVector.dot(this.playerVelocity));
        } else {
            // If on ground, we might want to dampen horizontal velocity or fully zero it if there's no input
            // to prevent sliding on flat surfaces when player stops.
            // However, with the new lerp-based horizontal movement, this might not be strictly necessary
            // as the velocity is already being controlled by acceleration/deceleration.
            // We'll keep the y velocity zeroed out if grounded to prevent bouncing.
            this.playerVelocity.y = 0;
        }

        // Update camera position to follow the player
        // The camera should be at the top of the player's capsule, which is player.position.y
        this.camera.position.copy(this.player.position);
    }

    /**
     * Teleports the player to a safe position if they fall out of bounds.
     */
    teleportIfOob() {
        // Check player's Y position relative to the bottom of the capsule
        // The bottom of the capsule is player.position.y (top) + segment.end.y (bottom of segment) - radius (bottom cap)
        // Adjust for scaling: player.position.y is the top of the scaled capsule.
        // The effective segment end will be relative to the scaled height.
        const scaledSegmentEnd = this.player.capsuleInfo.segment.end.y * this.player.scale.y;
        const bottomOfCapsuleY = this.player.position.y + scaledSegmentEnd - this.player.capsuleInfo.radius * this.player.scale.y;

        if (bottomOfCapsuleY < -25) { // If player falls below a certain threshold
            console.warn("Player OOB detected! Teleporting...");
            this.setPlayerPosition(new THREE.Vector3(0, 5, 0)); // Teleport to a safe, elevated position
            this.playerVelocity.set(0, 0, 0); // Clear velocity
            this.isGrounded = false;
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
        this.isGrounded = false;
        this.jumpTriggered = false;
        this.fallStartY = null;

        // Reset player scale and target height in case they were crouching
        this.player.scale.set(1, 1, 1);
        this.targetPlayerHeight = PLAYER_TOTAL_HEIGHT;
        this.player.capsuleInfo.segment.end.y = -PLAYER_CAPSULE_SEGMENT_LENGTH; // Reset segment length

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

        this.prevPlayerIsOnGround = this.isGrounded; // Store previous ground state for landing sound

        // Calculate horizontal speed for footstep sounds
        const currentSpeedXZ = Math.sqrt(this.playerVelocity.x * this.playerVelocity.x + this.playerVelocity.z * this.playerVelocity.z);

        // Footstep sound logic
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

        // Process controls and update player physics
        this.controls(deltaTime, input);
        this.updatePlayer(deltaTime);
        this.teleportIfOob();

        // Landing sound logic
        if (!this.prevPlayerIsOnGround && this.isGrounded) {
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
        } else if (!this.isGrounded && this.fallStartY === null) {
            // If not grounded and fallStartY hasn't been set yet, start a timer
            if (!this.fallStartTimer) {
                this.fallStartTimer = setTimeout(() => {
                    this.fallStartY = this.player.position.y; // Set fallStartY after delay
                    this.fallStartTimer = null;
                }, this.fallDelay);
            }
        }

        // Player model rotation to align with camera direction when grounded
        // The player model is 'this.player'
        if (this.isGrounded) {
            const smoothingFactor = 0.15;
            const playerWorldForward = new THREE.Vector3();
            this.camera.getWorldDirection(playerWorldForward);
            playerWorldForward.y = 0; // Flatten to horizontal
            playerWorldForward.normalize();

            // Create a target quaternion for the player mesh that aligns its forward with the camera's horizontal forward
            // and its up vector with the world's up vector (0,1,0).
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
            isGrounded: this.isGrounded,
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
