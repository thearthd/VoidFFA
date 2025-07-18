import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.152.0/build/three.module.js";
import { MeshBVH, acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.9.1/+esm";
import { Capsule } from "three/examples/jsm/math/Capsule.js";
import { sendSoundEvent } from "./network.js";

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

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

// Re-using your temporary vectors, ensuring they are always Vector3 instances.
const _vector1 = new THREE.Vector3(); // Used for triPoint in the new logic
const _vector2 = new THREE.Vector3(); // Used for capsulePoint in the new logic
const _vector3 = new THREE.Vector3(); // Used for general calculations (e.g., playerVelocity projection, normal scaling)
const _tmpBox = new THREE.Box3();
const _plane = new THREE.Plane();
const _tempSegment = new THREE.Line3(); // New temporary Line3 as in the example

export class PhysicsController {
    constructor(camera, scene, playerModel = null) {
        this.camera = camera;
        this.scene = scene;
        this.playerModel = playerModel;

        // Your playerCollider is already a Capsule, which is perfect.
        // The example uses player.capsuleInfo.segment, but your playerCollider is directly the capsule.
        this.playerCollider = new Capsule(
            new THREE.Vector3(0, COLLIDER_RADIUS, 0),
            new THREE.Vector3(0, STAND_HEIGHT - COLLIDER_RADIUS, 0),
            COLLIDER_RADIUS
        );

        this.playerVelocity = new THREE.Vector3();
        this.playerDirection = new THREE.Vector3(); // Re-used for forward/side vectors
        this.playerOnFloor = false; // Corresponds to example's playerIsOnGround
        this.isGrounded = false;     // Your existing isGrounded, derived from playerOnFloor
        this.groundNormal = new THREE.Vector3(0, 1, 0); // Your existing groundNormal
        this.bvhMeshes = []; // The array of meshes with BVH from map.js
        this.mouseTime = 0;

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

        // Debugging: Verify initial playerCollider state - keeping these for good measure
        console.log("PhysicsController initialized. playerCollider:", this.playerCollider);
        if (!this.playerCollider.start || !this.playerCollider.end) {
            console.error("ERROR: playerCollider.start or playerCollider.end is undefined in constructor!");
        }
    }

    setSpeedModifier(value) {
        this.speedModifier = value;
    }

    // This method is fine as it correctly builds BVHs on the meshes passed from map.js
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

    // Removed getCapsuleTriangles and triangleCapsuleIntersect as they are replaced by the shapecast pattern

    // This is the heavily refactored collision logic based on the example
    playerCollisions() {
        // Ensure this.playerCollider is valid before proceeding
        if (!this.playerCollider || !this.playerCollider.start || !this.playerCollider.end) {
            console.error("CRITICAL ERROR: Player collider is invalid at the start of playerCollisions!");
            return;
        }

        const capsuleRadius = this.playerCollider.radius;
        const playerCapsuleStart = this.playerCollider.start; // Directly use current capsule position
        const playerCapsuleEnd = this.playerCollider.end;     // Directly use current capsule position

        // 1. Create a temporary Line3 segment from the playerCollider's current position
        //    _tempSegment is a global temp variable
        _tempSegment.copy(this.playerCollider); // Capsule.copy(Line3) works by copying start/end

        // 2. Expand a bounding box around the capsule segment for initial BVH intersection test
        _tmpBox.makeEmpty();
        _tmpBox.expandByPoint(_tempSegment.start);
        _tmpBox.expandByPoint(_tempSegment.end);
        _tmpBox.min.addScalar(-capsuleRadius);
        _tmpBox.max.addScalar(capsuleRadius);

        let bestNormal = null;
        let bestDepth = 0;
        let foundCollision = false;

        // Iterate through all BVH-enabled meshes in the environment
        for (const mesh of this.bvhMeshes) {
            // It's crucial that the player's capsule is in the same space as the collider mesh's BVH.
            // If environment meshes are moved/scaled, playerCapsule's points must be transformed
            // into the mesh's local space before shapecast, and transformed back after.
            // Assuming your environment meshes are static or transformed *before* BVH building,
            // and playerCollider is in world space, this is generally handled by the BVH's coordinate system.
            // If your playerCollider position is in *world space*, and the BVH is built on meshes
            // that are also in *world space* (or their transformed local space matches), this is fine.
            // If the BVH is built on meshes that are children of a scene group that has transformations,
            // you might need to transform _tempSegment into the local space of 'mesh' using mesh.matrixWorld.invert()
            // as seen in the example's updatePlayer, like:
            // _tempSegment.start.applyMatrix4(player.matrixWorld).applyMatrix4(tempMat); // where tempMat is mesh.matrixWorld.invert()
            // _tempSegment.end.applyMatrix4(player.matrixWorld).applyMatrix4(tempMat);
            // However, your buildBVH currently processes meshes directly and adds them, implying world space usage.
            // Let's assume for now the playerCollider and BVH are in compatible coordinate systems (world space).


            mesh.geometry.boundsTree.shapecast({
                intersectsBounds: box => box.intersectsBox(_tmpBox),

                intersectsTriangle: tri => {
                    // tri: The triangle from the BVH that potentially intersects
                    // _vector1: Temporary for triPoint (closest point on the triangle)
                    // _vector2: Temporary for capsulePoint (closest point on the capsule segment)

                    const distance = tri.closestPointToSegment(_tempSegment, _vector1, _vector2);

                    if (distance < capsuleRadius) {
                        foundCollision = true;
                        const depth = capsuleRadius - distance;
                        const direction = _vector2.sub(_vector1).normalize(); // Direction from triangle to capsulePoint

                        // Keep track of the deepest collision to resolve it
                        if (depth > bestDepth) {
                            bestDepth = depth;
                            bestNormal = direction.clone();
                        }
                    }
                }
            });
        }

        // Reset playerOnFloor, isGrounded, groundNormal before applying new collision results
        this.playerOnFloor = false;
        this.isGrounded = false;
        this.groundNormal.set(0, 1, 0); // Default to up

        if (foundCollision && bestNormal) {
            // Apply the best (deepest) collision response
            this.playerOnFloor = bestNormal.y > 0.5; // Determine if player is on ground
            this.isGrounded = this.playerOnFloor;
            if (this.playerOnFloor) {
                this.groundNormal.copy(bestNormal); // Set the actual ground normal
            }

            const SKIN = 0.02; // Small offset to avoid continuous collision
            if (bestDepth > SKIN) {
                // Adjust the playerCollider position directly to resolve penetration
                this.playerCollider.translate(_vector3.copy(bestNormal).multiplyScalar(bestDepth - SKIN));
            }

            // Adjust player velocity: if moving into the normal, project velocity onto the plane of collision
            if (this.playerVelocity.dot(bestNormal) < 0) {
                _vector3.copy(this.playerVelocity).projectOnPlane(bestNormal);
                this.playerVelocity.copy(_vector3);
            }
        }
    }

    updatePlayer(deltaTime) {
        // Your existing updatePlayer logic
        let damping = Math.exp(-4 * deltaTime) - 1;
        if (!this.playerOnFloor) { // If not on floor, apply full gravity
            this.playerVelocity.y -= GRAVITY * deltaTime;
            damping *= 0.1; // Less damping in air
        } else {
            // If on floor, apply gravity component aligned with ground normal
            const gravityComp = _vector3.copy(this.groundNormal).multiplyScalar(-GRAVITY * deltaTime);
            this.playerVelocity.add(gravityComp);
            // Project velocity onto the ground plane to prevent "sliding down" slopes due to gravity
            this.playerVelocity.projectOnPlane(this.groundNormal);

            // Special handling for flat ground to prevent vertical jitter
            if (this.groundNormal.y > 0.99) {
                if (this.playerVelocity.y < 0) this.playerVelocity.y = 0;
            } else {
                // For slopes, if moving "into" the slope, nudge off it slightly
                if (this.playerVelocity.dot(this.groundNormal) <= 0) {
                    this.playerVelocity.add(_vector3.copy(this.groundNormal).multiplyScalar(-0.1));
                }
            }
        }

        // Apply horizontal damping
        this.playerVelocity.x += this.playerVelocity.x * damping;
        this.playerVelocity.z += this.playerVelocity.z * damping;

        // Limit horizontal speed
        const hSpeed = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
        if (hSpeed > MAX_SPEED) {
            const ratio = MAX_SPEED / hSpeed;
            this.playerVelocity.x *= ratio;
            this.playerVelocity.z *= ratio;
        }

        // Calculate displacement based on velocity
        const deltaPos = _vector1.copy(this.playerVelocity).multiplyScalar(deltaTime);

        // Debugging: Verify playerCollider before translate (kept for robustness)
        if (!this.playerCollider || !this.playerCollider.start || !this.playerCollider.end) {
            console.error("ERROR: playerCollider or its start/end points are undefined before translate!");
            return;
        }
        this.playerCollider.translate(deltaPos); // Apply movement to the collider

        // Debugging: Verify playerCollider before collisions (kept for robustness)
        if (!this.playerCollider || !this.playerCollider.start || !this.playerCollider.end) {
            console.error("ERROR: playerCollider or its start/end points are undefined before playerCollisions!");
            return;
        }

        // Now perform collision detection and response
        this.playerCollisions();

        // One final check and adjustment based on where the player ended up after collisions
        // The example does a final deltaVector calculation from newPosition to player.position
        // to determine playerIsOnGround and velocity adjustment.
        // We'll mimic this by comparing the playerCollider's position before and after `playerCollisions`
        // However, since we're directly translating `playerCollider` in `playerCollisions`
        // and its position is updated, we need to consider how `playerIsOnGround` is set.
        // Your `playerOnFloor` is already set in `playerCollisions` based on `bestNormal.y`.
        // The example's `playerIsOnGround = deltaVector.y > Math.abs( delta * playerVelocity.y * 0.25 );`
        // is more complex and might not be directly portable without knowing the full setup.
        // Let's stick to your `playerOnFloor` logic from the `bestNormal` for now, which is simpler.

        // If not on ground, apply velocity damping based on original example
        // (this part was already there, but re-emphasizing its role after collisions)
        if (!this.playerOnFloor) {
            // Apply velocity damping in air to prevent infinite horizontal slide
            this.playerVelocity.addScaledVector(this.groundNormal, -this.groundNormal.dot(this.playerVelocity));
        } else {
            // On ground, set horizontal velocity to zero if almost stopped, or allow movement
            // Your original logic for playerVelocity.x,z damping and MAX_SPEED already covers this.
            // The example set playerVelocity to (0,0,0) if on ground. Let's stick to your damping.
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
        const accel = this.playerOnFloor ? PLAYER_ACCEL_GROUND : PLAYER_ACCEL_AIR;
        const effectiveAccel = accel * this.speedModifier *
            (input.crouch ? 0.3 : input.slow ? 0.5 : this.isAim ? 0.65 : 1);
        const moveDir = _vector3.set(0, 0, 0); // Use a temporary vector here
        if (input.forward) moveDir.add(this.getForwardVector());
        if (input.backward) moveDir.add(this.getForwardVector().multiplyScalar(-1));
        if (input.left) moveDir.add(this.getSideVector().multiplyScalar(-1));
        if (input.right) moveDir.add(this.getSideVector());

        if (moveDir.lengthSq() > 0) {
            moveDir.normalize();
            if (this.playerOnFloor) moveDir.projectOnPlane(this.groundNormal);
            this.playerVelocity.add(moveDir.multiplyScalar(effectiveAccel * deltaTime));
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
        if (!this.playerCollider || !this.playerCollider.end) {
            console.error("ERROR: playerCollider or its end point is undefined in teleportIfOob!");
            return;
        }
        if (this.playerCollider.end.y < -30) {
            this.setPlayerPosition(new THREE.Vector3(0, 5, 0));
        }
    }

    setPlayerPosition(position) {
        if (!this.playerCollider) {
            console.error("ERROR: playerCollider is undefined in setPlayerPosition!");
            return;
        }

        const spawnY = position.y + 0.1;
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

        // Handle player input and update collider height
        this.controls(deltaTime, input);

        // This is the core physics update, including collision detection
        // The example uses a `physicsSteps` loop. You can add one here if you experience tunneling
        // but for now, we'll keep it simple with one call per frame (your original method)
        this.updatePlayer(deltaTime);
        this.teleportIfOob();

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
        if (this.isGrounded && this.playerModel) {
            const forward = _vector1; // Use a temporary vector
            this.camera.getWorldDirection(forward);
            forward.y = 0; forward.normalize();
            const right = _vector2.crossVectors(forward, this.groundNormal).normalize(); // Use another temp vector
            const finalFwd = _vector3.crossVectors(this.groundNormal, right).normalize(); // Use another temp vector
            const mat = new THREE.Matrix4().makeBasis(right, this.groundNormal, finalFwd);
            const targetQ = new THREE.Quaternion().setFromRotationMatrix(mat);
            this.playerModel.quaternion.slerp(targetQ, 0.15);
        } else if (this.playerModel) {
            const upQ = new THREE.Quaternion().setFromUnitVectors(this.playerModel.up, new THREE.Vector3(0, 1, 0));
            this.playerModel.quaternion.slerp(upQ, 0.05);
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
