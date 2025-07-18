import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.152.0/build/three.module.js";
import { MeshBVH, acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.9.1/+esm";
import { Capsule } from "three/examples/jsm/math/Capsule.js";
import { sendSoundEvent } from "./network.js"; // Ensure this path is correct for your project

// Extend Three.js geometries and meshes for BVH
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// Physics and Player Constants
const PLAYER_MASS = 70; // Mass (though not directly used for movement here, useful for reference)
const STAND_HEIGHT = 2.2;
const CROUCH_HEIGHT = 1.0;
const COLLIDER_RADIUS = 0.35;
const JUMP_VELOCITY = 12.3;
const GRAVITY = 27.5; // Strength of gravity
const CROUCH_SPEED = 8; // How fast player crouches/stands
const FOOT_DISABLED_THRESHOLD = 0.2; // Minimum speed for footsteps
const PLAYER_ACCEL_GROUND = 25; // Acceleration on ground
const PLAYER_ACCEL_AIR = 8;     // Acceleration in air (less control)
const MAX_SPEED = 10;           // Maximum horizontal speed

// Collision Skin: A tiny buffer to prevent repeated penetration and jittering.
// This is crucial for stable collision resolution.
const SKIN = 0.005; // Adjust slightly (e.g., 0.001 to 0.01) if jittering persists.

// Reusable temporary vectors and matrices to minimize allocations per frame
const _vector1 = new THREE.Vector3();
const _vector2 = new THREE.Vector3();
const _vector3 = new THREE.Vector3();
const _tmpBox = new THREE.Box3(); // Represents the player's collision volume in World Space
const _tmpMat = new THREE.Matrix4(); // General purpose temporary matrix
const _tmpInverseMat = new THREE.Matrix4(); // Temporary matrix for inverse operations
const _tmpLocalBox = new THREE.Box3(); // Temporary box for local BVH node bounds in World Space (transformed to world)
const _tempSegment = new THREE.Line3(); // Temporary line for capsule segment in mesh local space
const _upVector = new THREE.Vector3(0, 1, 0); // Global up direction
const _tempCapsule = new Capsule(); // For the sticky ground check
const _testBox = new THREE.Box3(); // For the sticky ground check's broad-phase

export class PhysicsController {
    constructor(camera, scene, playerModel = null) {
        this.camera = camera;
        this.scene = scene;
        this.playerModel = playerModel;

        // Player's collision capsule
        this.playerCollider = new Capsule(
            new THREE.Vector3(0, COLLIDER_RADIUS, 0), // Start point (bottom sphere center)
            new THREE.Vector3(0, STAND_HEIGHT - COLLIDER_RADIUS, 0), // End point (top sphere center)
            COLLIDER_RADIUS // Radius of the capsule
        );

        // Player physics state variables
        this.playerVelocity = new THREE.Vector3();
        this.playerDirection = new THREE.Vector3(); // Reusable for camera direction
        this.playerOnFloor = false; // Internal flag for collision logic
        this.isGrounded = false;    // Primary state for external game logic (e.g., can jump?)
        this.groundNormal = new THREE.Vector3(0, 1, 0); // Normal of the surface player is on
        this.bvhMeshes = []; // Array to store meshes with BVHs for collision detection

        // Input state flags (should be updated externally, e.g., from your main loop)
        this.fwdPressed = false;
        this.bkdPressed = false;
        this.lftPressed = false;
        this.rgtPressed = false;
        this.jumpPressed = false;
        this.crouchPressed = false;
        this.slowPressed = false;
        this.isAim = false; // Set externally by your game's aiming state

        // Mouse lock setup (standard for FPS controls)
        const container = document.getElementById('container') || document.body;
        container.addEventListener('mousedown', () => {
            document.body.requestPointerLock();
            this.mouseTime = performance.now(); // Not directly used in physics, but kept for context
        });
        this.camera.rotation.order = 'YXZ'; // Essential for correct camera rotation

        // Audio related properties
        this.footAudios = [
            new Audio("https://codehs.com/uploads/29c8a5da333b3fd36dc9681a4a8ec865"),
            new Audio("https://codehs.com/uploads/616ef1b61061008f9993d1ab4fa323ba")
        ];
        this.footAudios.forEach(audio => audio.volume = 0.7);
        this.footIndex = 0;
        this.footAcc = 0; // Accumulator for footstep timing
        this.baseFootInterval = 3; // Base time between footstep sounds
        this.landAudio = new Audio("https://codehs.com/uploads/600ab769d99d74647db55a468b19761f");
        this.landAudio.volume = 0.8;
        this.fallStartY = null; // Y position when player starts falling
        this.fallStartTimer = null; // Timer to debounce fall start
        this.prevGround = false; // To detect landing transition
        this.fallDelay = 300; // Delay before considering a fall as started (ms)

        // Movement state modifiers
        this.jumpTriggered = false; // Flag to indicate if jump was just pressed
        this.speedModifier = 1; // General speed multiplier
        this.currentHeight = STAND_HEIGHT; // Current height of the capsule (for crouching)
        this.targetHeight = STAND_HEIGHT; // Desired height (stand or crouch)

        // Initial console logs for debugging collider
        console.log("PhysicsController initialized. playerCollider:", this.playerCollider);
        if (!this.playerCollider.start || !this.playerCollider.end) {
            console.error("ERROR: playerCollider.start or playerCollider.end is undefined in constructor!");
        }
    }

    setSpeedModifier(value) {
        this.speedModifier = value;
    }

    setIsAim(value) {
        this.isAim = value;
    }

    // Builds BVH for all meshes in a given group
    async buildBVH(group, onProgress = () => {}) {
        this.bvhMeshes = [];
        let total = 0, loaded = 0;
        group.traverse(node => {
            if (node.isMesh && node.geometry.isBufferGeometry) total++;
        });
        group.traverse(node => {
            if (!node.isMesh || !node.geometry.isBufferGeometry) return;
            // Ensure geometry has indices for BVH to work correctly
            if (!node.geometry.index) {
                const count = node.geometry.attributes.position.count;
                const idx = new Array(count).fill(0).map((_, i) => i);
                node.geometry.setIndex(idx);
            }
            node.geometry.boundsTree = new MeshBVH(node.geometry, { lazyGeneration: false });
            this.bvhMeshes.push(node);
            loaded++;
            onProgress({ loaded, total });
        });
    }

    // Handles core physics updates including gravity, movement, and collision resolution
    updatePlayer(deltaTime) {
        // If no BVH meshes are loaded, perform basic movement without collision
        if (this.bvhMeshes.length === 0) {
            this.playerVelocity.y += deltaTime * -GRAVITY;
            const deltaPosition = _vector3.copy(this.playerVelocity).multiplyScalar(deltaTime);
            this.playerCollider.start.add(deltaPosition);
            this.playerCollider.end.add(deltaPosition);

            // Apply basic input movement even without BVH for responsiveness
            const angle = this.camera.rotation.y;
            let currentSpeedModifier = this.speedModifier;
            if (this.crouchPressed) currentSpeedModifier *= 0.3;
            else if (this.slowPressed) currentSpeedModifier *= 0.5;
            else if (this.isAim) currentSpeedModifier *= 0.65;
            const effectiveAccel = PLAYER_ACCEL_GROUND * currentSpeedModifier; // Use ground accel as fallback

            if (this.fwdPressed) {
                _vector1.set(0, 0, -1).applyAxisAngle(_upVector, angle);
                this.playerCollider.start.addScaledVector(_vector1, effectiveAccel * deltaTime);
                this.playerCollider.end.addScaledVector(_vector1, effectiveAccel * deltaTime);
            }
            if (this.bkdPressed) {
                _vector1.set(0, 0, 1).applyAxisAngle(_upVector, angle);
                this.playerCollider.start.addScaledVector(_vector1, effectiveAccel * deltaTime);
                this.playerCollider.end.addScaledVector(_vector1, effectiveAccel * deltaTime);
            }
            if (this.lftPressed) {
                _vector1.set(-1, 0, 0).applyAxisAngle(_upVector, angle);
                this.playerCollider.start.addScaledVector(_vector1, effectiveAccel * deltaTime);
                this.playerCollider.end.addScaledVector(_vector1, effectiveAccel * deltaTime);
            }
            if (this.rgtPressed) {
                _vector1.set(1, 0, 0).applyAxisAngle(_upVector, angle);
                this.playerCollider.start.addScaledVector(_vector1, effectiveAccel * deltaTime);
                this.playerCollider.end.addScaledVector(_vector1, effectiveAccel * deltaTime);
            }

            // Simple damping
            if (! (this.fwdPressed || this.bkdPressed || this.lftPressed || this.rgtPressed) && !this.playerOnFloor) {
                this.playerVelocity.x *= Math.exp(-4 * deltaTime);
                this.playerVelocity.z *= Math.exp(-4 * deltaTime);
            }
            // Out of bounds check without collision
            if (this.playerCollider.end.y < -25) {
                this.setPlayerPosition(new THREE.Vector3(0, 5, 0));
                this.playerVelocity.set(0, 0, 0);
            }
            return; // Exit, as BVH-based collisions cannot be performed
        }

        // --- Start of Core Physics Logic with BVH ---

        // 1. Apply Gravity: Always apply gravity.
        this.playerVelocity.y += deltaTime * -GRAVITY;

        // 2. Predict next position based on current velocity (in a temporary capsule)
        const currentCapsule = this.playerCollider.clone(); // Clone to prevent modifying actual collider until resolved
        const deltaPosition = _vector3.copy(this.playerVelocity).multiplyScalar(deltaTime);
        currentCapsule.start.add(deltaPosition);
        currentCapsule.end.add(deltaPosition);

        // 3. Prepare Broad-Phase Bounding Box for the predicted capsule position
        // This is used to quickly cull BVH nodes that are definitely not intersecting.
        _tmpBox.makeEmpty();
        _tmpBox.expandByPoint(currentCapsule.start);
        _tmpBox.expandByPoint(currentCapsule.end);
        _tmpBox.min.addScalar(-COLLIDER_RADIUS);
        _tmpBox.max.addScalar(COLLIDER_RADIUS);

        // 4. Reset collision state for the current frame/physics step
        this.playerOnFloor = false; // Internal flag, can be kept for clarity or eventually removed
        this.isGrounded = false;    // Crucial: Assume not grounded at start of step
        this.groundNormal.set(0, 1, 0); // Reset ground normal

        let bestCollisionNormal = new THREE.Vector3(); // Stores the normal of the deepest collision
        let collisionDepth = 0;                       // Stores the depth of the deepest penetration
        let collisionDetected = false;                // Flag for any collision

        // 5. Iterate through BVH-enabled meshes and perform shapecast (collision detection)
        for (const mesh of this.bvhMeshes) {
            // Get the inverse world matrix for this specific mesh once per mesh
            _tmpInverseMat.copy(mesh.matrixWorld).invert();

            // Transform the capsule segment into the mesh's local space for shapecast
            _vector1.copy(currentCapsule.start).applyMatrix4(_tmpInverseMat);
            _vector2.copy(currentCapsule.end).applyMatrix4(_tmpInverseMat);
            _tempSegment.set(_vector1, _vector2); // The capsule segment in mesh's local space

            mesh.geometry.boundsTree.shapecast({
                // Broad-phase check: Does the BVH node's world-space bounding box intersect the player's world-space bounding box?
                intersectsBounds: box => {
                    _tmpLocalBox.copy(box).applyMatrix4(mesh.matrixWorld); // Transform BVH node box to world space
                    return _tmpLocalBox.intersectsBox(_tmpBox); // Compare with player's world-space box
                },
                // Narrow-phase check: Does the capsule segment intersect a specific triangle within the BVH node?
                intersectsTriangle: tri => {
                    const triPoint = _vector1; // Re-use for triangle closest point
                    const capsulePoint = _vector2; // Re-use for capsule closest point

                    // Find the closest points between the capsule segment and the triangle
                    const distance = tri.closestPointToSegment(_tempSegment, triPoint, capsulePoint);

                    // If distance is less than collider radius, there's a penetration
                    if (distance < COLLIDER_RADIUS) {
                        const currentDepth = COLLIDER_RADIUS - distance; // Calculate penetration depth
                        const currentNormal = capsulePoint.sub(triPoint).normalize(); // Normal pointing from triangle to capsule

                        // Keep track of the deepest penetration and its normal
                        if (currentDepth > collisionDepth) {
                            collisionDepth = currentDepth;
                            bestCollisionNormal.copy(currentNormal);
                            collisionDetected = true;
                        }
                    }
                }
            });
        }

        // 6. Collision Resolution (if any collisions were detected)
        if (collisionDetected) {
            // Transform the bestCollisionNormal back into world space
            if (this.bvhMeshes.length > 0) {
                bestCollisionNormal.transformDirection(this.bvhMeshes[0].matrixWorld);
            }

            // Apply displacement to move player out of penetration
            if (collisionDepth > 0) {
                 // Calculate the exact amount to push the player out.
                 // We want to be SKIN units away from the surface.
                 const displacementAmount = collisionDepth - SKIN;
                 if (displacementAmount > 0) { // Only apply if we are penetrating more than our SKIN buffer
                     const displacement = _vector3.copy(bestCollisionNormal).multiplyScalar(displacementAmount);
                     this.playerCollider.start.add(displacement);
                     this.playerCollider.end.add(displacement);
                 }
            }

            // 7. Determine Grounded State and Adjust Velocity
            // If the collision normal points mostly upwards (dot product with _upVector > 0.75), we consider it ground.
            if (bestCollisionNormal.dot(_upVector) > 0.75) {
                this.playerOnFloor = true; // Set internal flag
                this.isGrounded = true;   // Set primary grounded flag
                this.groundNormal.copy(bestCollisionNormal); // Store ground normal

                // Crucial for stability: If grounded and player has any upward velocity, kill it.
                // This prevents "bouncing" or flickering between airborne/grounded.
                if (this.playerVelocity.y > 0) {
                    this.playerVelocity.y = 0;
                }
                // Project horizontal velocity onto the ground plane to allow sliding
                this.playerVelocity.projectOnPlane(this.groundNormal);
            } else {
                // If it's a wall or ceiling collision, adjust velocity to stop movement into the obstacle.
                const dot = this.playerVelocity.dot(bestCollisionNormal);
                if (dot < 0) { // Only if moving towards the obstacle (negative dot product)
                    this.playerVelocity.addScaledVector(bestCollisionNormal, -dot); // Zero out velocity component in normal's direction
                }
            }
        }

        // NEW: Robust Grounding Check (to prevent flickering, especially during crouch)
        // If the player was grounded in the previous frame, but no ground collision was detected in this frame's main pass,
        // perform a small downward check to see if they are still very close to the ground.
        if (this.prevGround && !this.isGrounded) {
            _tempCapsule.copy(this.playerCollider);
            _tempCapsule.start.y -= 0.05; // Small downward shift to check slightly below
            _tempCapsule.end.y -= 0.05;

            _testBox.makeEmpty();
            _testBox.expandByPoint(_tempCapsule.start);
            _testBox.expandByPoint(_tempCapsule.end);
            _testBox.min.addScalar(-COLLIDER_RADIUS);
            _testBox.max.addScalar(COLLIDER_RADIUS);

            let foundGroundNear = false;
            for (const mesh of this.bvhMeshes) {
                _tmpInverseMat.copy(mesh.matrixWorld).invert();
                _vector1.copy(_tempCapsule.start).applyMatrix4(_tmpInverseMat);
                _vector2.copy(_tempCapsule.end).applyMatrix4(_tmpInverseMat);
                _tempSegment.set(_vector1, _vector2);

                mesh.geometry.boundsTree.shapecast({
                    intersectsBounds: box => {
                        _tmpLocalBox.copy(box).applyMatrix4(mesh.matrixWorld);
                        return _tmpLocalBox.intersectsBox(_testBox);
                    },
                    intersectsTriangle: tri => {
                        const triPoint = _vector1;
                        const capsulePoint = _vector2;
                        const distance = tri.closestPointToSegment(_tempSegment, triPoint, capsulePoint);

                        if (distance < COLLIDER_RADIUS) {
                            const currentNormal = capsulePoint.sub(triPoint).normalize();
                            // Only consider it ground if the normal is pointing significantly upwards
                            if (currentNormal.dot(_upVector) > 0.75) {
                                foundGroundNear = true;
                                return true; // Stop searching for this mesh
                            }
                        }
                    }
                });
                if (foundGroundNear) break; // Stop searching all meshes
            }

            if (foundGroundNear) {
                this.isGrounded = true;
            }
        }

        // NEW: Apply glue force only if player is determined to be grounded (either by main collision or sticky check)
        if (this.isGrounded) {
            this.playerVelocity.y = -0.01;
        }

        // 8. Out of Bounds Teleport (after all physics steps are done)
        if (this.playerCollider.end.y < -25) {
            this.setPlayerPosition(new THREE.Vector3(0, 5, 0));
            this.playerVelocity.set(0, 0, 0);
            this.playerOnFloor = false;
            this.isGrounded = false;
        }
    }

    // Helper to get forward vector based on camera direction
    getForwardVector() {
        this.camera.getWorldDirection(this.playerDirection);
        this.playerDirection.y = 0; // Flatten to horizontal plane
        this.playerDirection.normalize();
        return this.playerDirection;
    }

    // Helper to get side (right) vector based on camera direction
    getSideVector() {
        this.camera.getWorldDirection(this.playerDirection);
        this.playerDirection.y = 0; // Flatten to horizontal plane
        this.playerDirection.normalize();
        this.playerDirection.cross(this.camera.up); // Cross with camera.up to get right vector
        return this.playerDirection;
    }

    // Processes player input and updates player velocity
    controls(deltaTime, input) {
        // Update internal state from input object
        this.fwdPressed = input.forward;
        this.bkdPressed = input.backward;
        this.lftPressed = input.left;
        this.rgtPressed = input.right;
        this.jumpPressed = input.jump;
        this.crouchPressed = input.crouch;
        this.slowPressed = input.slow;

        // Calculate current speed modifier based on player actions
        let currentSpeedModifier = this.speedModifier;
        if (this.crouchPressed) {
            currentSpeedModifier *= 0.3;
        } else if (this.slowPressed) {
            currentSpeedModifier *= 0.5;
        } else if (this.isAim) {
            currentSpeedModifier *= 0.65;
        }

        // Determine acceleration based on grounded state
        const accel = this.isGrounded ? PLAYER_ACCEL_GROUND : PLAYER_ACCEL_AIR;
        const effectiveAccel = accel * currentSpeedModifier;

        const angle = this.camera.rotation.y; // Camera's horizontal rotation (yaw)

        // Apply acceleration based on input and camera orientation
        if (this.fwdPressed) {
            _vector1.set(0, 0, -1).applyAxisAngle(_upVector, angle);
            this.playerVelocity.addScaledVector(_vector1, effectiveAccel * deltaTime);
        }
        if (this.bkdPressed) {
            _vector1.set(0, 0, 1).applyAxisAngle(_upVector, angle);
            this.playerVelocity.addScaledVector(_vector1, effectiveAccel * deltaTime);
        }
        if (this.lftPressed) {
            _vector1.set(-1, 0, 0).applyAxisAngle(_upVector, angle);
            this.playerVelocity.addScaledVector(_vector1, effectiveAccel * deltaTime);
        }
        if (this.rgtPressed) {
            _vector1.set(1, 0, 0).applyAxisAngle(_upVector, angle);
            this.playerVelocity.addScaledVector(_vector1, effectiveAccel * deltaTime);
        }

        // Limit horizontal speed
        const hSpeed = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
        if (hSpeed > MAX_SPEED) {
            const ratio = MAX_SPEED / hSpeed;
            this.playerVelocity.x *= ratio;
            this.playerVelocity.z *= ratio;
        }

        // Apply horizontal damping (friction/drag)
        if (!(this.fwdPressed || this.bkdPressed || this.lftPressed || this.rgtPressed) && this.isGrounded) {
            this.playerVelocity.x *= Math.exp(-6 * deltaTime); // Faster damping on ground
            this.playerVelocity.z *= Math.exp(-6 * deltaTime);
        }
        else if (!this.isGrounded) {
            this.playerVelocity.x *= Math.exp(-0.5 * deltaTime); // Slower damping in air
            this.playerVelocity.z *= Math.exp(-0.5 * deltaTime);
        }

        // Jump logic
        if (this.isGrounded && this.jumpPressed) {
            this.playerVelocity.y = JUMP_VELOCITY;
            this.playerOnFloor = false; // Reset temporary flag
            this.isGrounded = false;    // Player is now airborne
            this.jumpTriggered = true;  // For jump animation/sound
        } else {
            this.jumpTriggered = false;
        }

        // Crouch/Stand transition logic
        const wantCrouch = this.crouchPressed && this.isGrounded;
        this.targetHeight = wantCrouch ? CROUCH_HEIGHT : STAND_HEIGHT;
        // Smoothly interpolate current height towards target height
        this.currentHeight += (this.targetHeight - this.currentHeight) *
            Math.min(1, CROUCH_SPEED * deltaTime);

        // Update the collider's top point based on current height
        if (!this.playerCollider || !this.playerCollider.start || !this.playerCollider.end) {
            console.error("ERROR: playerCollider or its start/end points are undefined before updating end.y in controls!");
            return;
        }
        this.playerCollider.end.y = this.playerCollider.start.y +
            (this.currentHeight - 2 * COLLIDER_RADIUS); // Adjust end point based on new height
    }

    // Teleports the player to a new position, resetting velocity and state
    setPlayerPosition(position) {
        if (!this.playerCollider) {
            console.error("ERROR: playerCollider is undefined in setPlayerPosition!");
            return;
        }

        const spawnY = position.y + COLLIDER_RADIUS + 0.1; // Add buffer to avoid immediate collision
        this.playerCollider.start.set(position.x, spawnY, position.z);
        this.playerCollider.end.set(
            position.x,
            spawnY + (this.currentHeight - 2 * COLLIDER_RADIUS),
            position.z
        );
        this.playerVelocity.set(0, 0, 0); // Stop all movement
        this.playerOnFloor = false;
        this.isGrounded = false;
        this.jumpTriggered = false;
        this.fallStartY = null;
        this.groundNormal.set(0, 1, 0);

        // Immediately update camera position to new player position
        this.camera.position.copy(this.playerCollider.start);
        this.camera.position.y += this.currentHeight * 0.9; // Camera at eye level
        this.camera.rotation.set(0, 0, 0); // Reset camera rotation
    }

    // Main update loop for the physics controller, called once per game frame
    update(deltaTime, input) {
        // Cap delta time to prevent large steps leading to tunneling through geometry
        deltaTime = Math.min(0.05, deltaTime);
        this.prevGround = this.isGrounded; // Store previous grounded state for landing detection

        // Footstep audio logic
        const speedXZ = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
        if (speedXZ > FOOT_DISABLED_THRESHOLD && this.isGrounded && !input.slow && !input.crouch) {
            const interval = this.baseFootInterval / speedXZ;
            this.footAcc += deltaTime;
            if (this.footAcc >= interval) {
                this.footAcc -= interval;
                const audio = this.footAudios[this.footIndex];
                audio.currentTime = 0;
                audio.play().catch(() => {}); // Prevent errors if audio fails to play
                sendSoundEvent("footstep", "run", this._pos());
                this.footIndex = 1 - this.footIndex;
            }
        } else if (this.isGrounded && speedXZ <= FOOT_DISABLED_THRESHOLD) {
            this.footAcc = 0; // Reset footstep accumulator if standing still
        }

        // Process player input and update collider height based on crouching/standing
        this.controls(deltaTime, input);

        // Apply physics in fixed steps to improve stability and consistency
        const physicsSteps = 5; // More steps = more precision, but more CPU. Good balance.
        for (let i = 0; i < physicsSteps; i++) {
            this.updatePlayer(deltaTime / physicsSteps); // Divide delta time for each sub-step
        }

        // Landing audio logic: Detect transition from not grounded to grounded
        if (!this.prevGround && this.isGrounded) {
            const fellFar = this.fallStartY !== null && (this.fallStartY - this.camera.position.y) > 1; // Check if significant fall
            if (fellFar) {
                this.landAudio.currentTime = 0;
                this.landAudio.play().catch(() => {});
                sendSoundEvent("landingThud", "land", this._pos());
            }
            this.fallStartY = null; // Reset fall start if landed
            if (this.fallStartTimer) {
                clearTimeout(this.fallStartTimer);
                this.fallStartTimer = null;
            }
        } else if (!this.isGrounded && this.fallStartY === null && this.playerVelocity.y < 0) { // If now airborne and truly falling
            if (!this.fallStartTimer) {
                this.fallStartTimer = setTimeout(() => {
                    this.fallStartY = this.camera.position.y;
                    this.fallStartTimer = null;
                }, this.fallDelay);
            }
        } else if (this.isGrounded && this.fallStartY !== null) { // If player became grounded before fall timer or without true fall
             this.fallStartY = null;
             if (this.fallStartTimer) {
                 clearTimeout(this.fallStartTimer);
                 this.fallStartTimer = null;
             }
        }


        // Update camera position to follow the player collider's base
        if (!this.playerCollider || !this.playerCollider.start) {
            console.error("ERROR: playerCollider or its start point is undefined before camera position update!");
            return {
                x: 0, y: 0, z: 0, rotY: 0, isGrounded: false, velocity: new THREE.Vector3(), velocityY: 0
            };
        }
        this.camera.position.x = this.playerCollider.start.x;
        this.camera.position.z = this.playerCollider.start.z;
        this.camera.position.y = this.playerCollider.start.y + this.currentHeight * 0.9; // Keep camera at eye level

        // Optional: Update player model position and rotation (if you have one)
        if (this.playerModel) {
            if (this.isGrounded) {
                // Orient player model to face forward along the ground normal
                const forward = _vector1;
                this.camera.getWorldDirection(forward);
                forward.y = 0; forward.normalize();
                const right = _vector2.crossVectors(forward, this.groundNormal).normalize();
                const finalFwd = _vector3.crossVectors(this.groundNormal, right).normalize();
                const mat = new THREE.Matrix4().makeBasis(right, this.groundNormal, finalFwd);
                const targetQ = new THREE.Quaternion().setFromRotationMatrix(mat);
                this.playerModel.quaternion.slerp(targetQ, 0.15); // Smooth slerp
            } else {
                // When airborne, try to keep player model upright
                const upQ = new THREE.Quaternion().setFromUnitVectors(this.playerModel.up, new THREE.Vector3(0, 1, 0));
                this.playerModel.quaternion.slerp(upQ, 0.05);
            }
            this.playerModel.position.copy(this.playerCollider.start);
            this.playerModel.position.y -= COLLIDER_RADIUS; // Adjust model position to sit on collider base
        }

        // Return current player state for external use (e.g., UI, network sync)
        return {
            x: this.camera.position.x,
            y: this.camera.position.y,
            z: this.camera.position.z,
            rotY: this.camera.rotation.y,
            isGrounded: this.isGrounded,
            velocity: this.playerVelocity.clone(), // Return a copy
            velocityY: this.playerVelocity.y
        };
    }

    // Helper for sending sound events (gets current player position)
    _pos() {
        const p = this.camera.position;
        return { x: p.x, y: p.y, z: p.z };
    }
}
