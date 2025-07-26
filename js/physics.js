
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { sendSoundEvent } from "./network.js"; // Assuming this path is correct

// Constants for player physics and dimensions ff f
const PLAYER_MASS = 70;
const GRAVITY = 27.5; // Gravity strength
const JUMP_VELOCITY = 12.3; // Initial upward velocity for jumps

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

const FOOT_DISABLED_THRESHOLD = 0.2; // Speed threshold below which footsteps stop

// Physics Sub-stepping Constants
const FIXED_TIME_STEP = 1 / 90; // Fixed time step for physics updates (e.g., 90 FPS physics)
const MAX_PHYSICS_STEPS = 5;    // Maximum number of physics steps per frame to prevent "spiral of death"

// NEW: Step-up constants
const STEP_HEIGHT = 1; // Maximum height the player can step up
const STEP_FORWARD_OFFSET = 0.1; // How far in front of the player to check for a step

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

    
_stepUpIfPossible() {
    if (!this.isGrounded || !this.collider) return;

    // 1. Determine player's horizontal movement direction and magnitude
    const horizVel = new THREE.Vector3(this.playerVelocity.x, 0, this.playerVelocity.z);
    // Only attempt step-up if there's significant horizontal movement
    // Using lengthSq for performance and a slightly higher threshold to filter out tiny movements or standing still
    if (horizVel.lengthSq() < 0.1 * 0.1) return; // Threshold squared (0.01)

    const dir = horizVel.normalize();

    // Calculate current scaled dimensions
    const currentScaledPlayerHeight = PLAYER_TOTAL_HEIGHT * this.player.scale.y;
    const currentScaledCapsuleRadius = this.player.capsuleInfo.radius * this.player.scale.y;

    // 2. Find the actual ground level directly beneath the player
    // This helps establish a precise 'current ground Y' to compare against.
    // The ray starts from the player's current horizontal position (top of capsule) and shoots downwards
    const groundCheckRay = new THREE.Raycaster(
        this.player.position.clone(),
        new THREE.Vector3(0, -1, 0),
        0, // Near plane (start from ray origin)
        currentScaledPlayerHeight + 0.1 // Far plane (check down to bottom of player + a small margin)
    );
    const groundHits = groundCheckRay.intersectObject(this.collider, true);

    let actualGroundY;
    if (groundHits.length > 0) {
        // If we hit ground directly below, use that as the reference Y
        actualGroundY = groundHits[0].point.y;
    } else {
        // Fallback: If for some reason no ground is directly below (e.g., player is slightly floating
        // due to prior collision), derive it from the player's current bottom.
        // This makes the assumption that if !groundHits, the player is currently over air or already lifted.
        actualGroundY = this.player.position.y - currentScaledPlayerHeight;
    }

    // 3. Setup the step-up raycast in front of the player
    // This ray will check for a stepable surface ahead.
    const rayOriginForwardOffset = currentScaledCapsuleRadius + STEP_FORWARD_OFFSET;
    const rayOriginX = this.player.position.x + dir.x * rayOriginForwardOffset;
    const rayOriginZ = this.player.position.z + dir.z * rayOriginForwardOffset;
    
    // The ray for step detection starts from above the `actualGroundY` at max step height
    const rayOriginY = actualGroundY + STEP_HEIGHT + 0.05; // 0.05 is a small offset above max step height

    const stepRay = new THREE.Raycaster(
        new THREE.Vector3(rayOriginX, rayOriginY, rayOriginZ),
        new THREE.Vector3(0, -1, 0), // Ray points straight down
        0,
        STEP_HEIGHT + 0.1 // Max distance the ray will travel downwards to find a step
    );
    const stepHits = stepRay.intersectObject(this.collider, true);

    // If no step surface is found in front, return
    if (stepHits.length === 0) return;
    const stepTopY = stepHits[0].point.y; // Y coordinate of the surface we hit

    // 4. Calculate the vertical difference between the detected step and the *actual current ground*
    const deltaY = stepTopY - actualGroundY;

    // 5. Conditions for performing the step-up:
    //    - deltaY must be positive (it's a step up, not down or flat)
    //    - deltaY must be within the allowed STEP_HEIGHT
    //    - Use a very small tolerance (1e-5) for deltaY, as `actualGroundY` is more reliable now.
    if (deltaY > 1e-5 && deltaY <= STEP_HEIGHT) {
        // 6. Headroom Check: Ensure there’s enough space above the player at the new stepped-up height
        // Calculate the Y coordinate of the player's top if they were to step up.
        // If the player's bottom moves to `stepTopY`, their top will be `stepTopY + currentScaledPlayerHeight`.
        const newPlayerTopY = stepTopY + currentScaledPlayerHeight;

        // Cast a small ray upwards from the predicted new top of the player
        const headCheckOrigin = new THREE.Vector3(
            this.player.position.x, // Use player's current horizontal position for the check
            newPlayerTopY + 0.01, // Start ray slightly above the predicted new player top
            this.player.position.z
        );
        const headRay = new THREE.Raycaster(headCheckOrigin, new THREE.Vector3(0, 1, 0), 0, 0.02); // Small ray upwards
        const headHits = headRay.intersectObject(this.collider, true);

        // If no ceiling is hit, perform the step
        if (headHits.length === 0) {
            // Perform the step: Adjust player's y position directly.
            // Since this.player.position.y is the TOP of the capsule, to place the BOTTOM at stepTopY,
            // we set the TOP to (stepTopY + currentScaledPlayerHeight).
            this.player.position.y = stepTopY + currentScaledPlayerHeight - 0.52;
            this.playerVelocity.y = 0; // Clear vertical velocity to prevent immediate fall
            this.isGrounded = true; // Player is now grounded on the new step
        }
    }
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
        if (input.crouch) {
            this.isCrouching = true;
            this.targetPlayerHeight = currentCrouchHeight;
        } else {
            this.isCrouching = false;
            this.targetPlayerHeight = standingHeight;
        }
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

        const currentRadius = this.player.capsuleInfo.radius;
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
                    if (normal.dot(this.upVector) < -0.1) {
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
     * This function runs for each physics sub-step.
     * @param {number} delta The fixed time step for this physics update.
     */
_updatePlayerPhysics(delta) {
    // Call step up before applying gravity for this frame
    this._stepUpIfPossible();

    // Store previous grounded state and reset for this frame
    const wasGrounded = this.isGrounded;
    this.isGrounded = false; // Assume not grounded until a valid collision proves otherwise

    // Always apply gravity. This helps "stick" the player to the ground,
    // especially on slopes, and ensures they fall when not colliding.
    this.playerVelocity.y -= GRAVITY * delta;

    // Cap horizontal speed as a safety (UNCHANGED)
    const horiz = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
    const maxHoriz = MAX_SPEED * this.speedModifier;
    if (horiz > maxHoriz) {
        const scale = maxHoriz / horiz;
        this.playerVelocity.x *= scale;
        this.playerVelocity.z *= scale;
    }

    // Smoothly adjust player height for crouching (UNCHANGED)
    const currentScaleY = this.player.scale.y;
    const targetScaleY = this.targetPlayerHeight / PLAYER_TOTAL_HEIGHT;
    if (Math.abs(currentScaleY - targetScaleY) > 0.001) {
        const newScaleY = THREE.MathUtils.lerp(currentScaleY, targetScaleY, CROUCH_SPEED * delta);
        const oldHeight = PLAYER_TOTAL_HEIGHT * currentScaleY;
        const newHeight = PLAYER_TOTAL_HEIGHT * newScaleY;
        this.player.scale.y = newScaleY;
        // Adjust player position to keep bottom of capsule at roughly the same world Y
        // This makes crouching feel like sinking into the ground, not through it.
        this.player.position.y -= (oldHeight - newHeight);
        this.player.capsuleInfo.segment.end.y = -this.originalCapsuleSegmentLength * newScaleY;
    }

    // Attempt to move the player by current velocity
    // Important: We apply the full velocity here, and collisions will correct it.
    this.player.position.addScaledVector(this.playerVelocity, delta);
    this.player.updateMatrixWorld(); // Update matrix after position change for correct transforms

    // --- Collision resolution ---
    // (Existing code for capsuleInfo, collisionRadius, tempBox, tempSegment)
    const capsuleInfo = this.player.capsuleInfo;
    // Add a tiny epsilon to the radius for collision checks to prevent gaps
    const collisionRadius = capsuleInfo.radius + 0.001;

    // Build AABB around the capsule in collider-local space
    this.tempBox.makeEmpty();
    this.tempSegment.copy(capsuleInfo.segment)
        .applyMatrix4(this.player.matrixWorld)
        .applyMatrix4(this.colliderMatrixWorldInverse);
    this.tempBox.expandByPoint(this.tempSegment.start);
    this.tempBox.expandByPoint(this.tempSegment.end);
    this.tempBox.min.addScalar(-collisionRadius);
    this.tempBox.max.addScalar(collisionRadius);

    let hasCollision = false;
    let collisionNormal = new THREE.Vector3();
    // Keep track of the highest Y collision normal (most "upward" facing) to determine grounding
    let highestYNormal = -Infinity;
    let groundCollisionNormal = null;

    // Shapecast to push out of geometry
    if (this.collider && this.collider.geometry && this.collider.geometry.boundsTree) {
        this.collider.geometry.boundsTree.shapecast({
            intersectsBounds: box => box.intersectsBox(this.tempBox),
            intersectsTriangle: tri => {
                const triPoint = this.tempVector;
                const capPoint = this.tempVector2;
                const dist = tri.closestPointToSegment(this.tempSegment, triPoint, capPoint);

                if (dist < collisionRadius) {
                    hasCollision = true;
                    const depth = collisionRadius - dist;
                    const pushDir = capPoint.sub(triPoint).normalize();

                    // Apply push directly to the segment, which will then be used to update player.position
                    this.tempSegment.start.addScaledVector(pushDir, depth);
                    this.tempSegment.end.addScaledVector(pushDir, depth);

                    // If this collision normal has a higher Y component, store it
                    if (pushDir.y > highestYNormal) {
                        highestYNormal = pushDir.y;
                        groundCollisionNormal = pushDir.clone(); // Clone to store it
                    }
                }
            }
        });
    } else {
        console.warn("Collider or boundsTree not available—skipping collision.");
    }

    // Compute world-space collision offset from the *adjusted* tempSegment
    const newStartWorld = this.tempVector
        .copy(this.tempSegment.start)
        .applyMatrix4(this.collider.matrixWorld);
    const deltaVec = newStartWorld.sub(this.player.position);

    // Apply the position correction (minus a tiny epsilon for float stability)
    const offset = Math.max(0, deltaVec.length() - 1e-5);
    deltaVec.normalize().multiplyScalar(offset);
    this.player.position.add(deltaVec);

    // Now, apply velocity corrections based on collisions
    if (hasCollision) {
        // We prioritize "ground" collisions. If there was *any* collision with an upward normal,
        // we consider the player grounded and adjust velocity accordingly.
        if (groundCollisionNormal && groundCollisionNormal.y > 0.05) { // A very small positive Y threshold
            this.isGrounded = true;

            // Project current velocity onto the plane defined by the ground normal
            const dot = this.playerVelocity.dot(groundCollisionNormal);
            // Only remove the velocity component that's pushing into the ground/slope
            this.playerVelocity.addScaledVector(groundCollisionNormal, -dot);

            // If still moving significantly downwards, zero out Y velocity to prevent "bouncing"
            // but allow sliding.
            if (this.playerVelocity.y < 0) {
                 this.playerVelocity.y = 0;
            }

            // Add a small downward force if perfectly still on a flat surface to prevent floating
            // or very slow "floating" on gentle slopes due to precision.
            // This specifically applies when horizontal velocity is very low.
            if (Math.abs(this.playerVelocity.x) < 0.01 && Math.abs(this.playerVelocity.z) < 0.01 && this.isGrounded) {
                 this.playerVelocity.y = -0.1; // A very slight downward "stickiness"
            }

        } else {
            // Hit a wall or ceiling (normal has little or no positive Y component)
            // Slide along the surface
            const proj = deltaVec.normalize().dot(this.playerVelocity); // Use deltaVec as collision normal approximation here
            this.playerVelocity.addScaledVector(deltaVec.normalize(), -proj);

            // If hitting a ceiling and moving upwards, stop vertical movement
            if (deltaVec.y < -0.05 && this.playerVelocity.y > 0) { // deltaVec.y < 0 means collision came from above
                this.playerVelocity.y = 0;
            }
        }
    }

    // If still technically grounded but velocity is upwards (e.g. from step-up or precision), zero it.
    if (this.isGrounded && this.playerVelocity.y > 0) {
        this.playerVelocity.y = 0;
    }


    // Sync camera to player position
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
            if (this.fallStartTimer) {
                clearTimeout(this.fallStartTimer);
                this.fallStartTimer = null;
            }
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
