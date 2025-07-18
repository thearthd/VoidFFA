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
const GRAVITY = 27.5;
const CROUCH_SPEED = 8;
const FOOT_DISABLED_THRESHOLD = 0.2;
const PLAYER_ACCEL_GROUND = 25;
const PLAYER_ACCEL_AIR = 8;
const MAX_SPEED = 10;

const SKIN = 0.005; // Keep this small, it's a buffer to prevent immediate re-penetration

const _vector1 = new THREE.Vector3();
const _vector2 = new THREE.Vector3();
const _vector3 = new THREE.Vector3();
const _tmpBox = new THREE.Box3(); // Player's collision volume in World Space
const _tmpMat = new THREE.Matrix4(); // General purpose temporary matrix
const _tmpInverseMat = new THREE.Matrix4(); // Temporary matrix for inverse operations
const _tmpLocalBox = new THREE.Box3(); // Temporary box for local BVH node bounds in World Space
const _tempSegment = new THREE.Line3();
const _upVector = new THREE.Vector3(0, 1, 0);

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

        this.playerVelocity = new THREE.Vector3();
        this.playerDirection = new THREE.Vector3();
        this.playerOnFloor = false;
        this.isGrounded = false;
        this.groundNormal = new THREE.Vector3(0, 1, 0);
        this.bvhMeshes = [];
        this.mouseTime = 0;

        this.fwdPressed = false;
        this.bkdPressed = false;
        this.lftPressed = false;
        this.rgtPressed = false;
        this.jumpPressed = false;
        this.crouchPressed = false;
        this.slowPressed = false;
        this.isAim = false;

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
        this.speedModifier = 1;
        this.currentHeight = STAND_HEIGHT;
        this.targetHeight = STAND_HEIGHT;
        this.fallDelay = 300;

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

    async buildBVH(group, onProgress = () => {}) {
        this.bvhMeshes = [];
        let total = 0, loaded = 0;
        group.traverse(node => {
            if (node.isMesh && node.geometry.isBufferGeometry) total++;
        });
        group.traverse(node => {
            if (!node.isMesh || !node.geometry.isBufferGeometry) return;
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

    updatePlayer(deltaTime) {
        // Crucial check: only perform BVH collisions if meshes are loaded
        if (this.bvhMeshes.length === 0) {
            // Apply gravity and basic movement without collision resolution
            this.playerVelocity.y += deltaTime * -GRAVITY;
            const deltaPosition = _vector3.copy(this.playerVelocity).multiplyScalar(deltaTime);
            this.playerCollider.start.add(deltaPosition);
            this.playerCollider.end.add(deltaPosition);

            // Apply input-based movement to collider if BVH not ready
            const angle = this.camera.rotation.y;
            let currentSpeedModifier = this.speedModifier;
            if (this.crouchPressed) currentSpeedModifier *= 0.3;
            else if (this.slowPressed) currentSpeedModifier *= 0.5;
            else if (this.isAim) currentSpeedModifier *= 0.65;
            const effectiveAccel = PLAYER_ACCEL_GROUND * currentSpeedModifier;

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

            // Apply horizontal damping if no input and not grounded
            if (! (this.fwdPressed || this.bkdPressed || this.lftPressed || this.rgtPressed) && !this.playerOnFloor) {
                this.playerVelocity.x *= Math.exp(-4 * deltaTime);
                this.playerVelocity.z *= Math.exp(-4 * deltaTime);
            }
            // If the player falls out of bounds while BVH is loading, teleport them.
            if (this.playerCollider.end.y < -25) {
                this.setPlayerPosition(new THREE.Vector3(0, 5, 0));
                this.playerVelocity.set(0, 0, 0);
            }
            return; // Exit early as BVH is not ready for collision checks
        }

        // Physics calculations: Gravity
        if (!this.playerOnFloor || this.jumpTriggered) {
            this.playerVelocity.y += deltaTime * -GRAVITY;
        } else {
            this.playerVelocity.y = -GRAVITY * deltaTime;
        }

        // Create a *new* capsule for the current physics step's movement
        const currentCapsule = this.playerCollider.clone();

        // Apply velocity to the *new* capsule
        const deltaPosition = _vector3.copy(this.playerVelocity).multiplyScalar(deltaTime);
        currentCapsule.start.add(deltaPosition);
        currentCapsule.end.add(deltaPosition);

        // Prepare bounding box for broad-phase check (this is critical!)
        _tmpBox.makeEmpty();
        _tmpBox.expandByPoint(currentCapsule.start);
        _tmpBox.expandByPoint(currentCapsule.end);
        _tmpBox.min.addScalar(-COLLIDER_RADIUS);
        _tmpBox.max.addScalar(COLLIDER_RADIUS);

        let bestCollisionNormal = new THREE.Vector3();
        let collisionDepth = 0;
        let collisionDetected = false;

        // Iterate through all BVH-enabled meshes for collisions
        for (const mesh of this.bvhMeshes) {
            // Get the inverse world matrix for this mesh once per mesh
            _tmpInverseMat.copy(mesh.matrixWorld).invert();

            // Transform the *current* capsule segment into the mesh's local space for shapecast
            _vector1.copy(currentCapsule.start).applyMatrix4(_tmpInverseMat);
            _vector2.copy(currentCapsule.end).applyMatrix4(_tmpInverseMat);

            // Create a temporary local segment for the shapecast
            _tempSegment.set(_vector1, _vector2);

            mesh.geometry.boundsTree.shapecast({
                intersectsBounds: box => {
                    // Transform the BVH node's local bounding box to world space
                    _tmpLocalBox.copy(box).applyMatrix4(mesh.matrixWorld);
                    // Then check if this world-space box intersects the player's world-space collision box
                    return _tmpLocalBox.intersectsBox(_tmpBox);
                },
                intersectsTriangle: tri => {
                    const triPoint = _vector1;
                    const capsulePoint = _vector2;

                    const distance = tri.closestPointToSegment(_tempSegment, triPoint, capsulePoint);

                    if (distance < COLLIDER_RADIUS) {
                        const currentDepth = COLLIDER_RADIUS - distance;
                        const currentNormal = capsulePoint.sub(triPoint).normalize();

                        if (currentDepth > collisionDepth) {
                            collisionDepth = currentDepth;
                            bestCollisionNormal.copy(currentNormal);
                            collisionDetected = true;
                        }
                    }
                }
            });
        }

        // Apply collision resolution if a collision was detected
        this.playerOnFloor = false;
        this.isGrounded = false;
        this.groundNormal.set(0, 1, 0);

        if (collisionDetected) {
            // Transform the bestCollisionNormal back into world space
            // Assuming all bvhMeshes share the same matrixWorld for a unified terrain
            if (this.bvhMeshes.length > 0) { // Safety check
                bestCollisionNormal.transformDirection(this.bvhMeshes[0].matrixWorld);
            }


            // Apply displacement to move out of penetration
            if (collisionDepth > 0) {
                // Add SKIN to push slightly out of the collision
                const displacement = _vector3.copy(bestCollisionNormal).multiplyScalar(collisionDepth + SKIN);
                this.playerCollider.start.add(displacement);
                this.playerCollider.end.add(displacement);
            }

            // Determine if on floor based on the dot product of collision normal and up vector
            if (bestCollisionNormal.dot(_upVector) > 0.75) {
                this.playerOnFloor = true;
                this.isGrounded = true;
                this.groundNormal.copy(bestCollisionNormal);

                this.playerVelocity.projectOnPlane(this.groundNormal);
            } else {
                // If it's a wall or ceiling, reflect/bounce velocity
                const dot = this.playerVelocity.dot(bestCollisionNormal);
                if (dot < 0) { // Only if moving towards the obstacle
                    this.playerVelocity.addScaledVector(bestCollisionNormal, -dot); // Zero out velocity component in normal's direction
                }
            }
        } else {
            // If no collision, player is not on floor
            this.playerOnFloor = false;
            this.isGrounded = false;
            this.groundNormal.set(0, 1, 0);
        }

        // Teleport if out of bounds (after all physics steps)
        if (this.playerCollider.end.y < -25) {
            this.setPlayerPosition(new THREE.Vector3(0, 5, 0));
            this.playerVelocity.set(0, 0, 0);
            this.playerOnFloor = false;
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
        this.fwdPressed = input.forward;
        this.bkdPressed = input.backward;
        this.lftPressed = input.left;
        this.rgtPressed = input.right;
        this.jumpPressed = input.jump;
        this.crouchPressed = input.crouch;
        this.slowPressed = input.slow;
        // isAim should be set by your game logic, for example, when right-mouse button is down.

        let currentSpeedModifier = this.speedModifier;

        if (this.crouchPressed) {
            currentSpeedModifier *= 0.3;
        } else if (this.slowPressed) {
            currentSpeedModifier *= 0.5;
        } else if (this.isAim) {
            currentSpeedModifier *= 0.65;
        }

        const accel = this.playerOnFloor ? PLAYER_ACCEL_GROUND : PLAYER_ACCEL_AIR;
        const effectiveAccel = accel * currentSpeedModifier;

        const angle = this.camera.rotation.y;

        // Apply input-based acceleration to playerVelocity
        // Consider applying acceleration based on current velocity direction for better "air control" or "ground friction"
        // This current method adds velocity in world directions, which is okay for basic movement.
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

        // Apply horizontal damping
        if (!(this.fwdPressed || this.bkdPressed || this.lftPressed || this.rgtPressed) && this.playerOnFloor) {
            this.playerVelocity.x *= Math.exp(-6 * deltaTime);
            this.playerVelocity.z *= Math.exp(-6 * deltaTime);
        }
        else if (!this.playerOnFloor) {
            this.playerVelocity.x *= Math.exp(-0.5 * deltaTime);
            this.playerVelocity.z *= Math.exp(-0.5 * deltaTime);
        }

        // Jump logic
        if (this.playerOnFloor && this.jumpPressed) {
            this.playerVelocity.y = JUMP_VELOCITY;
            this.playerOnFloor = false;
            this.isGrounded = false;
            this.jumpTriggered = true;
        } else {
            this.jumpTriggered = false;
        }

        // Crouch logic
        const wantCrouch = this.crouchPressed && this.isGrounded;
        this.targetHeight = wantCrouch ? CROUCH_HEIGHT : STAND_HEIGHT;
        this.currentHeight += (this.targetHeight - this.currentHeight) *
            Math.min(1, CROUCH_SPEED * deltaTime);

        if (!this.playerCollider || !this.playerCollider.start || !this.playerCollider.end) {
            console.error("ERROR: playerCollider or its start/end points are undefined before updating end.y in controls!");
            return;
        }
        this.playerCollider.end.y = this.playerCollider.start.y +
            (this.currentHeight - 2 * COLLIDER_RADIUS);
    }

    setPlayerPosition(position) {
        if (!this.playerCollider) {
            console.error("ERROR: playerCollider is undefined in setPlayerPosition!");
            return;
        }

        const spawnY = position.y + COLLIDER_RADIUS + 0.1;
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
        this.camera.rotation.set(0, 0, 0);
    }

    update(deltaTime, input) {
        deltaTime = Math.min(0.05, deltaTime);
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

        // Apply physics steps
        const physicsSteps = 5;
        for (let i = 0; i < physicsSteps; i++) {
            this.updatePlayer(deltaTime / physicsSteps);
        }

        // Landing audio logic
        if (!this.prevGround && this.isGrounded) {
            const fellFar = this.fallStartY !== null && (this.fallStartY - this.camera.position.y) > 1;
            if (fellFar) {
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
            // Reset fallStartY if player somehow gets on ground without a "landing"
            if (this.isGrounded) {
                this.fallStartY = null;
                if (this.fallStartTimer) {
                    clearTimeout(this.fallStartTimer);
                    this.fallStartTimer = null;
                }
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
        this.camera.position.y = this.playerCollider.start.y + this.currentHeight * 0.9;

        // Player model rotation
        if (this.playerModel) {
            if (this.isGrounded) {
                const forward = _vector1;
                this.camera.getWorldDirection(forward);
                forward.y = 0; forward.normalize();
                const right = _vector2.crossVectors(forward, this.groundNormal).normalize();
                const finalFwd = _vector3.crossVectors(this.groundNormal, right).normalize();
                const mat = new THREE.Matrix4().makeBasis(right, this.groundNormal, finalFwd);
                const targetQ = new THREE.Quaternion().setFromRotationMatrix(mat);
                this.playerModel.quaternion.slerp(targetQ, 0.15);
            } else {
                const upQ = new THREE.Quaternion().setFromUnitVectors(this.playerModel.up, new THREE.Vector3(0, 1, 0));
                this.playerModel.quaternion.slerp(upQ, 0.05);
            }
            this.playerModel.position.copy(this.playerCollider.start);
            this.playerModel.position.y -= COLLIDER_RADIUS;
        }

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
