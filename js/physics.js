import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { sendSoundEvent } from "./network.js"; // Assuming this path is correct

// Constants (unchanged from your code, just for context)
const PLAYER_MASS = 70;
const GRAVITY = 27.5;
const JUMP_VELOCITY = 12.3;

const PLAYER_CAPSULE_RADIUS = 0.5;
const PLAYER_CAPSULE_SEGMENT_LENGTH = 2.2 - PLAYER_CAPSULE_RADIUS;
const PLAYER_TOTAL_HEIGHT = PLAYER_CAPSULE_SEGMENT_LENGTH + 2 * PLAYER_CAPSULE_RADIUS;

const PLAYER_ACCEL_GROUND = 3;
const PLAYER_DECEL_GROUND = 5;
const PLAYER_ACCEL_AIR = 1;
const PLAYER_DECEL_AIR = 3;
const CROUCH_HEIGHT_RATIO = 0.6;
const CROUCH_SPEED = 8;

const MAX_SPEED = 10;
const FOOT_DISABLED_THRESHOLD = 0.2;
const FIXED_TIME_STEP = 1 / 90;
const MAX_PHYSICS_STEPS = 5;

// NEW: Collision resolution specific constants
const COLLISION_ITERATIONS = 3; // How many times to try and resolve collisions per step
const MIN_VELOCITY_Y_ON_GROUND = -0.5; // Small downward velocity to keep player "snapped" to ground
const SLOPE_LIMIT_RADIANS = THREE.MathUtils.degToRad(45); // Max climbable slope
const MAX_STEP_HEIGHT = 0.3; // Maximum height the player can step up
const GROUND_STICK_THRESHOLD = 0.05; // How close to ground to consider grounded

// (seamless audio-loop helper remains unchanged)
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

        this.player = new THREE.Mesh(
            new RoundedBoxGeometry(
                PLAYER_CAPSULE_RADIUS * 2,
                PLAYER_TOTAL_HEIGHT,
                PLAYER_CAPSULE_RADIUS * 2,
                10,
                PLAYER_CAPSULE_RADIUS
            ),
            new THREE.MeshStandardMaterial()
        );
        this.player.geometry.translate(0, -PLAYER_CAPSULE_RADIUS, 0);

        this.player.capsuleInfo = {
            radius: PLAYER_CAPSULE_RADIUS,
            segment: new THREE.Line3(
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(0, -PLAYER_CAPSULE_SEGMENT_LENGTH, 0.0)
            )
        };
        this.player.castShadow = true;
        this.player.receiveShadow = true;
        this.player.material.shadowSide = 2;

        this.playerVelocity = new THREE.Vector3();
        this.isGrounded = false;

        this.isCrouching = false;
        this.targetPlayerHeight = PLAYER_TOTAL_HEIGHT;
        this.originalCapsuleSegmentLength = PLAYER_CAPSULE_SEGMENT_LENGTH;
        this.originalCapsuleRadius = PLAYER_CAPSULE_RADIUS;

        this.upVector = new THREE.Vector3(0, 1, 0);
        this.tempVector = new THREE.Vector3();
        this.tempVector2 = new THREE.Vector3();
        this.tempBox = new THREE.Box3();
        this.tempMat = new THREE.Matrix4();
        this.tempSegment = new THREE.Line3();
        this.colliderMatrixWorldInverse = new THREE.Matrix4();

        this.accumulator = 0;
        this.collider = null;

        this.mouseTime = 0;
        this.camera.rotation.order = 'YXZ';

        // Audio setup (unchanged)
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
        this.prevPlayerIsOnGround = false;
        this.jumpTriggered = false;
        this.fallDelay = 300;
        this.fallStartTimer = null;

        this.speedModifier = 0;
        this.isAim = false;
    }

    setCollider(colliderMesh) {
        this.collider = colliderMesh;
        this.colliderMatrixWorldInverse.copy(this.collider.matrixWorld).invert();
        console.log("MeshBVH collider set in PhysicsController.");
    }

    setSpeedModifier(value) {
        this.speedModifier = value;
    }

    getForwardVector() {
        this.camera.getWorldDirection(this.tempVector);
        this.tempVector.y = 0;
        this.tempVector.normalize();
        return this.tempVector;
    }

    getSideVector() {
        this.camera.getWorldDirection(this.tempVector);
        this.tempVector.y = 0;
        this.tempVector.normalize();
        this.tempVector.cross(this.upVector);
        return this.tempVector;
    }

    _applyControls(deltaTime, input) {
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

        if (moveDirection.lengthSq() > 0) {
            moveDirection.normalize();
        }

        const targetVelocityX = moveDirection.x * currentMoveSpeed;
        const targetVelocityZ = moveDirection.z * currentMoveSpeed;

        let accelRateX, accelRateZ;

        if (this.isGrounded) {
            accelRateX = input.forward || input.backward || input.left || input.right ? PLAYER_ACCEL_GROUND : PLAYER_DECEL_GROUND;
            accelRateZ = input.forward || input.backward || input.left || input.right ? PLAYER_ACCEL_GROUND : PLAYER_DECEL_GROUND;
        } else {
            accelRateX = input.forward || input.backward || input.left || input.right ? PLAYER_ACCEL_AIR : PLAYER_DECEL_AIR;
            accelRateZ = input.forward || input.backward || input.left || input.right ? PLAYER_ACCEL_AIR : PLAYER_DECEL_AIR;
        }

        this.playerVelocity.x = THREE.MathUtils.lerp(this.playerVelocity.x, targetVelocityX, accelRateX * deltaTime);
        this.playerVelocity.z = THREE.MathUtils.lerp(this.playerVelocity.z, targetVelocityZ, accelRateZ * deltaTime);

        if (this.isGrounded && input.jump) {
            this.playerVelocity.y = JUMP_VELOCITY;
            this.isGrounded = false;
            this.jumpTriggered = true;
        }

        const currentCrouchHeight = PLAYER_TOTAL_HEIGHT * CROUCH_HEIGHT_RATIO;
        const standingHeight = PLAYER_TOTAL_HEIGHT;

        if (input.crouch) {
            this.isCrouching = true;
            this.targetPlayerHeight = currentCrouchHeight;
        } else {
            // Only allow standing if there's no ceiling
            if (this._checkCeilingCollision(standingHeight)) {
                this.isCrouching = false;
                this.targetPlayerHeight = standingHeight;
            } else {
                // If cannot stand, remain crouching
                this.isCrouching = true;
                this.targetPlayerHeight = currentCrouchHeight;
            }
        }
    }

    _checkCeilingCollision(checkHeight) {
        if (!this.collider || !this.collider.geometry || !this.collider.geometry.boundsTree) {
            return true;
        }

        const currentRadius = this.player.capsuleInfo.radius;
        // Calculate the segment of the capsule at the target standing height
        // This is relative to the player's current position (which is the top of the capsule)
        const segmentStart = new THREE.Vector3(0, 0, 0); // Top of the capsule
        const segmentEnd = new THREE.Vector3(0, -(checkHeight - 2 * currentRadius), 0); // Bottom of cylinder

        this.tempSegment.copy(new THREE.Line3(segmentStart, segmentEnd));
        this.tempSegment.start.add(this.player.position);
        this.tempSegment.end.add(this.player.position);

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
                    const normal = tri.getNormal(new THREE.Vector3());
                    if (normal.dot(this.upVector) < -0.1) { // Normal points mostly downwards (ceiling)
                        hitCeiling = true;
                        return true;
                    }
                }
                return false;
            }
        });
        return !hitCeiling;
    }

    _updatePlayerPhysics(delta) {
        // Apply gravity
        this.playerVelocity.y -= GRAVITY * delta;

        // Cap horizontal speed (unchanged)
        const horizSpeed = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
        const maxHoriz = MAX_SPEED * this.speedModifier;
        if (horizSpeed > maxHoriz) {
            const s = maxHoriz / horizSpeed;
            this.playerVelocity.x *= s;
            this.playerVelocity.z *= s;
        }

        // Crouch/stand interpolation (unchanged)
        const curS = this.player.scale.y;
        const tgtS = this.targetPlayerHeight / PLAYER_TOTAL_HEIGHT;
        if (Math.abs(curS - tgtS) > 0.001) {
            const ns = THREE.MathUtils.lerp(curS, tgtS, CROUCH_SPEED * delta);
            const oldH = PLAYER_TOTAL_HEIGHT * curS;
            const newH = PLAYER_TOTAL_HEIGHT * ns;
            this.player.scale.y = ns;
            // Adjust player position so the *bottom* of the capsule remains roughly in place during scaling
            this.player.position.y += (oldH - newH);
            this.player.capsuleInfo.segment.end.y = -this.originalCapsuleSegmentLength * ns;
        }

        // Store the initial potential movement for step-up calculation
        const initialPlayerPos = this.player.position.clone();
        const initialPlayerVelY = this.playerVelocity.y;

        // Tentative move by velocity
        this.player.position.addScaledVector(this.playerVelocity, delta);
        this.player.updateMatrixWorld();

        // Reset grounded state for this step
        this.isGrounded = false;

        // Collision Resolution Iterations
        for (let i = 0; i < COLLISION_ITERATIONS; i++) {
            const cap = this.player.capsuleInfo;
            // Add a small epsilon to the radius to ensure slight overlap for detection
            const r = cap.radius + 0.001;

            this.tempSegment.copy(cap.segment)
                .applyMatrix4(this.player.matrixWorld)
                .applyMatrix4(this.colliderMatrixWorldInverse);

            this.tempBox.makeEmpty();
            this.tempBox.expandByPoint(this.tempSegment.start);
            this.tempBox.expandByPoint(this.tempSegment.end);
            this.tempBox.min.addScalar(-r);
            this.tempBox.max.addScalar(r);

            let bestDepth = 0;
            let bestNormal = null;
            let collided = false; // Flag to check if any collision occurred in this iteration

            if (this.collider?.geometry?.boundsTree) {
                this.collider.geometry.boundsTree.shapecast({
                    intersectsBounds: box => box.intersectsBox(this.tempBox),
                    intersectsTriangle: tri => {
                        const tp = this.tempVector;
                        const cp = this.tempVector2;
                        const dist = tri.closestPointToSegment(this.tempSegment, tp, cp);
                        if (dist < r) {
                            const depth = r - dist;
                            if (depth > bestDepth) {
                                bestDepth = depth;
                                bestNormal = tri.getNormal(new THREE.Vector3());
                            }
                            collided = true;
                            // Do not return true here, continue checking all intersecting triangles
                        }
                        return false; // Continue iterating to find the deepest penetration
                    }
                });
            }

            if (bestNormal) {
                // Apply push out correction
                const push = bestNormal.clone().multiplyScalar(bestDepth);
                this.player.position.add(push);

                // Re-evaluate grounded state and velocity
                const upDot = bestNormal.dot(this.upVector);

                if (upDot > Math.cos(SLOPE_LIMIT_RADIANS)) {
                    // This is a floor or a gentle slope
                    this.isGrounded = true;

                    // Dampen vertical velocity if moving into the ground
                    if (this.playerVelocity.y < 0) {
                        this.playerVelocity.y = Math.max(this.playerVelocity.y, MIN_VELOCITY_Y_ON_GROUND);
                    }
                    // If moving slightly upward onto a step, allow it to continue
                    // For steps, we'll try to move the player up.
                    // This is handled by attempting to move up, if no collision above, then applying move.
                } else if (upDot < -0.1) { // Hit a ceiling (normal points mostly downwards)
                    // If hitting a ceiling from below, zero out upward velocity
                    if (this.playerVelocity.y > 0) {
                        this.playerVelocity.y = 0;
                    }
                } else {
                    // This is a wall or steep slope: slide along it
                    // Project the player's current velocity onto the plane defined by the normal
                    const projection = this.playerVelocity.dot(bestNormal);
                    this.playerVelocity.addScaledVector(bestNormal, -projection);
                }
            } else if (!collided && i === 0) {
                // If no collision occurred in the first iteration, and we were previously grounded,
                // check for "sticking" to the ground more robustly.
                // This prevents floating when going down very small slopes or over small bumps.
                const raycaster = new THREE.Raycaster();
                const downDirection = new THREE.Vector3(0, -1, 0);
                const origin = this.player.position.clone();
                origin.y += this.player.capsuleInfo.radius + GROUND_STICK_THRESHOLD; // Start ray slightly above bottom of capsule

                raycaster.set(origin, downDirection);
                raycaster.far = this.player.capsuleInfo.radius + GROUND_STICK_THRESHOLD * 2; // Check slightly below capsule bottom

                const intersects = raycaster.intersectObject(this.collider, true);

                if (intersects.length > 0) {
                    const intersect = intersects[0];
                    if (intersect.distance <= this.player.capsuleInfo.radius + GROUND_STICK_THRESHOLD) {
                        // We are very close to the ground, so snap to it.
                        this.player.position.y -= (intersect.distance - this.player.capsuleInfo.radius);
                        this.isGrounded = true;
                        if (this.playerVelocity.y < 0) {
                            this.playerVelocity.y = Math.max(this.playerVelocity.y, MIN_VELOCITY_Y_ON_GROUND);
                        }
                    }
                }
            }

            // Update matrix world after each position correction
            this.player.updateMatrixWorld();
        }

        // --- Step-Up Logic (After initial collision resolution) ---
        // This should run after all basic collision pushes, potentially as a separate phase.
        // If the player tried to move horizontally and hit something, check if it's a step.
        const horizontalMovementDelta = this.player.position.clone().sub(initialPlayerPos);
        horizontalMovementDelta.y = 0; // Only care about horizontal displacement

        if (this.isGrounded && horizontalMovementDelta.lengthSq() < 0.001) {
            // Player is grounded and tried to move but effectively stopped horizontally,
            // which could indicate hitting a wall or a step.
            // Check for step-up opportunity.
            const horizontalVelocity = this.playerVelocity.clone();
            horizontalVelocity.y = 0;
            horizontalVelocity.normalize();

            // Project player forward slightly
            const checkPos = initialPlayerPos.clone().add(horizontalVelocity.multiplyScalar(this.player.capsuleInfo.radius * 1.1));
            // Check for ground slightly *above* current position, within MAX_STEP_HEIGHT
            for (let h = 0.01; h <= MAX_STEP_HEIGHT; h += 0.05) { // Check at small increments
                const testSegment = new THREE.Line3(
                    new THREE.Vector3(0, h, 0), // Start from above the player's current top of capsule
                    new THREE.Vector3(0, h - (PLAYER_TOTAL_HEIGHT - 2 * PLAYER_CAPSULE_RADIUS), 0)
                );
                testSegment.start.add(checkPos);
                testSegment.end.add(checkPos);

                testSegment.start.applyMatrix4(this.colliderMatrixWorldInverse);
                testSegment.end.applyMatrix4(this.colliderMatrixWorldInverse);

                this.tempBox.makeEmpty();
                this.tempBox.expandByPoint(testSegment.start);
                this.tempBox.expandByPoint(testSegment.end);
                this.tempBox.min.addScalar(-this.player.capsuleInfo.radius);
                this.tempBox.max.addScalar(this.player.capsuleInfo.radius);

                let hitObstacleAbove = false;
                if (this.collider?.geometry?.boundsTree) {
                    this.collider.geometry.boundsTree.shapecast({
                        intersectsBounds: box => box.intersectsBox(this.tempBox),
                        intersectsTriangle: tri => {
                            const triPoint = this.tempVector;
                            const capsulePoint = this.tempVector2;
                            const distance = tri.closestPointToSegment(testSegment, triPoint, capsulePoint);
                            if (distance < this.player.capsuleInfo.radius) {
                                hitObstacleAbove = true;
                                return true; // Stop iterating if obstacle found
                            }
                            return false;
                        }
                    });
                }

                if (!hitObstacleAbove) {
                    // If no obstacle found at this height, it's a potential step.
                    // Now, check if there's actually ground at this new height.
                    const raycaster = new THREE.Raycaster();
                    const downDirection = new THREE.Vector3(0, -1, 0);
                    const stepUpOrigin = checkPos.clone();
                    stepUpOrigin.y += h; // Move origin up by potential step height

                    raycaster.set(stepUpOrigin, downDirection);
                    raycaster.far = PLAYER_TOTAL_HEIGHT + 0.1; // Check far enough down for a floor

                    const intersects = raycaster.intersectObject(this.collider, true);

                    if (intersects.length > 0) {
                        const intersect = intersects[0];
                        // Check if the hit point is within the player's "footprint" horizontally
                        const horizontalDistanceToStep = new THREE.Vector2(intersect.point.x, intersect.point.z).distanceTo(new THREE.Vector2(this.player.position.x, this.player.position.z));
                        if (horizontalDistanceToStep < this.player.capsuleInfo.radius * 1.5) { // A bit more than radius
                            // This looks like a valid step
                            this.player.position.y = intersect.point.y + this.player.capsuleInfo.segment.end.y * this.player.scale.y + this.player.capsuleInfo.radius * this.player.scale.y + 0.01; // Snap to step top
                            this.playerVelocity.y = 0;
                            this.isGrounded = true;
                            break; // Successfully stepped up, exit loop
                        }
                    }
                }
            }
        }
        // --- End Step-Up Logic ---

        // Sync camera
        this.camera.position.copy(this.player.position);
    }

    teleportIfOob() {
        const scaledSegmentEnd = this.player.capsuleInfo.segment.end.y * this.player.scale.y;
        const bottomOfCapsuleY = this.player.position.y + scaledSegmentEnd - this.player.capsuleInfo.radius * this.player.scale.y;

        if (bottomOfCapsuleY < -25) {
            console.warn("Player OOB detected! Teleporting...");
            this.setPlayerPosition(new THREE.Vector3(0, 5, 0));
            this.playerVelocity.set(0, 0, 0);
            this.isGrounded = false;
            this.jumpTriggered = false;
            this.fallStartY = null;
            if (this.fallStartTimer) {
                clearTimeout(this.fallStartTimer);
                this.fallStartTimer = null;
            }
        }
    }

    setPlayerPosition(position) {
        this.player.position.copy(position);
        this.playerVelocity.set(0, 0, 0);
        this.isGrounded = false;
        this.jumpTriggered = false;
        this.fallStartY = null;

        this.player.scale.set(1, 1, 1);
        this.targetPlayerHeight = PLAYER_TOTAL_HEIGHT;
        this.player.capsuleInfo.segment.end.y = -PLAYER_CAPSULE_SEGMENT_LENGTH;

        this.camera.position.copy(this.player.position);
        this.camera.rotation.set(0, 0, 0);
        console.log(`Player and camera teleported to: (${this.camera.position.x}, ${this.camera.position.y}, ${this.camera.position.z})`);
    }

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
            this.footAcc = 0;
        }
    }

    _handleLandingSound() {
        if (!this.prevPlayerIsOnGround && this.isGrounded) {
            if ((this.fallStartY !== null && (this.fallStartY - this.player.position.y) > 1) || (this.jumpTriggered && (this.fallStartY - this.player.position.y) > 1)) {
                this.landAudio.currentTime = 0;
                this.landAudio.play().catch(() => { });
                sendSoundEvent("landingThud", "land", this._pos());
            }
            this.fallStartY = null;
            if (this.fallStartTimer) {
                clearTimeout(this.fallStartTimer);
                this.fallStartTimer = null;
            }
            this.jumpTriggered = false;
        } else if (!this.isGrounded && this.fallStartY === null) {
            if (!this.fallStartTimer) {
                this.fallStartTimer = setTimeout(() => {
                    this.fallStartY = this.player.position.y;
                    this.fallStartTimer = null;
                }, this.fallDelay);
            }
        } else if (this.isGrounded && this.fallStartTimer) {
            clearTimeout(this.fallStartTimer);
            this.fallStartTimer = null;
        }
    }

    _rotatePlayerModel() {
        if (this.isGrounded) {
            const smoothingFactor = 0.15;
            const playerWorldForward = new THREE.Vector3();
            this.camera.getWorldDirection(playerWorldForward);
            playerWorldForward.y = 0;
            playerWorldForward.normalize();

            const targetQuaternion = new THREE.Quaternion().setFromUnitVectors(this.player.getWorldDirection(this.tempVector), playerWorldForward);
            this.player.quaternion.slerp(targetQuaternion, smoothingFactor);
        } else {
            const upAlignmentQuaternion = new THREE.Quaternion();
            upAlignmentQuaternion.setFromUnitVectors(this.player.up, new THREE.Vector3(0, 1, 0));
            this.player.quaternion.slerp(upAlignmentQuaternion, 0.05);
        }
    }

    update(deltaTime, input) {
        deltaTime = Math.min(0.1, deltaTime);

        this.accumulator += deltaTime;

        this.prevPlayerIsOnGround = this.isGrounded;

        let stepsTaken = 0;
        while (this.accumulator >= FIXED_TIME_STEP && stepsTaken < MAX_PHYSICS_STEPS) {
            this._applyControls(FIXED_TIME_STEP, input);
            this._updatePlayerPhysics(FIXED_TIME_STEP);
            this.accumulator -= FIXED_TIME_STEP;
            stepsTaken++;
        }

        const currentSpeedXZ = Math.sqrt(this.playerVelocity.x * this.playerVelocity.x + this.playerVelocity.z * this.playerVelocity.z);

        this._handleFootsteps(currentSpeedXZ, deltaTime, input);
        this._handleLandingSound();
        this._rotatePlayerModel();
        this.teleportIfOob();

        return {
            x: this.player.position.x,
            y: this.player.position.y,
            z: this.player.position.z,
            rotY: this.camera.rotation.y,
            isGrounded: this.isGrounded,
            velocity: this.playerVelocity.clone(),
            velocityY: this.playerVelocity.y
        };
    }

    _pos() {
        const p = this.player.position;
        return { x: p.x, y: p.y, z: p.z };
    }
}
