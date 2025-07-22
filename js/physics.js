import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { sendSoundEvent } from "./network.js"; // Assuming this path is correct

// Constants for player physics and dimensions
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

        // Player mesh centered on its origin:
        this.player = new THREE.Mesh(
            new RoundedBoxGeometry(
                PLAYER_CAPSULE_RADIUS * 2, // width
                PLAYER_TOTAL_HEIGHT,       // height
                PLAYER_CAPSULE_RADIUS * 2, // depth
                10,
                PLAYER_CAPSULE_RADIUS
            ),
            new THREE.MeshStandardMaterial()
        );
        this.player.geometry.translate(0, -PLAYER_TOTAL_HEIGHT / 2, 0);

        // Capsule around center:
        const halfSegLen = (PLAYER_TOTAL_HEIGHT - 2 * PLAYER_CAPSULE_RADIUS) / 2;
        this.player.capsuleInfo = {
            radius: PLAYER_CAPSULE_RADIUS,
            segment: new THREE.Line3(
                new THREE.Vector3(0,  halfSegLen, 0),
                new THREE.Vector3(0, -halfSegLen, 0)
            )
        };

        this.player.castShadow    = true;
        this.player.receiveShadow = true;
        this.player.material.shadowSide = 2;

        // Physics state
        this.playerVelocity = new THREE.Vector3();
        this.isGrounded     = false;

        // Crouching
        this.isCrouching                  = false;
        this.targetPlayerHeight           = PLAYER_TOTAL_HEIGHT;
        this.originalCapsuleSegmentLength = PLAYER_CAPSULE_SEGMENT_LENGTH;
        this.originalCapsuleRadius        = PLAYER_CAPSULE_RADIUS;

        // Helpers
        this.upVector      = new THREE.Vector3(0, 1, 0);
        this.tempVector    = new THREE.Vector3();
        this.tempVector2   = new THREE.Vector3();
        this.tempBox       = new THREE.Box3();
        this.tempMat       = new THREE.Matrix4();
        this.tempSegment   = new THREE.Line3();
        this.colliderMatrixWorldInverse = new THREE.Matrix4();

        // Sub‑stepping
        this.accumulator = 0;
        this.collider    = null;

        // Input
        this.mouseTime = 0;
        const container = document.getElementById('container') || document.body;
        container.addEventListener('mousedown', () => {
            document.body.requestPointerLock();
            this.mouseTime = performance.now();
        });
        this.camera.rotation.order = 'YXZ';

        // Audio
        this.footAudios = [
            new Audio("https://codehs.com/uploads/29c8a5da333b3fd36dc9681a4a8ec865"),
            new Audio("https://codehs.com/uploads/616ef1b61061008f9993d1ab4fa323ba")
        ];
        this.footAudios.forEach(a => a.volume = 0.7);
        this.footIndex       = 0;
        this.footAcc         = 0;
        this.baseFootInterval = 4;
        this.landAudio       = new Audio("https://codehs.com/uploads/600ab769d99d74647db55a468b19761f");
        this.landAudio.volume = 0.8;
        this.fallStartY      = null;
        this.prevPlayerIsOnGround = false;
        this.jumpTriggered    = false;
        this.fallDelay        = 300;
        this.fallStartTimer   = null;

        // Modifiers
        this.speedModifier = 0;
        this.isAim         = false;
        this.lastSurfaceNormal = new THREE.Vector3(0, 1, 0);
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
        // 1) gravity
        if (this.isGrounded) {
            this.playerVelocity.y = 0;
        } else {
            this.playerVelocity.y -= GRAVITY * delta;
        }

        // 2) cap horizontal speed
        const hSpeed = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
        if (hSpeed > MAX_SPEED * this.speedModifier) {
            const s = (MAX_SPEED * this.speedModifier) / hSpeed;
            this.playerVelocity.x *= s;
            this.playerVelocity.z *= s;
        }

        // 3) crouch/scale logic (unchanged)
        // … your existing crouch & scale code …

        // 4) compute proposed position
        const proposedPos = this.player.position.clone()
            .addScaledVector(this.playerVelocity, delta);

        // 5) move capsule into collider‐space
        this.tempSegment.copy(this.player.capsuleInfo.segment);
        this.tempSegment.start.add(proposedPos);
        this.tempSegment.end.add(proposedPos);
        this.tempSegment.start.applyMatrix4(this.colliderMatrixWorldInverse);
        this.tempSegment.end.applyMatrix4(this.colliderMatrixWorldInverse);

        // 6) build AABB
        const r = this.player.capsuleInfo.radius + 0.001;
        this.tempBox.makeEmpty();
        this.tempBox.expandByPoint(this.tempSegment.start);
        this.tempBox.expandByPoint(this.tempSegment.end);
        this.tempBox.min.addScalar(-r);
        this.tempBox.max.addScalar( r);

        // 7) shapecast: resolve penetration AND capture the ground normal
        const correction = new THREE.Vector3();
        let hitNormal = new THREE.Vector3(0, 1, 0);
        if (this.collider?.geometry?.boundsTree) {
            this.collider.geometry.boundsTree.shapecast({
                intersectsBounds: box => box.intersectsBox(this.tempBox),
                intersectsTriangle: tri => {
                    const triPt = this.tempVector;
                    const capPt = this.tempVector2;
                    const dist  = tri.closestPointToSegment(this.tempSegment, triPt, capPt);
                    if (dist < this.player.capsuleInfo.radius) {
                        const depth = this.player.capsuleInfo.radius - dist;
                        // direction to push capsule out
                        const pushDir = capPt.sub(triPt).normalize();
                        correction.addScaledVector(pushDir, depth);

                        // triangle normal (pointing outwards)
                        tri.getNormal(this.tempMat.identity().setPosition(0,0,0).invert() /* unused */);
                        tri.getNormal(hitNormal); // raw normal
                        // accumulate—if multiple hits, the last one will dominate
                    }
                }
            });
        }

        // store last surface normal for slope logic
        this.lastSurfaceNormal.copy(hitNormal);

        // 8) apply movement + correction
        this.player.position.copy(proposedPos).add(correction);
        this.player.updateMatrixWorld();

        // 9) stick to slopes: if grounded, project velocity onto the slope plane
        if (this.isGrounded) {
            const n = this.lastSurfaceNormal;
            // remove any component of velocity pushing into the slope
            const vn = n.clone().multiplyScalar(n.dot(this.playerVelocity));
            this.playerVelocity.sub(vn);
        }

        // 10) rotate player mesh to align "up" with the slope normal
        if (this.isGrounded) {
            const targetUp = this.lastSurfaceNormal.clone();
            // smoothly slerp the player's up-vector
            const currentQuat = this.player.quaternion.clone();
            const desiredQuat = new THREE.Quaternion().setFromUnitVectors(
                new THREE.Vector3(0, 1, 0),
                targetUp
            );
            // apply a little interpolation
            currentQuat.slerp(desiredQuat, 0.1);
            this.player.quaternion.copy(currentQuat);
        } else {
            // when airborne, slowly return upright
            this.player.up.lerp(new THREE.Vector3(0,1,0), 0.05);
            this.player.quaternion.slerp(new THREE.Quaternion(), 0.05);
        }

        // 11) camera follow
        this.camera.position.copy(this.player.position);
    }
    /**
     * Performs a downward shapecast to reliably determine if the player is grounded.
     * This is called after all movement and collision resolution for a physics step.
     */
    _checkIfGrounded() {
        if (!this.collider || !this.collider.geometry || !this.collider.geometry.boundsTree) {
            this.isGrounded = false;
            return;
        }

        const currentRadius = this.player.capsuleInfo.radius * this.player.scale.y; // Use scaled radius
        const segmentLength = this.player.capsuleInfo.segment.end.y * this.player.scale.y; // Use scaled segment length

        // Create a small raycast capsule segment extending just below the player's current bottom
        // This allows checking for ground very close to the player's actual bottom.
        const groundCheckOffset = 0.05; // Small offset to ensure contact

        // Bottom of the actual player capsule (before adjusting for check)
        const actualCapsuleBottomY = this.player.position.y + segmentLength - currentRadius;

        // Start point of the ground check segment (slightly inside the capsule)
        const checkSegmentStart = new THREE.Vector3(
            this.player.position.x,
            actualCapsuleBottomY + currentRadius, // Start from the center of the bottom sphere
            this.player.position.z
        );

        // End point of the ground check segment (just below the capsule)
        const checkSegmentEnd = new THREE.Vector3(
            this.player.position.x,
            actualCapsuleBottomY - groundCheckOffset,
            this.player.position.z
        );

        this.tempSegment.copy(new THREE.Line3(checkSegmentStart, checkSegmentEnd));

        // Transform the check segment into the collider's local space
        this.tempSegment.start.applyMatrix4(this.colliderMatrixWorldInverse);
        this.tempSegment.end.applyMatrix4(this.colliderMatrixWorldInverse);

        this.tempBox.makeEmpty();
        this.tempBox.expandByPoint(this.tempSegment.start);
        this.tempBox.expandByPoint(this.tempSegment.end);
        this.tempBox.min.addScalar(-currentRadius);
        this.tempBox.max.addScalar(currentRadius);

        let hitGround = false;
        this.collider.geometry.boundsTree.shapecast({
            intersectsBounds: box => box.intersectsBox(this.tempBox),
            intersectsTriangle: tri => {
                const triPoint = this.tempVector;
                const capsulePoint = this.tempVector2;
                const distance = tri.closestPointToSegment(this.tempSegment, triPoint, capsulePoint);

                if (distance < currentRadius) {
                    const normal = tri.getNormal(new THREE.Vector3());
                    // Check if the surface normal is mostly upwards (indicating a walkable surface)
                    if (normal.dot(this.upVector) > 0.7) { // 0.7 corresponds to about 45 degrees slope
                        hitGround = true;
                        return true; // Stop iterating, we found ground
                    }
                }
                return false;
            }
        });

        this.isGrounded = hitGround;
        // If grounded, make sure vertical velocity is zeroed to prevent "micro-bouncing"
        if (this.isGrounded && this.playerVelocity.y < 0) {
            this.playerVelocity.y = 0;
        }
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
            this._checkIfGrounded(); // Check grounded state after each physics step
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
