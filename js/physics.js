import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.152.0/build/three.module.js";
// Import BVH components directly from three-mesh-bvh
import { MeshBVH, acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.9.1/+esm";
import { Capsule } from "three/examples/jsm/math/Capsule.js";
import { sendSoundEvent } from "./network.js"; // Your existing network import

// Ensure Three.js prototypes are patched for BVH
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// Your existing physics constants
const PLAYER_MASS = 70;
const STAND_HEIGHT = 2.2;
const CROUCH_HEIGHT = 1.0;
const COLLIDER_RADIUS = 0.35;
const JUMP_VELOCITY = 12.3;
const GRAVITY = 27.5; // This is a positive value, your updatePlayer subtracts it.
const CROUCH_SPEED = 8;
const FOOT_DISABLED_THRESHOLD = 0.2;
const PLAYER_ACCEL_GROUND = 25;
const PLAYER_ACCEL_AIR = 8;
const MAX_SPEED = 10;

// Your existing temporary vectors. Map to the example's obfuscated temps:
// w in example -> _vector1 (for triPoint/tempVector)
// L in example -> _vector2 (for capsulePoint/tempVector2)
// M in example -> _tmpBox
// A in example -> _tmpMat (collider.matrixWorld.invert())
// y in example -> _tempSegment (the player's capsule segment)
const _vector1 = new THREE.Vector3(); // Replaces 'w' when used as triPoint / tempVector
const _vector2 = new THREE.Vector3(); // Replaces 'L' when used as capsulePoint / tempVector2
const _vector3 = new THREE.Vector3(); // General purpose, like your existing use
const _tmpBox = new THREE.Box3(); // Replaces 'M'
const _tmpMat = new THREE.Matrix4(); // Replaces 'A'
const _tempSegment = new THREE.Line3(); // Replaces 'y'

// The example uses 'k' for `new P(0,1,0)`, which is a simple up vector.
// Your code currently derives playerDirection from camera, but for capsule adjustments
// we'll explicitly use a standard up vector or the ground normal.
const _upVector = new THREE.Vector3(0, 1, 0); // Corresponds to 'k' in example

export class PhysicsController {
    constructor(camera, scene, playerModel = null) {
        this.camera = camera;
        this.scene = scene;
        this.playerModel = playerModel;

        this.playerCollider = new Capsule(
            new THREE.Vector3(0, COLLIDER_RADIUS, 0),
            new THREE.Vector3(0, STAND_HEIGHT - COLLIDER_RADIUS, 0),
            COLLIDER_RADIUS
        );

        this.playerVelocity = new THREE.Vector3(); // Corresponds to 'h' in example
        this.playerDirection = new THREE.Vector3();
        this.playerOnFloor = false; // Corresponds to 'C' in example (playerIsOnGround)
        this.isGrounded = false;     // Your existing `isGrounded`
        this.groundNormal = new THREE.Vector3(0, 1, 0);
        this.bvhMeshes = []; // Array to hold meshes with BVH from map.js
        this.mouseTime = 0;

        // Input states (corresponds to z, B, D, H in example)
        this.fwdPressed = false;
        this.bkdPressed = false;
        this.lftPressed = false;
        this.rgtPressed = false;
        this.jumpPressed = false; // For spacebar logic

        const container = document.getElementById('container') || document.body;
        container.addEventListener('mousedown', () => {
            document.body.requestPointerLock();
            this.mouseTime = performance.now();
        });
        this.camera.rotation.order = 'YXZ'; // Keep your camera rotation order

        this.footAudios = [
            new Audio("https://codehs.com/uploads/29c8a5da333b3fd36dc9681a4a8ec865"),
            new Audio("https://codehs.com/uploads/616ef1b61061008f9993d1ab4fa323ba")
        ];
        this.footAudios.forEach(audio => audio.volume = 0.7);
        this.footIndex = 0;
        this.footAcc = 0;
        this.baseFootInterval = 3;
        this.landAudio = new Audio("https://codehs.com/uploads/600ab769d99d74647db55a468b19761f");
        this.landAudio.volume = 0.8;
        this.fallStartY = null;
        this.fallStartTimer = null;
        this.prevGround = false;
        this.jumpTriggered = false;
        this.speedModifier = 0;
        this.isAim = false;
        this.currentHeight = STAND_HEIGHT;
        this.targetHeight = STAND_HEIGHT;
        this.fallDelay = 300;

        // Initialize key event listeners
        window.addEventListener('keydown', (e) => this.handleKeyDown(e));
        window.addEventListener('keyup', (e) => this.handleKeyUp(e));

        // Debugging: Verify initial playerCollider state
        console.log("PhysicsController initialized. playerCollider:", this.playerCollider);
        if (!this.playerCollider.start || !this.playerCollider.end) {
            console.error("ERROR: playerCollider.start or playerCollider.end is undefined in constructor!");
        }
    }

    setSpeedModifier(value) {
        this.speedModifier = value;
    }

    // Handles key presses, setting the internal movement flags
    handleKeyDown(e) {
        switch (e.code) {
            case 'KeyW': this.fwdPressed = true; break;
            case 'KeyS': this.bkdPressed = true; break;
            case 'KeyD': this.rgtPressed = true; break;
            case 'KeyA': this.lftPressed = true; break;
            case 'Space':
                if (this.playerOnFloor) { // Use your playerOnFloor
                    this.playerVelocity.y = JUMP_VELOCITY; // Use your JUMP_VELOCITY
                    this.playerOnFloor = false;
                    this.jumpTriggered = true; // Your existing jumpTriggered
                }
                break;
        }
    }

    // Handles key releases, clearing the internal movement flags
    handleKeyUp(e) {
        switch (e.code) {
            case 'KeyW': this.fwdPressed = false; break;
            case 'KeyS': this.bkdPressed = false; break;
            case 'KeyD': this.rgtPressed = false; break;
            case 'KeyA': this.lftPressed = false; break;
        }
    }

    async buildBVH(group, onProgress = () => {}) {
        this.bvhMeshes = [];
        let total = 0, loaded = 0;
        group.traverse(node => {
            if (node.isMesh && node.geometry.isBufferGeometry) total++;
        });
        group.traverse(node => {
            if (!node.isMesh || !node.geometry.isBufferGeometry) return;
            // The map.js already handles setting the index if missing, but no harm in double-checking
            if (!node.geometry.index) {
                const count = node.geometry.attributes.position.count;
                const idx = new Array(count).fill(0).map((_, i) => i);
                node.geometry.setIndex(idx);
            }
            node.geometry.boundsTree = new MeshBVH(node.geometry, { lazyGeneration: false });
            this.bvhMeshes.push(node); // Store meshes with BVH for shapecast
            loaded++;
            onProgress({ loaded, total });
        });
    }

    // This is the core `updatePlayer` logic, now directly adapted from the example's `pe(l)` function.
    updatePlayer(deltaTime) { // 'l' in the example
        // 1. Apply gravity to playerVelocity (corresponds to `h.y = l * a.gravity` or `h.y += l * a.gravity`)
        if (this.playerOnFloor) { // Corresponds to `C`
            this.playerVelocity.y = deltaTime * -GRAVITY; // Gravity constant is positive in your code, so subtract
        } else {
            this.playerVelocity.y += deltaTime * -GRAVITY;
        }

        // 2. Apply current playerVelocity to player's position (corresponds to `e.position.addScaledVector(h, l)`)
        // The example applies velocity directly to the player.position.
        // We'll apply it to the playerCollider's segment points.
        // First, apply to the playerCollider.start and end directly, before collision resolution.
        const prevColliderStart = this.playerCollider.start.clone();
        const prevColliderEnd = this.playerCollider.end.clone();

        const moveAmount = _vector3.copy(this.playerVelocity).multiplyScalar(deltaTime);
        this.playerCollider.start.add(moveAmount);
        this.playerCollider.end.add(moveAmount);


        // 3. Handle player movement based on input (corresponds to z,B,D,H,w,t,a.playerSpeed,l)
        const angle = this.camera.rotation.y; // Using camera rotation directly as OrbitControls isn't used
        // w.set(0, 0, -1).applyAxisAngle(k, t) => _vector1.set(0, 0, -1).applyAxisAngle(_upVector, angle)
        // This is for calculating movement direction from camera angle.
        if (this.fwdPressed) {
            _vector1.set(0, 0, -1).applyAxisAngle(_upVector, angle);
            this.playerCollider.start.addScaledVector(_vector1, PLAYER_ACCEL_GROUND * deltaTime); // Using PLAYER_ACCEL_GROUND as a base speed here
            this.playerCollider.end.addScaledVector(_vector1, PLAYER_ACCEL_GROUND * deltaTime);
        }
        if (this.bkdPressed) {
            _vector1.set(0, 0, 1).applyAxisAngle(_upVector, angle);
            this.playerCollider.start.addScaledVector(_vector1, PLAYER_ACCEL_GROUND * deltaTime);
            this.playerCollider.end.addScaledVector(_vector1, PLAYER_ACCEL_GROUND * deltaTime);
        }
        if (this.lftPressed) {
            _vector1.set(-1, 0, 0).applyAxisAngle(_upVector, angle);
            this.playerCollider.start.addScaledVector(_vector1, PLAYER_ACCEL_GROUND * deltaTime);
            this.playerCollider.end.addScaledVector(_vector1, PLAYER_ACCEL_GROUND * deltaTime);
        }
        if (this.rgtPressed) {
            _vector1.set(1, 0, 0).applyAxisAngle(_upVector, angle);
            this.playerCollider.start.addScaledVector(_vector1, PLAYER_ACCEL_GROUND * deltaTime);
            this.playerCollider.end.addScaledVector(_vector1, PLAYER_ACCEL_GROUND * deltaTime);
        }

        // NOTE: The example's `playerSpeed` and `gravity` interaction with `playerVelocity` is a bit different
        // from your `controls` function. We need to reconcile this.
        // The example directly adds movement based on input to player.position.
        // Your `controls` function modifies `this.playerVelocity`.
        // Let's keep your `controls` for player input, and this `updatePlayer`
        // will handle physics steps and collision resolution.
        // The `player.position.addScaledVector(h,l)` is the *final* application of physics velocity before collisions.
        // The previous `addScaledVector` lines for fwd/bkd/lft/rgt in the example are effectively the "input" part,
        // which your `controls` method already handles by modifying `playerVelocity`.

        // So, let's simplify step 2 and 3 above:
        // Your `controls` modifies `this.playerVelocity`.
        // `this.updatePlayer` will take that `playerVelocity`, apply gravity, and then *move the collider*.

        // Let's re-do the initial movement based on YOUR `playerVelocity`
        // and then let the collision logic adjust it.
        const deltaPosition = _vector3.copy(this.playerVelocity).multiplyScalar(deltaTime);
        this.playerCollider.start.add(deltaPosition);
        this.playerCollider.end.add(deltaPosition);

        // 4. Prepare capsule for collision detection (corresponds to i, M, A, y)
        // Here, `this.playerCollider` itself is your capsule. We'll use _tempSegment.copy(this.playerCollider)
        // to represent the capsule's position *before* collision resolution in this step.
        _tmpBox.makeEmpty();
        _tmpMat.copy(this.scene.matrixWorld).invert(); // Assuming scene is parent of BVH meshes and player.
                                                       // The example uses `collider.matrixWorld.invert()`.
                                                       // If your environment meshes are direct children of scene,
                                                       // and collider is a merged mesh, then its matrixWorld is what matters.
                                                       // If your BVH meshes are in world space already, no inverse matrix needed.
                                                       // The example assumes the `collider` (your `this.bvhMeshes` group)
                                                       // has its own transformation that needs to be inverted to get local space.
                                                       // Let's assume your `bvhMeshes` are effectively in world space.
                                                       // If not, you might need to apply _tmpMat to _tempSegment points.

        // The example assumes `player.matrixWorld` transforms the capsule segment to world space,
        // and then `collider.matrixWorld.invert()` transforms it to collider's local space.
        // Since `this.playerCollider` is already in world space, and `this.bvhMeshes` are in world space,
        // we can simplify this. Just use `this.playerCollider` directly.

        // However, the `shapecast` method on `MeshBVH` expects triangle coordinates to be relative to the mesh it was built on.
        // So, if your `this.bvhMeshes` are at world origin, and your `playerCollider` is at world origin, it's fine.
        // If your `bvhMeshes` are transformed, the `shapecast` should transform the query to their local space.
        // The example's `y.start.applyMatrix4(e.matrixWorld).applyMatrix4(A)` is crucial.
        // 'e' is the player mesh, 'A' is `collider.matrixWorld.invert()`.
        // This means: capsule (local to player mesh) -> world space -> collider local space.

        // In your case:
        // this.playerCollider.start/end are already in world space.
        // If `this.bvhMeshes` are also in world space, then no transformations are needed here.
        // If `this.bvhMeshes[0].matrixWorld` represents some global offset of your map,
        // then _tempSegment.start/end need to be transformed by its inverse.

        // Let's assume for simplicity, `this.bvhMeshes` are effectively at world origin,
        // and `playerCollider` is directly in world space.
        // If this leads to incorrect collisions, we'll revisit the matrix transformations.

        _tempSegment.copy(this.playerCollider); // Copy the current (moved) collider state

        _tmpBox.expandByPoint(_tempSegment.start);
        _tmpBox.expandByPoint(_tempSegment.end);
        _tmpBox.min.addScalar(-COLLIDER_RADIUS);
        _tmpBox.max.addScalar(COLLIDER_RADIUS);

        let bestCollisionNormal = new THREE.Vector3(); // Replaces 'E' from the example's `x.sub(S).normalize()`
        let collisionDepth = 0;
        let collisionDetected = false;

        // Iterate through all BVH-enabled meshes in the environment for collisions
        for (const mesh of this.bvhMeshes) {
            // Apply mesh's inverse world matrix to the capsule segment to bring it into the mesh's local space
            // where the BVH was built. This is CRUCIAL for accurate collisions.
            // If the mesh is at world origin, this `_tmpMat` will be an identity matrix.
            _tmpMat.copy(mesh.matrixWorld).invert();
            const localSegment = _tempSegment.clone(); // Clone to avoid modifying _tempSegment for multiple meshes
            localSegment.start.applyMatrix4(_tmpMat);
            localSegment.end.applyMatrix4(_tmpMat);

            mesh.geometry.boundsTree.shapecast({
                intersectsBounds: box => box.intersectsBox(_tmpBox), // _tmpBox is in world space, this is a rough check

                intersectsTriangle: tri => {
                    const triPoint = _vector1; // 'S' in example
                    const capsulePoint = _vector2; // 'x' in example

                    // Calculate the distance from the local capsule segment to the triangle
                    const distance = tri.closestPointToSegment(localSegment, triPoint, capsulePoint);

                    if (distance < COLLIDER_RADIUS) {
                        const currentDepth = COLLIDER_RADIUS - distance;
                        const currentNormal = capsulePoint.sub(triPoint).normalize();

                        // Track the deepest collision.
                        // The example aggregates this by directly modifying 'y' (tempSegment).
                        // We'll accumulate bestNormal and bestDepth, then apply.
                        if (currentDepth > collisionDepth) {
                            collisionDepth = currentDepth;
                            bestCollisionNormal.copy(currentNormal);
                            collisionDetected = true;
                        }
                    }
                }
            });
        }

        // After checking all collisions, apply the deepest one.
        this.playerOnFloor = false; // Reset first
        this.isGrounded = false;
        this.groundNormal.set(0, 1, 0); // Default up

        if (collisionDetected) {
            // Transform the bestCollisionNormal back into world space if it was computed in local space
            bestCollisionNormal.transformDirection(this.bvhMeshes[0].matrixWorld); // Assuming all meshes share same parent transform or are world aligned

            // Apply adjustment to playerCollider based on the best collision
            const SKIN = 0.02; // Small offset to prevent sticking
            if (collisionDepth > SKIN) {
                // Adjust the playerCollider position directly to resolve penetration
                const displacement = _vector3.copy(bestCollisionNormal).multiplyScalar(collisionDepth - SKIN);
                this.playerCollider.start.add(displacement);
                this.playerCollider.end.add(displacement);
            }

            // Determine if on floor (corresponds to `C = s.y > Math.abs(l * h.y * .25);`)
            // The example computes `deltaVector` (s) by comparing adjusted position (`p`) with player's previous position (`e.position`).
            // `p` is `y.start.applyMatrix4(c.matrixWorld)` (adjusted capsule start in world space).
            // `s` is `p.sub(e.position)`.
            // Let's calculate a `deltaVector` by comparing the new collider position with the old.
            const adjustedDelta = _vector3.copy(this.playerCollider.start).sub(prevColliderStart);
            this.playerOnFloor = adjustedDelta.y > Math.abs(deltaTime * this.playerVelocity.y * 0.25);

            // Set grounded states and ground normal
            this.isGrounded = this.playerOnFloor;
            if (this.playerOnFloor) {
                this.groundNormal.copy(bestCollisionNormal); // Use the normal from the collision
            }

            // Adjust player velocity based on collision normal (corresponds to `h.addScaledVector(s, -s.dot(h))`)
            // The example's logic `C ? h.set(0, 0, 0) : (s.normalize(), h.addScaledVector(s, -s.dot(h)))`
            // means if on ground, velocity becomes 0. If not on ground, project velocity.
            if (this.playerOnFloor) {
                this.playerVelocity.set(0, 0, 0); // Stops all velocity if on ground after collision
            } else {
                // Project velocity off the surface that was hit
                // s.normalize() corresponds to `bestCollisionNormal` already normalized.
                this.playerVelocity.addScaledVector(bestCollisionNormal, -bestCollisionNormal.dot(this.playerVelocity));
            }
        } else {
             // If no collision detected, explicitly set playerOnFloor to false
             this.playerOnFloor = false;
             this.isGrounded = false;
             this.groundNormal.set(0, 1, 0);
        }

        // If player falls too far (corresponds to `e.position.y < -25 && F()`)
        if (this.playerCollider.end.y < -25) { // Use playerCollider's end point for height check
            this.setPlayerPosition(new THREE.Vector3(0, 5, 0)); // Your reset
            this.playerVelocity.set(0, 0, 0); // Reset velocity on fall
            this.playerOnFloor = false; // Not on floor immediately after reset
            this.isGrounded = false;
        }
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
        // Your input processing. This updates `this.playerVelocity`.
        const accel = this.playerOnFloor ? PLAYER_ACCEL_GROUND : PLAYER_ACCEL_AIR;
        const effectiveAccel = accel * this.speedModifier *
            (input.crouch ? 0.3 : input.slow ? 0.5 : this.isAim ? 0.65 : 1);
        const moveDir = _vector3.set(0, 0, 0); // Use a temporary vector here
        if (input.forward) this.fwdPressed = true; else this.fwdPressed = false;
        if (input.backward) this.bkdPressed = true; else this.bkdPressed = false;
        if (input.left) this.lftPressed = true; else this.lftPressed = false;
        if (input.right) this.rgtPressed = true; else this.rgtPressed = false;

        // Incorporate example's input velocity calculation directly into playerVelocity
        const angle = this.camera.rotation.y; // Get camera yaw
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

        // Apply horizontal damping if not receiving input (to prevent infinite slide)
        if (! (input.forward || input.backward || input.left || input.right) && this.playerOnFloor) {
            this.playerVelocity.x *= Math.exp(-4 * deltaTime); // Damping factor
            this.playerVelocity.z *= Math.exp(-4 * deltaTime);
        }

        if (this.playerOnFloor && input.jump) {
            this.playerVelocity.y = JUMP_VELOCITY;
            this.playerOnFloor = false; // Player is now off the floor
            this.isGrounded = false;
            this.jumpTriggered = true;
        }

        const wantCrouch = input.crouch && this.isGrounded;
        this.targetHeight = wantCrouch ? CROUCH_HEIGHT : STAND_HEIGHT;
        this.currentHeight += (this.targetHeight - this.currentHeight) *
            Math.min(1, CROUCH_SPEED * deltaTime);

        // Adjust playerCollider's end point based on currentHeight
        if (!this.playerCollider || !this.playerCollider.start || !this.playerCollider.end) {
            console.error("ERROR: playerCollider or its start/end points are undefined before updating end.y in controls!");
            return;
        }
        this.playerCollider.end.y = this.playerCollider.start.y +
            (this.currentHeight - 2 * COLLIDER_RADIUS);
    }

    teleportIfOob() {
        // This check is now integrated into `updatePlayer` based on example
    }

    setPlayerPosition(position) {
        if (!this.playerCollider) {
            console.error("ERROR: playerCollider is undefined in setPlayerPosition!");
            return;
        }

        // Example's reset function also updates camera target/position and controls
        // This function will set the playerCollider's start/end points directly
        // and also reset camera and velocity.
        const spawnY = position.y + COLLIDER_RADIUS + 0.1; // Ensure it's slightly above ground
        this.playerCollider.start.set(position.x, spawnY, position.z);
        this.playerCollider.end.set(
            position.x,
            spawnY + (this.currentHeight - 2 * COLLIDER_RADIUS),
            position.z
        );
        this.playerVelocity.set(0, 0, 0);
        this.playerOnFloor = false;
        this.isGrounded = false;
        this.jumpTriggered = false;
        this.fallStartY = null;
        this.groundNormal.set(0, 1, 0);

        // Update camera position to match the player collider for consistent view
        this.camera.position.copy(this.playerCollider.start);
        this.camera.position.y += this.currentHeight * 0.9;
        this.camera.rotation.set(0, 0, 0); // Reset camera rotation
    }

    update(deltaTime, input) {
        deltaTime = Math.min(0.05, deltaTime); // Cap deltaTime to prevent large jumps/skips
        this.prevGround = this.isGrounded;

        // Footstep audio logic
        const speedXZ = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
        if (speedXZ > FOOT_DISABLED_THRESHOLD && this.isGrounded && !input.slow && !input.crouch) {
            const interval = this.baseFootInterval / speedXZ;
            this.footAcc += deltaTime;
            if (this.footAcc >= interval) {
                this.footAcc -= interval;
                const audio = this.footAudios[this.footIndex];
                audio.currentTime = 0;
                audio.play().catch(() => {});
                sendSoundEvent("footstep", "run", this._pos());
                this.footIndex = 1 - this.footIndex;
            }
        } else if (this.isGrounded && speedXZ <= FOOT_DISABLED_THRESHOLD) {
            this.footAcc = 0;
        }

        // Handle player input and update collider height. This primarily updates `this.playerVelocity`
        // and `this.playerCollider.end.y`.
        this.controls(deltaTime, input);

        // The example uses `physicsSteps`. Let's implement that for robustness.
        const physicsSteps = 5; // Corresponds to `a.physicsSteps`
        for (let i = 0; i < physicsSteps; i++) {
            this.updatePlayer(deltaTime / physicsSteps);
        }

        // Landing audio logic
        if (!this.prevGround && this.isGrounded) {
            const fellFar = this.fallStartY !== null && (this.fallStartY - this.camera.position.y) > 1;
            if (fellFar || (this.jumpTriggered && fellFar)) {
                this.landAudio.currentTime = 0;
                this.landAudio.play().catch(() => {});
                sendSoundEvent("landingThud", "land", this._pos());
            }
            this.fallStartY = null;
            if (this.fallStartTimer) {
                clearTimeout(this.fallStartTimer);
                this.fallStartTimer = null;
            }
        } else if (!this.isGrounded && this.fallStartY === null) {
            if (!this.fallStartTimer) {
                this.fallStartTimer = setTimeout(() => {
                    this.fallStartY = this.camera.position.y;
                    this.fallStartTimer = null;
                }, this.fallDelay);
            }
        }
        this.jumpTriggered = false; // Reset jump trigger after checking landing

        // Update camera position to follow the player collider's base
        // Note: The example uses player.position to update camera and controls.target.
        // We'll use playerCollider.start for `camera.position` directly.
        if (!this.playerCollider || !this.playerCollider.start) {
            console.error("ERROR: playerCollider or its start point is undefined before camera position update!");
            return {
                x: 0, y: 0, z: 0, rotY: 0, isGrounded: false, velocity: new THREE.Vector3(), velocityY: 0
            };
        }
        this.camera.position.x = this.playerCollider.start.x;
        this.camera.position.z = this.playerCollider.start.z;
        this.camera.position.y = this.playerCollider.start.y + this.currentHeight * 0.9; // Adjust camera height

        // Player model rotation (your existing logic)
        if (this.playerModel) { // Only attempt if playerModel exists
            if (this.isGrounded) {
                const forward = _vector1; // Use a temporary vector
                this.camera.getWorldDirection(forward);
                forward.y = 0; forward.normalize();
                const right = _vector2.crossVectors(forward, this.groundNormal).normalize(); // Use another temp vector
                const finalFwd = _vector3.crossVectors(this.groundNormal, right).normalize(); // Use another temp vector
                const mat = new THREE.Matrix4().makeBasis(right, this.groundNormal, finalFwd);
                const targetQ = new THREE.Quaternion().setFromRotationMatrix(mat);
                this.playerModel.quaternion.slerp(targetQ, 0.15);
            } else {
                const upQ = new THREE.Quaternion().setFromUnitVectors(this.playerModel.up, new THREE.Vector3(0, 1, 0));
                this.playerModel.quaternion.slerp(upQ, 0.05);
            }
            // Update player model's position to match collider
            this.playerModel.position.copy(this.playerCollider.start);
            this.playerModel.position.y -= COLLIDER_RADIUS; // Adjust to sit on ground, assuming model origin is center base
        }


        // Return player state (your existing return structure)
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
