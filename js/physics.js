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

// STEPS_PER_FRAME has been removed

// Vector helpers to avoid re-allocations
const _vector1 = new THREE.Vector3();
const _vector2 = new THREE.Vector3();
const _vector3 = new THREE.Vector3();

export class PhysicsController {
    // Modified constructor to accept playerModel
    constructor(camera, scene, playerModel = null) {
        this.camera = camera;
        this.scene = scene;
        this.playerModel = playerModel; // Store the player's 3D model

        this.playerCollider = new Capsule(
            new THREE.Vector3(0, COLLIDER_RADIUS, 0),
            new THREE.Vector3(0, STAND_HEIGHT - COLLIDER_RADIUS, 0),
            COLLIDER_RADIUS
        );
        
        this.playerVelocity = new THREE.Vector3();
        this.playerDirection = new THREE.Vector3();
        this.playerOnFloor = false;
        this.isGrounded = false; // More descriptive, often used for general ground checks
        this.groundNormal = new THREE.Vector3(0, 1, 0); // Store the normal of the ground

        this.worldOctree = new OctreeV2();

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
        this.landAudio = new Audio("https://codehs.com/uploads/600ab769d99d74647db55a468b19761f");
        this.landAudio.volume = 0.8; // Set volume
        this.fallStartY = null;
        this.prevGround = false;
        this.jumpTriggered = false; // ADDED: Flag to track if the last airborne state was due to a jump

        this.speedModifier = 0;
        this.isAim = false;
        this.currentHeight = STAND_HEIGHT;
        this.targetHeight = STAND_HEIGHT;
        this.fallDelay = 300;
        // Debugging Helpers (Optional, but highly recommended for collision issues)
        // Uncomment these to visualize the Octree and Player Capsule
        // this.octreeHelper = new OctreeHelper(this.worldOctree);
        // this.scene.add(this.octreeHelper);

        // const capsuleGeometry = new THREE.CapsuleGeometry(COLLIDER_RADIUS, STAND_HEIGHT - 2 * COLLIDER_RADIUS, 10, 20);
        // const capsuleMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true, transparent: true, opacity: 0.5 });
        // this.debugCapsuleMesh = new THREE.Mesh(capsuleGeometry, capsuleMaterial);
        // this.scene.add(this.debugCapsuleMesh);
    }

    async buildOctree(group, onProgress = () => {}) {
        if (!group) {
            console.warn("Attempted to build Octree with no group provided.");
            onProgress({ loaded: 1, total: 1 });
            return;
        }

        console.log("Starting Octree build from group geometry...");

        // Clear any existing Octree data to ensure a fresh build
        if (this.worldOctree) {
            this.worldOctree.clear();
        } else {
            this.worldOctree = new OctreeV2();
        }

        // fromGraphNode now returns the allTriangles array
        const extractedTriangles = await this.worldOctree.fromGraphNode(group, onProgress);
        this.allModelTriangles = extractedTriangles; // Store the extracted triangles

        console.log("Octree built successfully.");

        // Optional: Add/Update OctreeHelper for visualization
        // if (this.octreeHelper) {
        //     this.scene.remove(this.octreeHelper);
        // }
        // this.octreeHelper = this.worldOctree.generateVisualization(0x00ff00, 4); // Example depth 4
        // this.scene.add(this.octreeHelper);
    }

    setSpeedModifier(value) {
        this.speedModifier = value;
    }

    playerCollisions() {
        const result = this.worldOctree.capsuleIntersect(this.playerCollider);

        // Reset each frame
        this.playerOnFloor = false;
        this.isGrounded = false;
        this.groundNormal.set(0, 1, 0); // Reset ground normal to default up

        if (result) {
            const normal = result.normal;
            const depth = result.depth;

            // Floor if normal is “up” enough
            this.playerOnFloor = normal.y > 0.5;
            this.isGrounded = this.playerOnFloor;

            if (this.playerOnFloor) {
                this.groundNormal.copy(normal); // Store the actual ground normal
            }

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

            // Kill tiny downward drift when grounded - This logic needs refinement for slopes
            // We want to apply gravity along the slope, not just zero out Y
            // if (this.playerOnFloor && Math.abs(this.playerVelocity.y) < 0.05) {
            //     this.playerVelocity.y = 0;
            // }
        }
    }

    updatePlayer(deltaTime) {
        let damping = Math.exp(-4 * deltaTime) - 1; // Standard damping

        if (!this.playerOnFloor) {
            // Apply gravity straight down when in the air
            this.playerVelocity.y -= GRAVITY * deltaTime;
            damping *= 0.1; // Less damping when in air
        } else {
            // **Slope Snapping Logic**
            // When on the floor, apply a component of gravity along the ground normal.
            // This pulls the player down the slope.
            const gravityComponent = _vector3.copy(this.groundNormal).multiplyScalar(-GRAVITY * deltaTime);
            this.playerVelocity.add(gravityComponent);

            // Project the velocity onto the ground plane defined by the normal.
            // This ensures movement is along the surface and prevents sinking.
            this.playerVelocity.projectOnPlane(this.groundNormal);

            // Add a small downward nudge to ensure constant contact,
            // especially on very shallow slopes or flat ground, to prevent "floating".
            // Only do this if not actively jumping or going uphill.
            if (this.groundNormal.y > 0.99) { // Close to flat ground
                if (this.playerVelocity.y < 0) { // If there's any slight downward drift
                    this.playerVelocity.y = 0; // Prevent sinking into flat ground
                }
            } else {
                // For slopes, ensure a slight downward push along the normal if not moving up
                if (this.playerVelocity.dot(this.groundNormal) > 0) {
                    // If moving "up" relative to the normal, allow it
                } else {
                    // Otherwise, ensure there's a slight downward component
                    // to keep the player "stuck" to the slope
                    this.playerVelocity.add(_vector3.copy(this.groundNormal).multiplyScalar(-0.1)); // Small constant force
                }
            }
        }

        // Apply damping to horizontal velocity (now considering the projected velocity)
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
            // When on a slope, we want to accelerate *along* the slope, not just horizontally.
            // Project the desired movement direction onto the ground normal.
            if (this.playerOnFloor) {
                moveDirection.projectOnPlane(this.groundNormal);
            }
            this.playerVelocity.add(moveDirection.multiplyScalar(effectiveAcceleration * deltaTime));
        }

        if (this.playerOnFloor) {
            if (input.jump) {
                // Apply jump velocity strictly upwards in world space, regardless of slope.
                // This gives a consistent jump height.
                this.playerVelocity.y = JUMP_VELOCITY;
                this.playerOnFloor = false; // Player is no longer on the floor after jumping
                this.isGrounded = false;
                this.jumpTriggered = true; // Set this flag when a jump is initiated
            }
        }

        // Crouch/Stand height transition
        const wantCrouch = input.crouch && this.isGrounded;
        const wantSlow = input.slow && this.isGrounded && !wantCrouch;

        this.targetHeight = wantCrouch ? CROUCH_HEIGHT : STAND_HEIGHT;

        // Smoothly interpolate height
        this.currentHeight += (this.targetHeight - this.currentHeight) * Math.min(1, CROUCH_SPEED * deltaTime);

        // Adjust collider height based on currentHeight
        this.playerCollider.end.y = this.playerCollider.start.y + (this.currentHeight - 2 * COLLIDER_RADIUS);

        // If your debug capsule mesh is active, update its scale/position here
        // if (this.debugCapsuleMesh) {
        //    // Adjust geometry size for debug mesh (CapsuleGeometry takes radius, length)
        //    // Length of the cylinder part = total height - 2 * COLLIDER_RADIUS
        //    const capsuleLength = Math.max(0, this.currentHeight - 2 * COLLIDER_RADIUS);
        //    this.debugCapsuleMesh.geometry.dispose(); // Dispose old geometry
        //    this.debugCapsuleMesh.geometry = new THREE.CapsuleGeometry(COLLIDER_RADIUS, capsuleLength, 10, 20);
        //    // Position the mesh based on the collider's bottom point (start.y)
        //    this.debugCapsuleMesh.position.copy(this.playerCollider.start);
        //    this.debugCapsuleMesh.position.y += (COLLIDER_RADIUS + capsuleLength / 2); // Center the mesh on the capsule axis
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
        this.groundNormal.set(0, 1, 0); // Reset ground normal on teleport

        // Update camera position to match the new player collider position.
        // Camera eye level is typically slightly above the capsule's start.y.
        this.camera.position.copy(this.playerCollider.start);
        this.camera.position.y += (this.currentHeight * 0.9); // 90% of current height for eye level

        this.camera.rotation.set(0, 0, 0); // Optionally reset camera rotation
        console.log(`Player and camera teleported to: (${this.camera.position.x}, ${this.camera.position.y}, ${this.camera.position.z})`);
    }

    update(deltaTime, input) {
        deltaTime = Math.min(0.05, deltaTime); // Cap deltaTime to prevent "explosions"
        // stepDt is no longer needed since STEPS_PER_FRAME is removed

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
        // console.log(speedFrac);
        // Now calling controls and updatePlayer once per frame with deltaTime
        this.controls(deltaTime, input);
        this.updatePlayer(deltaTime);
        this.teleportIfOob();

        // Landing sound logic
        if (!this.prevGround && this.isGrounded) {
            // Check if falling distance was significant before playing land sound
            if ((this.fallStartY !== null && (this.fallStartY - this.camera.position.y) > 1) || (this.jumpTriggered && (this.fallStartY - this.camera.position.y) > 1)) {
                this.landAudio.currentTime = 0;
                this.landAudio.play().catch(() => { });
                sendSoundEvent("landingThud", "land", this._pos());
            }
            this.fallStartY = null; // Reset fall start Y
            // Clear any pending fall start timer if we land
            if (this.fallStartTimer) {
                clearTimeout(this.fallStartTimer);
                this.fallStartTimer = null;
            }
        } else if (!this.isGrounded && this.fallStartY === null) {
            // If not grounded and fallStartY hasn't been set yet,
            // start a timer to set it after the delay.
            if (!this.fallStartTimer) { // Only set a new timer if one isn't already active
                this.fallStartTimer = setTimeout(() => {
                    this.fallStartY = this.camera.position.y; // Set fallStartY after delay
                //  console.log("fallStartY set after delay:", this.fallStartY);
                    this.fallStartTimer = null; // Reset the timer ID
                }, this.fallDelay);
            }
        }

        // Set camera position relative to the capsule's current height and position
        this.camera.position.x = this.playerCollider.start.x;
        this.camera.position.z = this.playerCollider.start.z;
        this.camera.position.y = this.playerCollider.start.y + (this.currentHeight * 0.9); // 90% of current height for eye level

        // **NEW: Apply feet/model rotation if grounded**
        if (this.isGrounded && this.playerModel) {
            const smoothingFactor = 0.15; // Adjust for faster/slower rotation (0-1)

            const playerWorldForward = new THREE.Vector3();
            this.camera.getWorldDirection(playerWorldForward); // Get camera's forward
            playerWorldForward.y = 0; // Flatten it to horizontal
            playerWorldForward.normalize();

            // Calculate the 'right' vector, ensuring it's perpendicular to both current forward and ground normal
            const playerWorldRight = new THREE.Vector3().crossVectors(playerWorldForward, this.groundNormal).normalize();
            
            // Calculate the 'forward' vector that is perpendicular to the ground normal and the new right vector
            const finalForward = new THREE.Vector3().crossVectors(this.groundNormal, playerWorldRight).normalize();
            
            const orientationMatrix = new THREE.Matrix4();
            // makeBasis takes (xAxis, yAxis, zAxis) - which correspond to (right, up, forward) for the player model
            orientationMatrix.makeBasis(playerWorldRight, this.groundNormal, finalForward); 
            
            const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(orientationMatrix);

            // Smoothly interpolate the player model's quaternion
            this.playerModel.quaternion.slerp(targetQuaternion, smoothingFactor);
        } else if (this.playerModel) {
            // If not grounded, smoothly return to upright (or keep previous rotation)
            // This prevents the model from staying tilted after leaving a slope.
            // You might want to remove this if you want the player model to tilt in air.
            const upAlignmentQuaternion = new THREE.Quaternion();
            upAlignmentQuaternion.setFromUnitVectors(this.playerModel.up, new THREE.Vector3(0, 1, 0));
            this.playerModel.quaternion.slerp(upAlignmentQuaternion, 0.05); // Slower return to upright
        }


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

    _pos() {
        const p = this.camera.position;
        return { x: p.x, y: p.y, z: p.z };
    }
}
