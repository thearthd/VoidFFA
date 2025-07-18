import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { MeshBVH, MeshBVHVisualizer } from 'https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.5.10/build/index.module.js';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
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
const GRAVITY = 27.5;
const CROUCH_SPEED = 8;
const FOOT_DISABLED_THRESHOLD = 0.2;
const PLAYER_ACCEL_GROUND = 25;
const PLAYER_ACCEL_AIR = 8;
const MAX_SPEED = 10;

// Vector helpers to avoid re-allocations
const _vector1 = new THREE.Vector3();
const _vector2 = new THREE.Vector3();
const _vector3 = new THREE.Vector3();

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

        // Collection of meshes with BVH
        this.bvhMeshes = [];

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
        this.footAudios.forEach(audio => { audio.volume = 0.7; });
        this.footIndex = 0;
        this.footAcc = 0;
        this.baseFootInterval = 3;
        this.landAudio = new Audio("https://codehs.com/uploads/600ab769d99d74647db55a468b19761f");
        this.landAudio.volume = 0.8;
        this.fallStartY = null;
        this.prevGround = false;
        this.jumpTriggered = false;

        this.speedModifier = 0;
        this.isAim = false;
        this.currentHeight = STAND_HEIGHT;
        this.targetHeight = STAND_HEIGHT;
        this.fallDelay = 300;
    }

    /**
     * Walk `group` and build a BVH on each mesh's geometry.
     * onProgress({ loaded, total }) is called as each mesh is processed.
     */
    async buildBVH(group, onProgress = () => {}) {
        this.bvhMeshes = [];
        let total = 0, loaded = 0;

        group.traverse((node) => {
            if (node.isMesh && node.geometry.isBufferGeometry) total++;
        });

        group.traverse((node) => {
            if (!node.isMesh || !node.geometry.isBufferGeometry) return;
            // build BVH synchronously
            node.geometry.boundsTree = new MeshBVH(node.geometry, { lazyGeneration: false });
            this.bvhMeshes.push(node);

            loaded++;
            onProgress({ loaded, total });
        });
    }
    setSpeedModifier(value) {
        this.speedModifier = value;
    }
    /**
     * Test capsule against all BVH meshes and return the deepest hit
     * as { normal: Vector3, depth: Number } or null.
     */
playerCollisions() {
    let result = null;

    for (const mesh of this.bvhMeshes) {
        const inverse = mesh.matrixWorld.clone().invert();
        const localStart = this.playerCollider.start.clone().applyMatrix4(inverse);
        const localEnd   = this.playerCollider.end.clone().applyMatrix4(inverse);
        const localCapsule = new Capsule(localStart, localEnd, this.playerCollider.radius);

        let hit = { normal: new THREE.Vector3(), depth: 0 };

        mesh.geometry.boundsTree.shapecast({
            // Use AABB-vs-capsule bounding-box as a cheap cull
            intersectsBounds: box => {
                const capsuleBBox = new THREE.Box3()
                    .setFromPoints([localCapsule.start, localCapsule.end])
                    .expandByScalar(localCapsule.radius);
                return box.intersectsBox(capsuleBBox);
            },
            intersectsTriangle: tri => {
                const depth = localCapsule.getPenetrationDepth(tri, _vector2);
                if (depth > hit.depth) {
                    hit.depth = depth;
                    _vector2.normalize();
                    hit.normal.copy(_vector2)
                              .applyMatrix3(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld))
                              .normalize();
                }
            }
        });

        if (hit.depth > 0 && (!result || hit.depth > result.depth)) {
            result = hit;
        }
    }

        this.playerOnFloor = false;
        this.isGrounded  = false;
        this.groundNormal.set(0, 1, 0);

        if (result && result.depth > 0) {
            const { normal, depth } = result;
            this.playerOnFloor = normal.y > 0.5;
            this.isGrounded = this.playerOnFloor;
            if (this.playerOnFloor) this.groundNormal.copy(normal);

            const SKIN = 0.02;
            if (depth > SKIN) {
                this.playerCollider.translate(_vector1.copy(normal).multiplyScalar(depth - SKIN));
            }
            if (this.playerVelocity.dot(normal) < 0) {
                _vector2.copy(this.playerVelocity).projectOnPlane(normal);
                this.playerVelocity.copy(_vector2);
            }
        }
    }

    updatePlayer(deltaTime) {
        let damping = Math.exp(-4 * deltaTime) - 1;

        if (!this.playerOnFloor) {
            this.playerVelocity.y -= GRAVITY * deltaTime;
            damping *= 0.1;
        } else {
            // slope-snapping
            const gravityComp = _vector3.copy(this.groundNormal).multiplyScalar(-GRAVITY * deltaTime);
            this.playerVelocity.add(gravityComp);
            this.playerVelocity.projectOnPlane(this.groundNormal);
            if (this.groundNormal.y > 0.99) {
                if (this.playerVelocity.y < 0) this.playerVelocity.y = 0;
            } else {
                if (this.playerVelocity.dot(this.groundNormal) <= 0) {
                    this.playerVelocity.add(_vector3.copy(this.groundNormal).multiplyScalar(-0.1));
                }
            }
        }

        // horizontal damping
        this.playerVelocity.x += this.playerVelocity.x * damping;
        this.playerVelocity.z += this.playerVelocity.z * damping;

        // cap speed
        const hSpeed = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
        if (hSpeed > MAX_SPEED) {
            const ratio = MAX_SPEED / hSpeed;
            this.playerVelocity.x *= ratio;
            this.playerVelocity.z *= ratio;
        }

        // move capsule
        const deltaPos = _vector1.copy(this.playerVelocity).multiplyScalar(deltaTime);
        this.playerCollider.translate(deltaPos);

        this.playerCollisions();
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

        const moveDir = new THREE.Vector3();
        if (input.forward)  moveDir.add(this.getForwardVector());
        if (input.backward) moveDir.add(this.getForwardVector().multiplyScalar(-1));
        if (input.left)     moveDir.add(this.getSideVector().multiplyScalar(-1));
        if (input.right)    moveDir.add(this.getSideVector());

        if (moveDir.lengthSq() > 0) {
            moveDir.normalize();
            if (this.playerOnFloor) moveDir.projectOnPlane(this.groundNormal);
            this.playerVelocity.add(moveDir.multiplyScalar(effectiveAccel * deltaTime));
        }

        if (this.playerOnFloor && input.jump) {
            this.playerVelocity.y = JUMP_VELOCITY;
            this.playerOnFloor = false;
            this.isGrounded = false;
            this.jumpTriggered = true;
        }

        // crouch / stand
        const wantCrouch = input.crouch && this.isGrounded;
        this.targetHeight = wantCrouch ? CROUCH_HEIGHT : STAND_HEIGHT;
        this.currentHeight += (this.targetHeight - this.currentHeight) *
                              Math.min(1, CROUCH_SPEED * deltaTime);
        this.playerCollider.end.y = this.playerCollider.start.y +
                                    (this.currentHeight - 2 * COLLIDER_RADIUS);
    }

    teleportIfOob() {
        if (this.playerCollider.end.y < -30) {
            console.warn("Player OOB detected! Teleporting...");
            this.setPlayerPosition(new THREE.Vector3(0, 5, 0));
        }
    }

    setPlayerPosition(position) {
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
        this.camera.rotation.set(0, 0, 0);
    }

    update(deltaTime, input) {
        deltaTime = Math.min(0.05, deltaTime);
        this.prevGround = this.isGrounded;

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

        this.controls(deltaTime, input);
        this.updatePlayer(deltaTime);
        this.teleportIfOob();

        // landing sound
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

        // camera follow
        this.camera.position.x = this.playerCollider.start.x;
        this.camera.position.z = this.playerCollider.start.z;
        this.camera.position.y = this.playerCollider.start.y + this.currentHeight * 0.9;

        // model tilt on slopes
        if (this.isGrounded && this.playerModel) {
            const smoothing = 0.15;
            const forward = new THREE.Vector3();
            this.camera.getWorldDirection(forward);
            forward.y = 0; forward.normalize();

            const right = new THREE.Vector3().crossVectors(forward, this.groundNormal).normalize();
            const finalFwd = new THREE.Vector3().crossVectors(this.groundNormal, right).normalize();
            const mat = new THREE.Matrix4().makeBasis(right, this.groundNormal, finalFwd);
            const targetQ = new THREE.Quaternion().setFromRotationMatrix(mat);
            this.playerModel.quaternion.slerp(targetQ, smoothing);
        } else if (this.playerModel) {
            const upQ = new THREE.Quaternion().setFromUnitVectors(
                this.playerModel.up, new THREE.Vector3(0, 1, 0)
            );
            this.playerModel.quaternion.slerp(upQ, 0.05);
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
