import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.152.0/build/three.module.js";
import { MeshBVH, acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.9.1/+esm";
import { Capsule } from "three/examples/jsm/math/Capsule.js";
import { sendSoundEvent } from "./network.js";

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// Physics and Player Constants
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

// Collision Buffer: A tiny value to ensure clearance after pushing out of penetration.
// This should be as small as possible to prevent "popping" above the surface.
const COLLISION_BUFFER = 0.000001; // Extremely small, effectively 0 but provides numerical stability.

// "Sticky" Ground Force: A small constant downward velocity when grounded.
// This ensures the player remains firmly on the ground without jittering.
const GROUND_STICKY_VELOCITY = -0.1; // A small negative value (e.g., -0.1 to -0.5)

// Reusable temporary vectors and matrices
const _vector1 = new THREE.Vector3();
const _vector2 = new THREE.Vector3();
const _vector3 = new THREE.Vector3();
const _tmpBox = new THREE.Box3();
const _tmpMat = new THREE.Matrix4();
const _tmpInverseMat = new THREE.Matrix4();
const _tmpLocalBox = new THREE.Box3();
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
        this.onGround = false; // Consolidated grounded state
        this.groundNormal = new THREE.Vector3(0, 1, 0);
        this.bvhMeshes = [];

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
        this.prevOnGround = false;
        this.fallDelay = 300;

        this.jumpTriggered = false;
        this.currentHeight = STAND_HEIGHT;
        this.targetHeight = STAND_HEIGHT;

        console.log("PhysicsController initialized. playerCollider:", this.playerCollider);
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

    // Handles core physics updates including gravity, movement, and iterative collision resolution
updatePlayer(deltaTime) {
    // 1. Gravity
    if (!this.isGrounded) {
        this.playerVelocity.y += deltaTime * -GRAVITY;
    } else {
        this.playerVelocity.y = -0.01;
    }

    // remember old grounded state and old Y for “sticky” check
    const wasGrounded = this.isGrounded;
    const oldY = this.playerCollider.start.y;

    // 2. Predict next position
    const currentCapsule = this.playerCollider.clone();
    const deltaPosition = _vector3.copy(this.playerVelocity).multiplyScalar(deltaTime);
    currentCapsule.start.add(deltaPosition);
    currentCapsule.end.add(deltaPosition);

    // 3. Broad‐phase box
    _tmpBox.makeEmpty();
    _tmpBox.expandByPoint(currentCapsule.start);
    _tmpBox.expandByPoint(currentCapsule.end);
    _tmpBox.min.addScalar(-COLLIDER_RADIUS);
    _tmpBox.max.addScalar(COLLIDER_RADIUS);

    // 4. Reset collision state
    this.playerOnFloor = false;
    this.isGrounded = false;
    this.groundNormal.set(0, 1, 0);

    let collisionDetected = false;
    let collisionDepth = 0;
    let bestCollisionNormal = new THREE.Vector3();

    // 5. BVH shapecast
    for (const mesh of this.bvhMeshes) {
        _tmpInverseMat.copy(mesh.matrixWorld).invert();
        _vector1.copy(currentCapsule.start).applyMatrix4(_tmpInverseMat);
        _vector2.copy(currentCapsule.end).applyMatrix4(_tmpInverseMat);
        _tempSegment.set(_vector1, _vector2);

        mesh.geometry.boundsTree.shapecast({
            intersectsBounds: box => {
                _tmpLocalBox.copy(box).applyMatrix4(mesh.matrixWorld);
                return _tmpLocalBox.intersectsBox(_tmpBox);
            },
            intersectsTriangle: tri => {
                const triPt = _vector1, capPt = _vector2;
                const dist = tri.closestPointToSegment(_tempSegment, triPt, capPt);
                if (dist < COLLIDER_RADIUS) {
                    const depth = COLLIDER_RADIUS - dist;
                    const normal = capPt.sub(triPt).normalize();
                    if (depth > collisionDepth) {
                        collisionDepth = depth;
                        bestCollisionNormal.copy(normal);
                        collisionDetected = true;
                    }
                }
            }
        });
    }

    // 6. Collision resolution
    if (collisionDetected) {
        bestCollisionNormal.transformDirection(this.bvhMeshes[0].matrixWorld);
        const dispAmt = collisionDepth - SKIN;
        if (dispAmt > 0) {
            const disp = _vector3.copy(bestCollisionNormal).multiplyScalar(dispAmt);
            this.playerCollider.start.add(disp);
            this.playerCollider.end.add(disp);
        }

        if (bestCollisionNormal.dot(_upVector) > 0.75) {
            this.playerOnFloor = true;
            this.isGrounded = true;
            this.groundNormal.copy(bestCollisionNormal);
            if (this.playerVelocity.y > 0) this.playerVelocity.y = 0;
            this.playerVelocity.projectOnPlane(this.groundNormal);
        } else {
            const dot = this.playerVelocity.dot(bestCollisionNormal);
            if (dot < 0) this.playerVelocity.addScaledVector(bestCollisionNormal, -dot);
        }
    }

    // 7. Refined “sticky” ground: only if small vertical move (e.g. crouch) and was grounded
    const verticalMove = Math.abs(this.playerCollider.start.y + deltaPosition.y - oldY);
    if (!collisionDetected && wasGrounded && verticalMove < SKIN * 2) {
        this.isGrounded = true;
        this.playerOnFloor = true;
        // leave groundNormal as (0,1,0)
    }

    // 8. Out‑of‑bounds
    if (this.playerCollider.end.y < -25) {
        this.setPlayerPosition(new THREE.Vector3(0, 5, 0));
        this.playerVelocity.set(0, 0, 0);
        this.playerOnFloor = false;
        this.isGrounded = false;
    }
}

    // Helper functions for camera direction
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

    // Handles player input and updates desired velocity/collider height
    controls(deltaTime, input) {
        this.fwdPressed = input.forward;
        this.bkdPressed = input.backward;
        this.lftPressed = input.left;
        this.rgtPressed = input.right;
        this.jumpPressed = input.jump;
        this.crouchPressed = input.crouch;
        this.slowPressed = input.slow;

        let currentSpeedModifier = this.speedModifier;
        if (this.crouchPressed) {
            currentSpeedModifier *= 0.3;
        } else if (this.slowPressed) {
            currentSpeedModifier *= 0.5;
        } else if (this.isAim) {
            currentSpeedModifier *= 0.65;
        }

        const accel = this.onGround ? PLAYER_ACCEL_GROUND : PLAYER_ACCEL_AIR;
        const effectiveAccel = accel * currentSpeedModifier;
        const angle = this.camera.rotation.y;

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

        const hSpeed = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
        if (hSpeed > MAX_SPEED) {
            const ratio = MAX_SPEED / hSpeed;
            this.playerVelocity.x *= ratio;
            this.playerVelocity.z *= ratio;
        }

        if (!(this.fwdPressed || this.bkdPressed || this.lftPressed || this.rgtPressed) && this.onGround) {
            this.playerVelocity.x *= Math.exp(-6 * deltaTime);
            this.playerVelocity.z *= Math.exp(-6 * deltaTime);
        }
        else if (!this.onGround) {
            this.playerVelocity.x *= Math.exp(-0.5 * deltaTime);
            this.playerVelocity.z *= Math.exp(-0.5 * deltaTime);
        }

        // Jump logic
        if (this.onGround && this.jumpPressed) {
            this.playerVelocity.y = JUMP_VELOCITY;
            this.onGround = false;
            this.jumpTriggered = true;
        } else {
            this.jumpTriggered = false;
        }

        // Crouch/Stand transition:
        const wantCrouch = this.crouchPressed && this.onGround;
        this.targetHeight = wantCrouch ? CROUCH_HEIGHT : STAND_HEIGHT;
        this.currentHeight += (this.targetHeight - this.currentHeight) *
            Math.min(1, CROUCH_SPEED * deltaTime);

        // Update the collider's end point based on the current height.
        // The `start.y` will be kept at ground level by collision resolution if onGround is true.
        this.playerCollider.end.y = this.playerCollider.start.y + (this.currentHeight - 2 * COLLIDER_RADIUS);
    }

    // Teleports the player to a new position
    setPlayerPosition(position) {
        // Set collider start.y to be on the ground, plus radius.
        const colliderBaseY = position.y + COLLIDER_RADIUS + 0.1; // Add small offset
        this.playerCollider.start.set(position.x, colliderBaseY, position.z);
        // Set collider end.y based on current height
        this.playerCollider.end.set(
            position.x,
            colliderBaseY + (this.currentHeight - 2 * COLLIDER_RADIUS),
            position.z
        );

        this.playerVelocity.set(0, 0, 0);
        this.onGround = false;
        this.jumpTriggered = false;
        this.fallStartY = null;
        this.groundNormal.set(0, 1, 0);

        this.camera.position.copy(this.playerCollider.start);
        this.camera.position.y += this.currentHeight * 0.9;
        this.camera.rotation.set(0, 0, 0);
    }

    // Main game loop update function
    update(deltaTime, input) {
        deltaTime = Math.min(0.05, deltaTime);
        this.prevOnGround = this.onGround;

        // Footstep audio logic
        const speedXZ = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
        if (speedXZ > FOOT_DISABLED_THRESHOLD && this.onGround && !input.slow && !input.crouch) {
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
        } else if (this.onGround && speedXZ <= FOOT_DISABLED_THRESHOLD) {
            this.footAcc = 0;
        }

        this.controls(deltaTime, input);

        const physicsSteps = 5;
        for (let i = 0; i < physicsSteps; i++) {
            this.updatePlayer(deltaTime / physicsSteps);
        }

        // Landing audio logic
        if (!this.prevOnGround && this.onGround) {
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
        } else if (!this.onGround && this.fallStartY === null && this.playerVelocity.y < 0) {
            if (!this.fallStartTimer) {
                this.fallStartTimer = setTimeout(() => {
                    this.fallStartY = this.camera.position.y;
                    this.fallStartTimer = null;
                }, this.fallDelay);
            }
        } else if (this.onGround && this.fallStartY !== null) {
             this.fallStartY = null;
             if (this.fallStartTimer) {
                 clearTimeout(this.fallStartTimer);
                 this.fallStartTimer = null;
             }
        }

        // Update camera position to follow the player collider
        if (!this.playerCollider || !this.playerCollider.start) {
            console.error("ERROR: playerCollider or its start point is undefined before camera position update!");
            return {
                x: 0, y: 0, z: 0, rotY: 0, onGround: false, velocity: new THREE.Vector3(), velocityY: 0
            };
        }
        this.camera.position.x = this.playerCollider.start.x;
        this.camera.position.z = this.playerCollider.start.z;
        this.camera.position.y = this.playerCollider.start.y + this.currentHeight * 0.9;

        // Update player model (if present)
        if (this.playerModel) {
            if (this.onGround) {
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
            onGround: this.onGround,
            velocity: this.playerVelocity.clone(),
            velocityY: this.playerVelocity.y
        };
    }

    _pos() {
        const p = this.camera.position;
        return { x: p.x, y: p.y, z: p.z };
    }
}
