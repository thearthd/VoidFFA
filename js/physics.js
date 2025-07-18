import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import {
    computeBoundsTree,
    disposeBoundsTree,
    acceleratedRaycast,
} from 'https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.9.1/+esm';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
// ─── BVH Setup ────────────────────────────────────────────────────────────
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

import { MeshBVH, MeshBVHHelper } from 'three-mesh-bvh';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import { sendSoundEvent } from "./network.js";

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
            currentAudio.play().catch(() => {});
        }, delay);
    }
    return {
        start() {
            this.stop();
            currentAudio = new Audio(src);
            currentAudio.volume = volume;
            currentAudio.addEventListener('ended', scheduleNext);
            currentAudio.play().catch(() => {}).then(scheduleNext).catch(() => {});
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

        this.collisionMesh = null;

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

    async buildBVH(group) {
        const geometries = [];
        group.traverse(obj => {
            if (obj.isMesh) {
                const geom = obj.geometry.clone().applyMatrix4(obj.matrixWorld);
                geometries.push(geom);
            }
        });
        const merged = mergeGeometries(geometries, false);
        merged.boundsTree = new MeshBVH(merged);
        this.collisionMesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial());
        // this.scene.add(new MeshBVHHelper(this.collisionMesh, 10));
    }

        setSpeedModifier(value) {
        this.speedModifier = value;
    }

    playerCollisions() {
        const cap = this.playerCollider;
        const segStart = cap.start.clone();
        const segEnd = cap.end.clone();
        const box = new THREE.Box3().setFromPoints([segStart, segEnd]).expandByScalar(cap.radius);

        let deepest = 0;
        const normal = new THREE.Vector3();

        this.collisionMesh.geometry.boundsTree.shapecast({
            intersectsBounds: bounds => bounds.intersectsBox(box),
            intersectsTriangle: tri => {
                const closest = new THREE.Vector3();
                const dist = tri.closestPointToSegment({ start: segStart, end: segEnd }, segStart, closest);
                if (dist < cap.radius) {
                    const pushDir = segStart.clone().sub(closest).normalize();
                    const pushLen = cap.radius - dist;
                    if (pushLen > deepest) {
                        deepest = pushLen;
                        normal.copy(pushDir);
                    }
                }
            }
        });

        this.playerOnFloor = normal.y > 0.5;
        this.isGrounded = this.playerOnFloor;
        if (deepest > 0) {
            cap.translate(normal.multiplyScalar(deepest));
            if (this.playerVelocity.dot(normal) < 0) {
                this.playerVelocity.projectOnPlane(normal);
            }
        }
    }

    updatePlayer(deltaTime) {
        let damping = Math.exp(-4 * deltaTime) - 1;

        if (!this.playerOnFloor) {
            this.playerVelocity.y -= GRAVITY * deltaTime;
            damping *= 0.1;
        } else {
            const gravityComponent = _vector3.copy(this.groundNormal).multiplyScalar(-GRAVITY * deltaTime);
            this.playerVelocity.add(gravityComponent);
            this.playerVelocity.projectOnPlane(this.groundNormal);
            if (this.groundNormal.y > 0.99) {
                if (this.playerVelocity.y < 0) {
                    this.playerVelocity.y = 0;
                }
            } else {
                if (this.playerVelocity.dot(this.groundNormal) <= 0) {
                    this.playerVelocity.add(_vector3.copy(this.groundNormal).multiplyScalar(-0.1));
                }
            }
        }

        this.playerVelocity.x += this.playerVelocity.x * damping;
        this.playerVelocity.z += this.playerVelocity.z * damping;

        const horizontalSpeed = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
        if (horizontalSpeed > MAX_SPEED) {
            const ratio = MAX_SPEED / horizontalSpeed;
            this.playerVelocity.x *= ratio;
            this.playerVelocity.z *= ratio;
        }

        const deltaPosition = _vector1.copy(this.playerVelocity).multiplyScalar(deltaTime);
        this.playerCollider.translate(deltaPosition);

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
        const acceleration = this.playerOnFloor ? PLAYER_ACCEL_GROUND : PLAYER_ACCEL_AIR;
        const effectiveAcceleration = acceleration * this.speedModifier * (input.crouch ? 0.3 : input.slow ? 0.5 : this.isAim ? 0.65 : 1);
        const moveDirection = new THREE.Vector3();

        if (input.forward) moveDirection.add(this.getForwardVector());
        if (input.backward) moveDirection.add(this.getForwardVector().multiplyScalar(-1));
        if (input.left) moveDirection.add(this.getSideVector().multiplyScalar(-1));
        if (input.right) moveDirection.add(this.getSideVector());

        if (moveDirection.lengthSq() > 0) {
            moveDirection.normalize();
            if (this.playerOnFloor) moveDirection.projectOnPlane(this.groundNormal);
            this.playerVelocity.add(moveDirection.multiplyScalar(effectiveAcceleration * deltaTime));
        }

        if (this.playerOnFloor && input.jump) {
            this.playerVelocity.y = JUMP_VELOCITY;
            this.playerOnFloor = false;
            this.isGrounded = false;
            this.jumpTriggered = true;
        }

        const wantCrouch = input.crouch && this.isGrounded;
        this.targetHeight = wantCrouch ? CROUCH_HEIGHT : STAND_HEIGHT;
        this.currentHeight += (this.targetHeight - this.currentHeight) * Math.min(1, CROUCH_SPEED * deltaTime);
        this.playerCollider.end.y = this.playerCollider.start.y + (this.currentHeight - 2 * COLLIDER_RADIUS);
    }

    teleportIfOob() {
        if (this.playerCollider.end.y < -30 || this.playerCollider.start.y < -30) {
            this.setPlayerPosition(new THREE.Vector3(0, 5, 0));
            this.playerVelocity.set(0, 0, 0);
            this.playerOnFloor = false;
            this.isGrounded = false;
            this.jumpTriggered = false;
            this.fallStartY = null;
        }
    }

    setPlayerPosition(position) {
        const spawnY = position.y + 0.1;
        this.playerCollider.start.set(position.x, spawnY, position.z);
        this.playerCollider.end.set(position.x, spawnY + (this.currentHeight - 2 * COLLIDER_RADIUS), position.z);
        this.playerCollider.radius = COLLIDER_RADIUS;
        this.playerVelocity.set(0, 0, 0);
        this.playerOnFloor = false;
        this.isGrounded = false;
        this.jumpTriggered = false;
        this.fallStartY = null;
        this.groundNormal.set(0, 1, 0);
        this.camera.position.copy(this.playerCollider.start);
        this.camera.position.y += (this.currentHeight * 0.9);
        this.camera.rotation.set(0, 0, 0);
    }

    update(deltaTime, input) {
        deltaTime = Math.min(0.05, deltaTime);
        this.prevGround = this.isGrounded;
        const currentSpeedXZ = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);

        if (currentSpeedXZ > FOOT_DISABLED_THRESHOLD && this.isGrounded && !input.slow && !input.crouch) {
            const interval = this.baseFootInterval / currentSpeedXZ;
            this.footAcc += deltaTime;
            if (this.footAcc >= interval) {
                this.footAcc -= interval;
                const audio = this.footAudios[this.footIndex];
                audio.currentTime = 0;
                audio.play().catch(() => {});
                sendSoundEvent("footstep", "run", this._pos());
                this.footIndex = 1 - this.footIndex;
            }
        } else if (this.isGrounded && currentSpeedXZ <= FOOT_DISABLED_THRESHOLD) {
            this.footAcc = 0;
        }

        this.controls(deltaTime, input);
        this.updatePlayer(deltaTime);
        this.teleportIfOob();

        if (!this.prevGround && this.isGrounded) {
            if ((this.fallStartY !== null && (this.fallStartY - this.camera.position.y) > 1) ||
                (this.jumpTriggered && (this.fallStartY - this.camera.position.y) > 1)) {
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

        this.camera.position.x = this.playerCollider.start.x;
        this.camera.position.z = this.playerCollider.start.z;
        this.camera.position.y = this.playerCollider.start.y + (this.currentHeight * 0.9);

        if (this.isGrounded && this.playerModel) {
            const smoothingFactor = 0.15;
            const playerWorldForward = new THREE.Vector3();
            this.camera.getWorldDirection(playerWorldForward);
            playerWorldForward.y = 0;
            playerWorldForward.normalize();

            const playerWorldRight = new THREE.Vector3().crossVectors(playerWorldForward, this.groundNormal).normalize();
            const finalForward = new THREE.Vector3().crossVectors(this.groundNormal, playerWorldRight).normalize();

            const orientationMatrix = new THREE.Matrix4();
            orientationMatrix.makeBasis(playerWorldRight, this.groundNormal, finalForward);

            const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(orientationMatrix);
            this.playerModel.quaternion.slerp(targetQuaternion, smoothingFactor);
        } else if (this.playerModel) {
            const upAlignmentQuaternion = new THREE.Quaternion().setFromUnitVectors(this.playerModel.up, new THREE.Vector3(0, 1, 0));
            this.playerModel.quaternion.slerp(upAlignmentQuaternion, 0.05);
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
