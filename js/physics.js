import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { sendSoundEvent } from "./network.js"; // Assuming this path is correct

// Constants for player physics and dimensions f
const PLAYER_MASS = 70;
const GRAVITY = 27.5; // Gravity strength
const JUMP_VELOCITY = 12.3; // Initial upward velocity for jumps

const STEP_HEIGHT = 1; // Maximum height the player can step up
const STEP_FORWARD_OFFSET = 0.1; // How far in front of the player to check for a step

const MAX_SLOPE_ANGLE = 45 * (Math.PI / 180);
const WALKABLE_DOT = Math.cos(MAX_SLOPE_ANGLE);

// Player capsule dimensions (matching the provided example's player setup)
const PLAYER_CAPSULE_RADIUS = 0.5;
const PLAYER_CAPSULE_SEGMENT_LENGTH = 2.2 - PLAYER_CAPSULE_RADIUS; // Length of the cylindrical part of the capsule
const PLAYER_TOTAL_HEIGHT = PLAYER_CAPSULE_SEGMENT_LENGTH + 2 * PLAYER_CAPSULE_RADIUS; // Total height of the standing player (2.0)

// NEW: Constants for controlled movement and crouching
const PLAYER_ACCEL_GROUND = 3; // How quickly player reaches max speed on ground
const PLAYER_DECEL_GROUND = 5; // How quickly player stops on ground (faster than accel)
const PLAYER_ACCEL_AIR = 1;    // How quickly player reaches max speed in air (slower)
const PLAYER_DECEL_AIR = 3;      // How quickly player stops in air (slower than ground decel)
const CROUCH_HEIGHT_RATIO = 0.6; // Player height when crouched (e.g., 60% of original)
const CROUCH_SPEED = 8;          // Speed at which player crouches/stands

const MAX_SPEED = 10; // Maximum horizontal speed, now directly used for movement
const AIR_TURN_RATE = 180 * (Math.PI / 180);


const FOOT_DISABLED_THRESHOLD = 0.2; // Speed threshold below which footsteps stop

// Physics Sub-stepping Constants
const FIXED_TIME_STEP = 1 / 90; // Fixed time step for physics updates (e.g., 90 FPS physics)
const MAX_PHYSICS_STEPS = 5;    // Maximum number of physics steps per frame to prevent "spiral of death"


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

        // Physics state variables
        this.playerVelocity = new THREE.Vector3();
        this.isGrounded = false; // Tracks if the player is currently on the ground
        this.groundNormal = new THREE.Vector3(); // Store the normal of the surface we are grounded on

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
        this.colliderMatrixWorldInverse = new THREE.Matrix4(); // Pre-allocate and store inverse

        // Physics sub-stepping accumulator
        this.accumulator = 0;

        // The MeshBVH collider, set externally by map.js
        this.collider = null;

        // Input and camera setup
        this.mouseTime = 0;
        this.camera.rotation.order = 'YXZ'; // Ensure correct camera rotation order

        // Audio setup
        this.footAudios = [
            new Audio("https://codehs.com/uploads/29c8a5da333b3fd36dc9681a4a8ec865"),
            new Audio("https://codehs.com/uploads/616ef1b61061008f9993d1ab4fa323ba")
        ];
        this.footAudios.forEach(audio => { audio.volume = 0.7; });
        this.footIndex = 0;
        this.footAcc = 0;
        this.baseFootInterval = 4;
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
        this._lastAirYaw = this.camera.rotation.y;
    }

    /**
     * Sets the MeshBVH collider for collision detection. This is called by map.js.
     * @param {THREE.Mesh} colliderMesh The mesh with the computed MeshBVH boundsTree.
     */
    setCollider(colliderMesh) {
        this.collider = colliderMesh;
        this.colliderMatrixWorldInverse.copy(this.collider.matrixWorld).invert(); // Cache inverse matrix
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
    _applyControls(deltaTime, input) {
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

        if (!this.isGrounded) {
            this.input = input;
            this._applyAirControl(deltaTime);
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

        // Determine target height based on input and ceiling check
        // Check for headroom before standing up from crouch
        if (input.crouch) {
            this.isCrouching = true;
            this.targetPlayerHeight = currentCrouchHeight;
        } else {
            // Only allow standing up if there's no ceiling
            if (this._checkCeilingCollision(standingHeight)) {
                this.isCrouching = false;
                this.targetPlayerHeight = standingHeight;
            } else {
                // If there's a ceiling, force crouch
                this.isCrouching = true;
                this.targetPlayerHeight = currentCrouchHeight;
            }
        }
    }

    _applyAirControl(dt) {
        // 1) How much has the camera yaw changed this step?
        let yawNow = this.camera.rotation.y;
        let deltaYaw = yawNow - this._lastAirYaw;

        // Normalize to [-π, +π]
        deltaYaw = ((deltaYaw + Math.PI) % (2 * Math.PI)) - Math.PI;

        // 2) Clamp by your max turn rate
        const maxYaw = AIR_TURN_RATE * dt;       // radians allowed this frame
        const appliedYaw = Math.sign(deltaYaw) * Math.min(Math.abs(deltaYaw), maxYaw);
        if (appliedYaw === 0) return;            // no turning

        // 3) Build a quaternion around world‑up
        const q = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            appliedYaw
        );

        // 4) Rotate _only_ the horizontal part of your velocity
        const v = this.playerVelocity;
        const horizontal = new THREE.Vector3(v.x, 0, v.z).applyQuaternion(q);
        v.x = horizontal.x;
        v.z = horizontal.z;
        // leave v.y untouched
    }

    /**
     * Checks if the player can stand up without hitting a ceiling.
     * @param {number} checkHeight The height to check for a ceiling.
     * @returns {boolean} True if the player can stand up, false otherwise.
     */
    _checkCeilingCollision(checkHeight) {
        if (!this.collider || !this.collider.geometry || !this.collider.geometry.boundsTree) {
            return true; // If no collider, assume no ceiling
        }

        const currentRadius = this.player.capsuleInfo.radius * this.player.scale.y; // Account for current scale
        // Calculate the segment of the capsule at the target standing height
        // This is relative to the player's current position (which is the top of the capsule)
        const segmentStart = new THREE.Vector3(0, 0, 0); // Top of the capsule
        const segmentEnd = new THREE.Vector3(0, -(checkHeight - 2 * currentRadius), 0); // Bottom of cylinder

        this.tempSegment.copy(new THREE.Line3(segmentStart, segmentEnd));
        this.tempSegment.start.add(this.player.position);
        this.tempSegment.end.add(this.player.position);

        // Transform the temporary standing segment into the collider's local space
        this.tempSegment.start.applyMatrix4(this.colliderMatrixWorldInverse);
        this.tempSegment.end.applyMatrix4(this.colliderMatrixWorldInverse);

        this.tempBox.makeEmpty();
        this.tempBox.expandByPoint(this.tempSegment.start);
        this.tempBox.expandByPoint(this.tempSegment.end);
        this.tempBox.min.addScalar(-currentRadius);
        this.tempBox.max.addScalar(currentRadius);

        let hitCeiling = false;
        this.collider.geometry.boundsTree.shapecast({
            intersectsBounds: box => box.intersectsBox(this.tempBox),
            intersectsTriangle: tri => {
                const triPoint = this.tempVector;
                const capsulePoint = this.tempVector2;
                const distance = tri.closestPointToSegment(this.tempSegment, triPoint, capsulePoint);
                if (distance < currentRadius) {
                    // Check if the collision is above the player (a ceiling)
                    const normal = tri.getNormal(new THREE.Vector3());
                    // Dot product with upVector to see if normal points mostly downwards (ceiling)
                    // Added a threshold to ensure it's sufficiently a "ceiling"
                    if (normal.dot(this.upVector) < -0.3) { // Adjusted threshold
                        hitCeiling = true;
                        return true; // Stop iterating
                    }
                }
                return false;
            }
        });
        return !hitCeiling; // Return true if no ceiling was hit
    }

    // Consolidated and improved collision and step-up logic
    _updatePlayerPhysics(delta) {
        // Store previous grounded state and reset for this frame
        const wasGrounded = this.isGrounded;
        this.isGrounded = false;
        this.groundNormal.set(0, 0, 0); // Reset ground normal

        // Apply gravity or small downward snap
        if (wasGrounded) {
            // Apply a small "stick to ground" force
            this.playerVelocity.y = -GRAVITY * delta * 0.1;
        } else {
            this.playerVelocity.y -= GRAVITY * delta;
        }

        // Cap horizontal speed as a safety
        const horiz = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
        const maxHoriz = MAX_SPEED * this.speedModifier;
        if (horiz > maxHoriz) {
            const scale = maxHoriz / horiz;
            this.playerVelocity.x *= scale;
            this.playerVelocity.z *= scale;
        }

        // Smoothly adjust player height for crouching
        const currentScaleY = this.player.scale.y;
        const targetScaleY = this.targetPlayerHeight / PLAYER_TOTAL_HEIGHT;
        if (Math.abs(currentScaleY - targetScaleY) > 0.001) {
            const newScaleY = THREE.MathUtils.lerp(currentScaleY, targetScaleY, CROUCH_SPEED * delta);
            const oldHeight = PLAYER_TOTAL_HEIGHT * currentScaleY;
            const newHeight = PLAYER_TOTAL_HEIGHT * newScaleY;

            // Adjust player position based on the change in height so the feet stay roughly in place
            this.player.position.y -= (oldHeight - newHeight);
            this.player.scale.y = newScaleY;

            // Recalculate capsule segment length based on new scale
            this.player.capsuleInfo.segment.end.y = -this.originalCapsuleSegmentLength * newScaleY;
        }

        // --- Prepare for collision detection ---
        const capsuleInfo = this.player.capsuleInfo;
        const collisionRadius = capsuleInfo.radius * this.player.scale.y; // Account for scaled radius

        // Create the segment for the capsule's current position and scale
        // This segment is in world space, relative to the player.position (top of capsule)
        this.tempSegment.copy(capsuleInfo.segment);
        this.tempSegment.start.multiplyScalar(this.player.scale.y); // Scale the segment points
        this.tempSegment.end.multiplyScalar(this.player.scale.y);
        this.tempSegment.start.add(this.player.position);
        this.tempSegment.end.add(this.player.position);

        // Store the player's position BEFORE potential movement to calculate actual displacement
        const originalPlayerPosition = this.player.position.clone();

        // Move the player's mesh by current velocity (prediction for collision check)
        this.player.position.addScaledVector(this.playerVelocity, delta);

        // --- Collision resolution loop ---
        const iterations = 5; // Max iterations for collision resolution
        let collidedThisFrame = false;

        for (let i = 0; i < iterations; i++) {
            collidedThisFrame = false;
            let deepestOverlap = 0;
            let bestPushVector = new THREE.Vector3();
            let surfaceNormal = new THREE.Vector3(); // Normal of the surface hit

            // Update tempSegment to player's current (potentially moved) position
            this.tempSegment.copy(capsuleInfo.segment);
            this.tempSegment.start.multiplyScalar(this.player.scale.y);
            this.tempSegment.end.multiplyScalar(this.player.scale.y);
            this.tempSegment.start.add(this.player.position);
            this.tempSegment.end.add(this.player.position);

            // Transform into collider's local space for shapecast
            const segmentInLocal = this.tempSegment.clone()
                .applyMatrix4(this.colliderMatrixWorldInverse);

            // Build AABB around the capsule in collider-local space
            this.tempBox.makeEmpty();
            this.tempBox.expandByPoint(segmentInLocal.start);
            this.tempBox.expandByPoint(segmentInLocal.end);
            this.tempBox.min.addScalar(-collisionRadius);
            this.tempBox.max.addScalar(collisionRadius);

            if (this.collider && this.collider.geometry && this.collider.geometry.boundsTree) {
                this.collider.geometry.boundsTree.shapecast({
                    intersectsBounds: box => box.intersectsBox(this.tempBox),
                    intersectsTriangle: tri => {
                        const triPoint = this.tempVector;
                        const capPoint = this.tempVector2;
                        const dist = tri.closestPointToSegment(segmentInLocal, triPoint, capPoint);

                        if (dist < collisionRadius) {
                            collidedThisFrame = true;
                            const depth = collisionRadius - dist;

                            const pushDir = capPoint.sub(triPoint).normalize();

                            // Use the deepest overlap to find the "best" normal
                            if (depth > deepestOverlap) {
                                deepestOverlap = depth;
                                bestPushVector.copy(pushDir);
                                tri.getNormal(surfaceNormal); // Get actual triangle normal
                                surfaceNormal.applyMatrix4(this.collider.matrixWorld); // Convert to world space
                            }
                        }
                    }
                });
            }

            if (collidedThisFrame) {
                // Move player out of collision
                this.player.position.addScaledVector(bestPushVector, deepestOverlap + 0.001); // Add a tiny epsilon

                // --- Handle step-up / sliding ---
                const normalY = surfaceNormal.dot(this.upVector);

                if (normalY >= WALKABLE_DOT) { // This is a walkable surface (ground or gentle slope)
                    this.isGrounded = true;
                    this.groundNormal.copy(surfaceNormal);

                    // Stop downward velocity if we hit ground, but allow upward velocity
                    if (this.playerVelocity.y < 0) {
                        this.playerVelocity.y = 0;
                    }

                    // Adjust velocity to slide along the ground if still moving into it
                    const velocityDotNormal = this.playerVelocity.dot(surfaceNormal);
                    if (velocityDotNormal < 0) { // If moving into the surface
                        this.playerVelocity.addScaledVector(surfaceNormal, -velocityDotNormal);
                    }

                    // EXPERIMENTAL: Step-up handling for small obstacles
                    // If we just pushed out and the collision normal suggests a step
                    if (bestPushVector.y > 0.1 && deepestOverlap > 0.05) { // If pushed up significantly
                        const horizVelocityMagnitude = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
                        if (horizVelocityMagnitude > 0.1) { // Only attempt if moving horizontally
                            // Raycast forward from current player feet to check for a valid step
                            const rayOrigin = this.player.position.clone();
                            rayOrigin.y -= (this.player.scale.y * PLAYER_TOTAL_HEIGHT / 2) - collisionRadius; // Approximate feet level
                            rayOrigin.addScaledVector(this.playerVelocity.clone().setY(0).normalize(), collisionRadius + STEP_FORWARD_OFFSET);
                            rayOrigin.y += STEP_HEIGHT; // Start ray from above max step height

                            const raycaster = new THREE.Raycaster(rayOrigin, new THREE.Vector3(0, -1, 0), 0, STEP_HEIGHT + 0.1);
                            const intersects = raycaster.intersectObject(this.collider, true);

                            if (intersects.length > 0) {
                                const hitPoint = intersects[0].point;
                                const currentFeetY = this.player.position.y - (this.player.scale.y * PLAYER_TOTAL_HEIGHT / 2);
                                const stepHeight = hitPoint.y - currentFeetY;

                                if (stepHeight > 0.01 && stepHeight <= STEP_HEIGHT) { // Valid step height
                                    // Check headroom at new stepped-up position
                                    const newTopY = hitPoint.y + (this.player.scale.y * PLAYER_TOTAL_HEIGHT) - collisionRadius;
                                    const headroomClear = this._checkCeilingCollision(newTopY - this.player.position.y + PLAYER_TOTAL_HEIGHT); // Check against full standing height
                                    if (headroomClear) {
                                        this.player.position.y = hitPoint.y + (this.player.scale.y * PLAYER_TOTAL_HEIGHT / 2) - collisionRadius; // Move up
                                        this.playerVelocity.y = 0; // Clear vertical velocity
                                        this.isGrounded = true; // Confirm grounded state
                                    }
                                }
                            }
                        }
                    }
                } else { // This is a wall or too steep a slope
                    // Slide along the wall
                    const proj = surfaceNormal.dot(this.playerVelocity);
                    this.playerVelocity.addScaledVector(surfaceNormal, -proj);
                    // Add a tiny bit of downward push to prevent "sticky" walls if not grounded
                    if (!this.isGrounded) {
                       this.playerVelocity.y = Math.min(this.playerVelocity.y, -0.1); // Ensure slight downward
                    }
                }
            } else {
                break; // No more collisions this iteration, stop loop
            }
        }

        // Final check for grounded state if no direct ground contact was made during collision resolution
        if (!this.isGrounded && this.playerVelocity.y <= 0) {
            // Raycast slightly below player to confirm ground
            const rayOrigin = this.player.position.clone();
            rayOrigin.y -= (this.player.scale.y * PLAYER_TOTAL_HEIGHT / 2); // Start from bottom of player
            rayOrigin.y -= collisionRadius; // Start just below capsule bottom
            const raycaster = new THREE.Raycaster(rayOrigin, new THREE.Vector3(0, -1, 0), 0, 0.2); // Small distance
            const intersects = raycaster.intersectObject(this.collider, true);

            if (intersects.length > 0) {
                const hit = intersects[0];
                const normalY = hit.face.normal.dot(this.upVector);
                if (normalY >= WALKABLE_DOT) {
                    this.isGrounded = true;
                    this.playerVelocity.y = 0; // Snap to ground
                    this.groundNormal.copy(hit.face.normal.transformDirection(this.collider.matrixWorld)); // Store world space normal
                    this.player.position.y = hit.point.y + (this.player.scale.y * PLAYER_TOTAL_HEIGHT / 2) - collisionRadius; // Position on ground
                }
            }
        }

        // Sync camera to player position
        this.camera.position.copy(this.player.position);
        this._lastAirYaw = this.camera.rotation.y;
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
            window.localPlayer.isDead = true;
            /*
            console.warn("Player OOB detected! Teleporting...");
            this.setPlayerPosition(new THREE.Vector3(0, 5, 0)); // Teleport to a safe, elevated position
            this.playerVelocity.set(0, 0, 0); // Clear velocity
            this.isGrounded = false;
            this.jumpTriggered = false; // Reset jump flag on teleport
            this.fallStartY = null; // Reset fall start Y on teleport
            if (this.fallStartTimer) {
                clearTimeout(this.fallStartTimer);
                this.fallStartTimer = null;
            }
            */
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
     * Handles footstep audio logic.
     * @param {number} currentSpeedXZ Current horizontal speed of the player.
     * @param {number} deltaTime Time elapsed since last frame.
     * @param {object} input Input states.
     */
    _handleFootsteps(currentSpeedXZ, deltaTime, input) {
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
    }

    /**
     * Handles landing audio logic.
     */
    _handleLandingSound() {
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
            this.jumpTriggered = false; // Reset jump trigger
        } else if (!this.isGrounded && this.fallStartY === null) {
            // If not grounded and fallStartY hasn't been set yet, and not due to a jump, start a timer
            if (!this.fallStartTimer) {

                this.fallStartTimer = setTimeout(() => {
                    this.fallStartY = this.player.position.y; // Set fallStartY after delay
                    this.fallStartTimer = null;
                }, this.fallDelay);
            }
        } else if (this.isGrounded && this.fallStartTimer) {
            // If grounded, but fall timer was active, clear it.
            clearTimeout(this.fallStartTimer);
            this.fallStartTimer = null;
        }
    }

    /**
     * Rotates the player model to align with camera direction when grounded.
     */
    _rotatePlayerModel() {
        if (this.isGrounded) {
            const smoothingFactor = 0.15;
            const playerWorldForward = new THREE.Vector3();
            this.camera.getWorldDirection(playerWorldForward);
            playerWorldForward.y = 0; // Flatten to horizontal
            playerWorldForward.normalize();

            // Create a target quaternion for the player mesh that aligns its forward with the camera's horizontal forward
            const targetQuaternion = new THREE.Quaternion().setFromUnitVectors(this.player.getWorldDirection(this.tempVector), playerWorldForward);
            this.player.quaternion.slerp(targetQuaternion, smoothingFactor);
        } else {
            // If not grounded, smoothly return to upright (or keep previous horizontal rotation)
            const upAlignmentQuaternion = new THREE.Quaternion();
            upAlignmentQuaternion.setFromUnitVectors(this.player.up, new THREE.Vector3(0, 1, 0));
            this.player.quaternion.slerp(upAlignmentQuaternion, 0.05);
        }
    }

    /**
     * Main update loop for the physics controller.
     * @param {number} deltaTime The time elapsed since the last frame.
     * @param {object} input An object containing input states.
     * @returns {object} An object containing current player state information.
     */
    update(deltaTime, input) {
        deltaTime = Math.min(0.1, deltaTime); // Cap deltaTime to prevent "explosions"

        this.accumulator += deltaTime;

        // Store previous ground state before physics updates
        this.prevPlayerIsOnGround = this.isGrounded;

        let stepsTaken = 0;
        while (this.accumulator >= FIXED_TIME_STEP && stepsTaken < MAX_PHYSICS_STEPS) {
            this._applyControls(FIXED_TIME_STEP, input);
            this._updatePlayerPhysics(FIXED_TIME_STEP);
            this.accumulator -= FIXED_TIME_STEP;
            stepsTaken++;
        }

        // Calculate horizontal speed for footstep sounds (after all physics steps)
        const currentSpeedXZ = Math.sqrt(this.playerVelocity.x * this.playerVelocity.x + this.playerVelocity.z * this.playerVelocity.z);

        this._handleFootsteps(currentSpeedXZ, deltaTime, input);
        this._handleLandingSound();
        this._rotatePlayerModel(); // Player model rotation for visual feedback
        this.teleportIfOob();

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
