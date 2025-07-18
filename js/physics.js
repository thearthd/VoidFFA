import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.152.0/build/three.module.js';
import {
  MeshBVH,
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree
} from 'https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.9.1/+esm';

// Then wire up the BVH helpers:
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
import { Capsule } from "three/examples/jsm/math/Capsule.js";
import { sendSoundEvent } from "./network.js";

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
const _tmpBox   = new THREE.Box3();
const _plane    = new THREE.Plane();

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
        this.fallStartTimer = null;
        this.prevGround = false;
        this.jumpTriggered = false;

        this.speedModifier = 0;
        this.isAim = false;
        this.currentHeight = STAND_HEIGHT;
        this.targetHeight = STAND_HEIGHT;
        this.fallDelay = 300;
    }

    setSpeedModifier(value) {
        this.speedModifier = value;
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
                const idx = [];
                for (let i = 0; i < count; i++) idx.push(i);
                node.geometry.setIndex(idx);
            }
            node.geometry.boundsTree = new MeshBVH(node.geometry, { lazyGeneration: false });
            this.bvhMeshes.push(node);
            loaded++;
            onProgress({ loaded, total });
        });
    }

    getCapsuleTriangles(capsule, outTris) {
        outTris.length = 0;
        _tmpBox.setFromPoints([capsule.start, capsule.end]).expandByScalar(capsule.radius);
        for (const mesh of this.bvhMeshes) {
            mesh.geometry.boundsTree.shapecast({
                intersectsBounds: box => box.intersectsBox(_tmpBox),
                intersectsTriangle: tri => {
                    outTris.push(tri);
                }
            });
        }
        return outTris;
    }

    triangleCapsuleIntersect(cap, tri) {
        tri.getPlane(_plane);
        const dStart = _plane.distanceToPoint(cap.start) - cap.radius;
        const dEnd   = _plane.distanceToPoint(cap.end)   - cap.radius;
        if ((dStart > 0 && dEnd > 0) || (dStart < -cap.radius && dEnd < -cap.radius)) return null;

        const t = Math.abs(dStart) / (Math.abs(dStart) + Math.abs(dEnd));
        const midPoint = new THREE.Vector3().copy(cap.start).lerp(cap.end, t);

        if (tri.containsPoint(midPoint)) {
            const depth = Math.min(-dStart, -dEnd);
            return { normal: _plane.normal.clone(), depth: Math.abs(depth) };
        }

        const edges = [
            [tri.a, tri.b],
            [tri.b, tri.c],
            [tri.c, tri.a]
        ];
        const capSeg = { start: cap.start, end: cap.end };
        const rSq = cap.radius * cap.radius;

        for (const [v0, v1] of edges) {
            const edgeSeg = { start: v0, end: v1 };
            const ptOnTri = _vector1;
            const ptOnCap = _vector2;
            tri.closestPointToPoint(ptOnTri, cap.start);
            const seg = new THREE.Line3(cap.start, cap.end);
            seg.closestPointToPoint(ptOnTri, ptOnCap);
            const distSq = ptOnTri.distanceToSquared(ptOnCap);
            if (distSq < rSq) {
                const dist = Math.sqrt(distSq);
                return {
                    normal: ptOnCap.clone().sub(ptOnTri).normalize(),
                    depth: cap.radius - dist
                };
            }
        }

        return null;
    }

    playerCollisions() {
        const worldCap = new Capsule(
            this.playerCollider.start.clone(),
            this.playerCollider.end.clone(),
            this.playerCollider.radius
        );
        const tris = this.getCapsuleTriangles(worldCap, []);
        let best = null;
        for (const tri of tris) {
            const hit = this.triangleCapsuleIntersect(worldCap, tri);
            if (hit && (!best || hit.depth > best.depth)) best = hit;
        }

        this.playerOnFloor = false;
        this.isGrounded = false;
        this.groundNormal.set(0, 1, 0);

        if (best) {
            const { normal, depth } = best;
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

        this.playerVelocity.x += this.playerVelocity.x * damping;
        this.playerVelocity.z += this.playerVelocity.z * damping;

        const hSpeed = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
        if (hSpeed > MAX_SPEED) {
            const ratio = MAX_SPEED / hSpeed;
            this.playerVelocity.x *= ratio;
            this.playerVelocity.z *= ratio;
        }

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
        const effectiveAccel = accel * this.speedModifier * (input.crouch ? 0.3 : input.slow ? 0.5 : this.isAim ? 0.65 : 1);

        const moveDir = new THREE.Vector3();
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
        if (this.playerCollider.end.y < -30) {
            this.setPlayerPosition(new THREE.Vector3(0, 5, 0));
        }
    }

    setPlayerPosition(position) {
        const spawnY = position.y + 0.1;
        this.playerCollider.start.set(position.x, spawnY, position.z);
        this.playerCollider.end.set(position.x, spawnY + (this.currentHeight - 2 * COLLIDER_RADIUS), position.z);
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

        this.camera.position.x = this.playerCollider.start.x;
        this.camera.position.z = this.playerCollider.start.z;
        this.camera.position.y = this.playerCollider.start.y + this.currentHeight * 0.9;

        if (this.isGrounded && this.playerModel) {
            const forward = new THREE.Vector3();
            this.camera.getWorldDirection(forward);
            forward.y = 0; forward.normalize();
            const right = new THREE.Vector3().crossVectors(forward, this.groundNormal).normalize();
            const finalFwd = new THREE.Vector3().crossVectors(this.groundNormal, right).normalize();
            const mat = new THREE.Matrix4().makeBasis(right, this.groundNormal, finalFwd);
            const targetQ = new THREE.Quaternion().setFromRotationMatrix(mat);
            this.playerModel.quaternion.slerp(targetQ, 0.15);
        } else if (this.playerModel) {
            const upQ = new THREE.Quaternion().setFromUnitVectors(this.playerModel.up, new THREE.Vector3(0, 1, 0));
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
