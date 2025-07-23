import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { sendSoundEvent } from "./network.js"; // Assuming this path is correct

// Constants for player physics and dimensions
const PLAYER_MASS = 70; // Not currently used for actual mass-based physics, but good to have
const GRAVITY = 27.5; // Gravity strength
const JUMP_VELOCITY = 12.3; // Initial upward velocity for jumps

// Player capsule dimensions (matching the provided example's player setup)
const PLAYER_CAPSULE_RADIUS = 0.5;
// segment length is the height of the cylindrical part between the two spheres
const PLAYER_CAPSULE_SEGMENT_LENGTH = 2.2 - (2 * PLAYER_CAPSULE_RADIUS); // Length of the cylindrical part
const PLAYER_TOTAL_HEIGHT = PLAYER_CAPSULE_SEGMENT_LENGTH + (2 * PLAYER_CAPSULE_RADIUS); // Total height of the standing player (2.0)

// NEW: Constants for controlled movement and crouching
const PLAYER_ACCEL_GROUND = 3; // How quickly player reaches max speed on ground
const PLAYER_DECEL_GROUND = 5; // How quickly player stops on ground (faster than accel)
const PLAYER_ACCEL_AIR = 1;    // How quickly player reaches max speed in air (slower)
const PLAYER_DECEL_AIR = 3;    // How quickly player stops in air (slower than ground decel)
const CROUCH_HEIGHT_RATIO = 0.6; // Player height when crouched (e.g., 60% of original)
const CROUCH_SPEED = 8;        // Speed at which player crouches/stands

const MAX_SPEED = 10; // Maximum horizontal speed, now directly used for movement

const FOOT_DISABLED_THRESHOLD = 0.2; // Speed threshold below which footsteps stop

// Physics Sub-stepping Constants
const FIXED_TIME_STEP = 1 / 90; // Fixed time step for physics updates (e.g., 90 FPS physics)
const MAX_PHYSICS_STEPS = 5;    // Maximum number of physics steps per frame to prevent "spiral of death"

// Step Up Constants
const STEP_HEIGHT = 0.5; // Maximum height the player can step up
const STEP_FORWARD_BIAS = PLAYER_CAPSULE_RADIUS * 0.5; // How much to push forward when checking for a step

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
        this.tempMat = new THREE.Matrix4(); // Not used currently, but good to have
        this.tempSegment = new THREE.Line3();
        this.colliderMatrixWorldInverse = new THREE.Matrix4(); // Pre-allocate and store inverse

        // Physics sub-stepping accumulator
        this.accumulator = 0;

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

    /**
     * Attempts to step up an obstacle. Returns the new player position on success, false otherwise.
     * @param {THREE.Vector3} currentProposedPosition The player's position after applying velocity, before collision resolution.
     * @param {THREE.Vector3} collisionNormal The normal of the surface that caused the initial collision.
     * @returns {THREE.Vector3|boolean} The new player position if stepped up, or false.
     */
    _attemptStepUp(currentProposedPosition, collisionNormal) {
        if (!this.collider?.geometry?.boundsTree) return false;

        const currentCapsule = this.player.capsuleInfo;
        const initialPlayerPos = this.player.position;

        // Calculate the effective horizontal movement direction based on player velocity
        const horizontalVelocityDirection = this.playerVelocity.clone().setY(0).normalize();
        if (horizontalVelocityDirection.lengthSq() < 0.001) {
            // If player is not moving horizontally, use camera's forward direction
            horizontalVelocityDirection.copy(this.getForwardVector().setY(0).normalize());
        }

        // 1. Calculate a point just beyond the player's capsule in the direction of movement, at foot level.
        // This is the point we'll "probe" for a step.
        // footLevel is the Y coordinate of the bottom of the capsule (bottom sphere center)
        const footLevelY = initialPlayerPos.y + currentCapsule.segment.end.y + currentCapsule.radius;

        const testPointBase = initialPlayerPos.clone().add(horizontalVelocityDirection.clone().multiplyScalar(currentCapsule.radius + STEP_FORWARD_BIAS));
        testPointBase.y = footLevelY; // Set to foot level

        // 2. Lift this test point up by STEP_HEIGHT to check for a landing surface.
        const testPointElevated = testPointBase.clone().add(this.upVector.clone().multiplyScalar(STEP_HEIGHT));

        // 3. First, check if there's space for the player's full standing height ABOVE testPointElevated.
        // _checkCeilingCollision expects player.position to be the TOP of the capsule.
        // So, we temporarily set player.position.y to what it would be if the top of the capsule was at testPointElevated.y
        // Adjust testPointElevated.y to represent the top of the capsule:
        // top of capsule = testPointElevated.y + (currentCapsule.radius + PLAYER_CAPSULE_SEGMENT_LENGTH)
        const tempPlayerTopYForCeilingCheck = testPointElevated.y + currentCapsule.radius + PLAYER_CAPSULE_SEGMENT_LENGTH;
        const originalPlayerY = this.player.position.y; // Store current Y
        this.player.position.y = tempPlayerTopYForCeilingCheck; // Temporarily move for ceiling check

        const canStandUp = this._checkCeilingCollision(PLAYER_TOTAL_HEIGHT); // Check for full standing height
        this.player.position.y = originalPlayerY; // Reset player position immediately

        if (!canStandUp) {
            // console.log("❌ Step up failed: Ceiling hit at proposed step-up height.");
            return false;
        }

        // 4. Now, cast a segment downwards from testPointElevated towards testPointBase to find a step surface.
        const stepDownSegment = new THREE.Line3(testPointElevated, testPointBase.clone().sub(this.upVector.clone().multiplyScalar(0.01))); // Extend slightly below base for robustness

        this.tempSegment.copy(stepDownSegment);
        this.tempSegment.start.applyMatrix4(this.colliderMatrixWorldInverse);
        this.tempSegment.end.applyMatrix4(this.colliderMatrixWorldInverse);

        // Recompute tempBox for the stepDownSegment (bounding box for the query segment)
        this.tempBox.makeEmpty();
        this.tempBox.expandByPoint(this.tempSegment.start);
        this.tempBox.expandByPoint(this.tempSegment.end);
        const boxEpsilon = 0.001; // Small epsilon for bounding box expansion
        this.tempBox.min.addScalar(-boxEpsilon);
        this.tempBox.max.addScalar(boxEpsilon);

        let hitPoint = null;
        let hitNormal = null;
        let hitDistance = Infinity; // To find the closest valid hit

        this.collider.geometry.boundsTree.shapecast({
            intersectsBounds: box => box.intersectsBox(this.tempBox), // Corrected: Check against query bounding box
            intersectsTriangle: tri => {
                const triPoint = this.tempVector;
                const segmentPoint = this.tempVector2;

                // Use closestPointToSegment to find the intersection
                const distance = tri.closestPointToSegment(this.tempSegment, triPoint, segmentPoint);

                const intersectionThreshold = 0.005; // Very small threshold for segment intersection
                if (distance < intersectionThreshold) {
                    // Check if the surface normal allows walking (mostly upwards)
                    tri.getNormal(this.tempVector);
                    const surfaceNormal = this.tempVector;

                    if (surfaceNormal.dot(this.upVector) > 0.7) { // Angle check: ensure it's a walkable surface (e.g., max 45 degrees slope)
                        if (distance < hitDistance) { // Keep the closest hit
                            hitDistance = distance;
                            hitPoint = segmentPoint.clone(); // Point on the segment that hit the triangle
                            hitNormal = surfaceNormal.clone();
                            return true; // Found a valid hit, can stop early for this triangle
                        }
                    }
                }
                return false;
            }
        });

        if (hitPoint) {
            // Calculate the new player position based on the hitPoint.
            // hitPoint is the contact point on the step surface.
            // The bottom center of the capsule should align with hitPoint.
            // player.position is the top of the capsule.
            const newPlayerY = hitPoint.y + PLAYER_CAPSULE_RADIUS + PLAYER_CAPSULE_SEGMENT_LENGTH;
            const newPlayerPos = initialPlayerPos.clone(); // Start from current player XZ
            newPlayerPos.add(horizontalVelocityDirection.clone().multiplyScalar(currentCapsule.radius)); // Move horizontally to new spot
            newPlayerPos.y = newPlayerY; // Set the new Y

            // 5. Final check: ensure the new proposed player capsule position is clear after stepping up.
            // This is a full capsule check at `newPlayerPos`
            const finalCheckCapsuleSegment = new THREE.Line3(
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(0, -this.originalCapsuleSegmentLength * this.player.scale.y, 0)
            );
            finalCheckCapsuleSegment.start.add(newPlayerPos);
            finalCheckCapsuleSegment.end.add(newPlayerPos);

            finalCheckCapsuleSegment.start.applyMatrix4(this.colliderMatrixWorldInverse);
            finalCheckCapsuleSegment.end.applyMatrix4(this.colliderMatrixWorldInverse);

            let finalBlocked = false;
            this.tempBox.makeEmpty();
            this.tempBox.expandByPoint(finalCheckCapsuleSegment.start);
            this.tempBox.expandByPoint(finalCheckCapsuleSegment.end);
            this.tempBox.min.addScalar(-currentCapsule.radius - boxEpsilon);
            this.tempBox.max.addScalar(currentCapsule.radius + boxEpsilon);

            this.collider.geometry.boundsTree.shapecast({
                intersectsBounds: box => box.intersectsBox(this.tempBox),
                intersectsTriangle: tri => {
                    const triPoint = this.tempVector;
                    const capsulePoint = this.tempVector2;
                    const distance = tri.closestPointToSegment(finalCheckCapsuleSegment, triPoint, capsulePoint);
                    if (distance < currentCapsule.radius) {
                        tri.getNormal(this.tempVector);
                        const finalCollisionNormal = this.tempVector;

                        // Ignore collisions with the step surface we just found (if it's a valid walkable normal)
                        if (finalCollisionNormal.dot(this.upVector) > 0.7) {
                             // This is likely the step surface, ignore it for "blocked" check.
                            return false;
                        }

                        // If it's a vertical wall (normal horizontal) or ceiling (normal downwards)
                        if (Math.abs(finalCollisionNormal.dot(this.upVector)) < 0.1 || finalCollisionNormal.dot(this.upVector) < -0.1) {
                            finalBlocked = true;
                            return true; // Stop
                        }
                    }
                    return false;
                }
            });

            if (!finalBlocked) {
                console.log(`✅ Stepped up. Old Y: ${initialPlayerPos.y.toFixed(2)}, New Y: ${newPlayerPos.y.toFixed(2)}`);
                return newPlayerPos; // Return the new position
            } else {
                // console.log("❌ Step up failed: Final position blocked after step.");
                return false;
            }

        } else {
            // console.log("❌ Step up failed: No surface found within step range.");
            return false;
        }
    }

    /**
     * Checks if the player can stand up without hitting a ceiling.
     * @param {number} checkHeight The height to check for a ceiling (full standing height).
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
        // segment.end.y is negative, representing the bottom of the cylinder part from the top point.
        // So the full segment length is total_height - 2*radius.
        const segmentEnd = new THREE.Vector3(0, -(checkHeight - 2 * currentRadius), 0);

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
                    // Or if the hit point is significantly above the player's current head.
                    if (normal.dot(this.upVector) < -0.1) { // Normal pointing down
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
        // Reset grounded; we’ll detect contact this frame
        this.isGrounded = false;

        // Apply gravity
        this.playerVelocity.y -= GRAVITY * delta;

        // Cap horizontal speed
        const horizSpeed = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
        const maxHoriz = MAX_SPEED * this.speedModifier;
        if (horizSpeed > maxHoriz) {
            const s = maxHoriz / horizSpeed;
            this.playerVelocity.x *= s;
            this.playerVelocity.z *= s;
        }

        // Crouch/stand interpolation
        const curS = this.player.scale.y;
        const tgtS = this.targetPlayerHeight / PLAYER_TOTAL_HEIGHT;
        if (Math.abs(curS - tgtS) > 0.001) {
            const ns = THREE.MathUtils.lerp(curS, tgtS, CROUCH_SPEED * delta);
            const oldH = PLAYER_TOTAL_HEIGHT * curS;
            const newH = PLAYER_TOTAL_HEIGHT * ns;
            // Adjust player position so the bottom of the capsule stays roughly in place during scale changes
            this.player.position.y -= (oldH - newH); // Move top down as height shrinks
            this.player.scale.y = ns;
            // Update capsule segment end Y based on new scale
            this.player.capsuleInfo.segment.end.y = -this.originalCapsuleSegmentLength * ns;
        }

        // Propose new position after applying velocity
        const proposedPosition = this.player.position.clone().addScaledVector(this.playerVelocity, delta);

        // Prepare collision shapecast for the PROPOSED position
        const cap = this.player.capsuleInfo;
        const r = cap.radius * this.player.scale.y + 0.001; // Account for scaled radius

        // Create a temporary capsule segment at the proposed position for collision checking
        const tempPlayerMatrix = new THREE.Matrix4().compose(
            proposedPosition,
            this.player.quaternion, // Maintain player's current rotation for capsule orientation
            this.player.scale // Use current scale for collision capsule
        );
        this.tempSegment.copy(cap.segment)
            .applyMatrix4(tempPlayerMatrix)
            .applyMatrix4(this.colliderMatrixWorldInverse);

        this.tempBox.makeEmpty();
        this.tempBox.expandByPoint(this.tempSegment.start);
        this.tempBox.expandByPoint(this.tempSegment.end);
        this.tempBox.min.addScalar(-r);
        this.tempBox.max.addScalar(r);

        let collisionOccurred = false;
        let collisionNormal = new THREE.Vector3();
        let collisionDepth = 0;
        let contactPoint = new THREE.Vector3(); // Point on the capsule that hit

        if (this.collider?.geometry?.boundsTree) {
            this.collider.geometry.boundsTree.shapecast({
                intersectsBounds: box => box.intersectsBox(this.tempBox),
                intersectsTriangle: tri => {
                    const triPoint = this.tempVector;
                    const capsulePoint = this.tempVector2;
                    const distance = tri.closestPointToSegment(this.tempSegment, triPoint, capsulePoint);
                    if (distance < r) {
                        collisionOccurred = true;
                        collisionDepth = r - distance;
                        contactPoint.copy(capsulePoint); // Store point on capsule
                        tri.getNormal(collisionNormal); // Get normal of the triangle

                        // Ensure normal points away from the triangle surface towards the capsule
                        if (collisionNormal.dot(capsulePoint.sub(triPoint).normalize()) < 0) {
                            collisionNormal.negate();
                        }
                        return true; // Stop iterating on first collision for simplicity (can iterate for multiple contacts)
                    }
                    return false;
                }
            });
        }

        if (collisionOccurred) {
            // Check for step-up first if moving horizontally and "grounded" or about to be grounded
            const horizontalVelocityMagnitude = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
            // Consider player "nearly grounded" if moving downwards slowly or at rest on Y
            const isNearlyGrounded = this.isGrounded || (this.playerVelocity.y < 0.1 && this.playerVelocity.y > -GRAVITY * delta * 0.5);

            if (horizontalVelocityMagnitude > FOOT_DISABLED_THRESHOLD && isNearlyGrounded && collisionNormal.y < 0.2) { // Only try step-up if hitting a "wall-like" surface
                 const steppedUpPosition = this._attemptStepUp(proposedPosition, collisionNormal);
                 if (steppedUpPosition) {
                    this.player.position.copy(steppedUpPosition);
                    this.playerVelocity.y = 0; // Stop vertical motion after step
                    this.isGrounded = true;
                    this.player.updateMatrixWorld();
                    this.camera.position.copy(this.player.position); // Sync camera immediately
                    return; // Stop further collision resolution for this step
                 }
            }

            // If not stepped up, apply standard collision response
            // Push player out of collision
            this.player.position.copy(proposedPosition); // Apply the proposed position
            this.player.position.addScaledVector(collisionNormal, collisionDepth); // Push out along normal

            // Adjust velocity based on collision normal (slide or stop)
            const proj = this.playerVelocity.dot(collisionNormal);
            this.playerVelocity.addScaledVector(collisionNormal, -proj); // "Slide" along the surface

            // Determine if player is grounded based on collision normal
            // If the normal points significantly upwards, we are on the ground
            if (collisionNormal.y > 0.7) { // Threshold for considering it ground (e.g., angle less than ~45 degrees from vertical)
                this.isGrounded = true;
                this.playerVelocity.y = 0; // Zero out vertical velocity if grounded
            }
        } else {
            // No collision, just apply proposed position
            this.player.position.copy(proposedPosition);
        }

        this.player.updateMatrixWorld();
        this.camera.position.copy(this.player.position);
    }

    /**
     * Teleports the player to a safe position if they fall out of bounds.
     */
    teleportIfOob() {
        // Check player's Y position relative to the bottom of the capsule
        const scaledSegmentEnd = this.player.capsuleInfo.segment.end.y * this.player.scale.y;
        const scaledRadius = this.player.capsuleInfo.radius * this.player.scale.y;
        const bottomOfCapsuleY = this.player.position.y + scaledSegmentEnd - scaledRadius;

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
        // Correctly set the segment end after resetting scale
        this.player.capsuleInfo.segment.end.y = -PLAYER_CAPSULE_SEGMENT_LENGTH;

        // Update camera position to match the player's new position
        this.camera.position.copy(this.player.position);
        this.camera.rotation.set(0, 0, 0); // Optionally reset camera rotation
        console.log(`Player and camera teleported to: (${this.camera.position.x.toFixed(2)}, ${this.camera.position.y.toFixed(2)}, ${this.camera.position.z.toFixed(2)})`);
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
        // This logic makes the player model face the camera's horizontal direction
        // when on the ground.
        const playerWorldForward = new THREE.Vector3();
        this.camera.getWorldDirection(playerWorldForward);
        playerWorldForward.y = 0; // Flatten to horizontal
        playerWorldForward.normalize();

        // Create a target quaternion for the player mesh
        const targetQuaternion = new THREE.Quaternion().setFromUnitVectors(
            this.player.getWorldDirection(this.tempVector).setY(0).normalize(), // Current horizontal forward of player
            playerWorldForward // Target horizontal forward (camera's)
        );

        const smoothingFactor = 0.15; // Controls rotation speed
        this.player.quaternion.slerp(targetQuaternion, smoothingFactor);
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
