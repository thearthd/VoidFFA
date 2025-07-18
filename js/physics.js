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
const GRAVITY = -27.5; // Corrected: Gravity should be negative
const CROUCH_SPEED = 8;
const FOOT_DISABLED_THRESHOLD = 0.2;
const PLAYER_ACCEL_GROUND = 25;
const PLAYER_ACCEL_AIR = 8;
const MAX_SPEED = 10;

const SKIN = 0.005;

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
        this.isGrounded = false;
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
        this.fallDelay = 300;

        this.jumpTriggered = false;
        this.speedModifier = 1;
        this.currentHeight = STAND_HEIGHT;
        this.targetHeight = STAND_HEIGHT;

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

    _singlePhysicsStep(deltaTime) {
        if (this.bvhMeshes.length === 0) {
            this.playerVelocity.y += deltaTime * GRAVITY; // Use corrected GRAVITY
            const deltaPosition = _vector3.copy(this.playerVelocity).multiplyScalar(deltaTime);
            this.playerCollider.start.add(deltaPosition);
            this.playerCollider.end.add(deltaPosition);

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

            if (!(this.fwdPressed || this.bkdPressed || this.lftPressed || this.rgtPressed) && !this.isGrounded) {
                this.playerVelocity.x *= Math.exp(-4 * deltaTime);
                this.playerVelocity.z *= Math.exp(-4 * deltaTime);
            }
            if (this.playerCollider.end.y < -25) {
                this.setPlayerPosition(new THREE.Vector3(0, 5, 0));
                this.playerVelocity.set(0, 0, 0);
                this.isGrounded = false;
            }
            return;
        }

        // --- Core Physics Logic from 'pe' ---

        if (!this.isGrounded) { // Only apply full gravity if not grounded
            this.playerVelocity.y += deltaTime * GRAVITY;
        } else {
            // If grounded, clear vertical velocity and apply a small downward push to stick to ground
            this.playerVelocity.y = 0;
            // The reference code sets h.y = -30 (GRAVITY) and then to 0. This is a subtle way
            // to ensure the player is pushed onto the surface but doesn't accumulate vertical velocity.
            // We'll mimic this by ensuring vertical velocity is 0 if grounded.
        }

        // Apply player velocity to the collider's position directly
        const moveStep = _vector3.copy(this.playerVelocity).multiplyScalar(deltaTime);
        this.playerCollider.start.add(moveStep);
        this.playerCollider.end.add(moveStep);

        // Apply player input movement (horizontal)
        const angle = this.camera.rotation.y;
        let currentSpeedModifier = this.speedModifier;
        if (this.crouchPressed) {
            currentSpeedModifier *= 0.3;
        } else if (this.slowPressed) {
            currentSpeedModifier *= 0.5;
        } else if (this.isAim) {
            currentSpeedModifier *= 0.65;
        }
        const effectiveAccel = PLAYER_ACCEL_GROUND * currentSpeedModifier; // a.playerSpeed in reference

        _vector1.set(0, 0, 0); // Re-use for input direction
        if (this.fwdPressed) {
            _vector1.add(_vector2.set(0, 0, -1).applyAxisAngle(_upVector, angle));
        }
        if (this.bkdPressed) {
            _vector1.add(_vector2.set(0, 0, 1).applyAxisAngle(_upVector, angle));
        }
        if (this.lftPressed) {
            _vector1.add(_vector2.set(-1, 0, 0).applyAxisAngle(_upVector, angle));
        }
        if (this.rgtPressed) {
            _vector1.add(_vector2.set(1, 0, 0).applyAxisAngle(_upVector, angle));
        }

        if (_vector1.lengthSq() > 0) {
            _vector1.normalize().multiplyScalar(effectiveAccel * deltaTime);
            this.playerCollider.start.add(_vector1);
            this.playerCollider.end.add(_vector1);
        }

        // Collision detection and resolution
        const capsuleInfo = {
            radius: COLLIDER_RADIUS,
            segment: new THREE.Line3(
                this.playerCollider.start.clone(),
                this.playerCollider.end.clone()
            )
        };

        _tmpBox.makeEmpty();
        _tmpBox.expandByPoint(capsuleInfo.segment.start);
        _tmpBox.expandByPoint(capsuleInfo.segment.end);
        _tmpBox.min.addScalar(-capsuleInfo.radius);
        _tmpBox.max.addScalar(capsuleInfo.radius);

        this.isGrounded = false; // Assume not grounded until a collision proves otherwise

        const meshForShapecast = this.bvhMeshes.length > 0 ? this.bvhMeshes[0] : null;

        if (meshForShapecast) {
            _tmpInverseMat.copy(meshForShapecast.matrixWorld).invert();

            // Transform the capsule segment into the mesh's local space for shapecast
            _tempSegment.copy(capsuleInfo.segment);
            _tempSegment.start.applyMatrix4(_tmpInverseMat);
            _tempSegment.end.applyMatrix4(_tmpInverseMat);

            meshForShapecast.geometry.boundsTree.shapecast({
                intersectsBounds: box => {
                    _tmpLocalBox.copy(box).applyMatrix4(meshForShapecast.matrixWorld);
                    return _tmpLocalBox.intersectsBox(_tmpBox);
                },
                intersectsTriangle: tri => {
                    const triPoint = _vector1;
                    const capsulePoint = _vector2;

                    const distance = tri.closestPointToSegment(_tempSegment, triPoint, capsulePoint);

                    if (distance < capsuleInfo.radius) {
                        const penetrationDepth = capsuleInfo.radius - distance;
                        const collisionNormal = capsulePoint.sub(triPoint).normalize();

                        // Transform normal back to world space to check if it's ground
                        const worldNormal = _vector3.copy(collisionNormal).transformDirection(meshForShapecast.matrixWorld);

                        if (worldNormal.dot(_upVector) > 0.75) { // Check if normal is mostly upwards
                            this.isGrounded = true; // Set grounded flag
                            this.groundNormal.copy(worldNormal); // Store the ground normal
                        }

                        // Apply displacement to push the capsule out of penetration
                        _tempSegment.start.addScaledVector(collisionNormal, penetrationDepth);
                        _tempSegment.end.addScaledVector(collisionNormal, penetrationDepth);

                        // Adjust velocity to slide along the surface
                        // Remove the component of velocity that is moving into the obstacle.
                        this.playerVelocity.addScaledVector(collisionNormal, -collisionNormal.dot(this.playerVelocity));
                    }
                }
            });

            // After all shapecasts and resolutions for this step, update the playerCollider's actual position
            // by transforming the resolved _tempSegment back to world space.
            this.playerCollider.start.copy(_tempSegment.start).applyMatrix4(meshForShapecast.matrixWorld);
            this.playerCollider.end.copy(_tempSegment.end).applyMatrix4(meshForShapecast.matrixWorld);
        }

        // Out of bounds teleport (using collider's actual position)
        if (this.playerCollider.end.y < -25) {
            this.setPlayerPosition(new THREE.Vector3(0, 5, 0));
            this.playerVelocity.set(0, 0, 0);
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

        // Apply horizontal damping (friction/drag) before adding new movement
        if (!(this.fwdPressed || this.bkdPressed || this.lftPressed || this.rgtPressed) && this.isGrounded) {
            this.playerVelocity.x *= Math.exp(-6 * deltaTime);
            this.playerVelocity.z *= Math.exp(-6 * deltaTime);
        }
        else if (!this.isGrounded) {
            this.playerVelocity.x *= Math.exp(-0.5 * deltaTime);
            this.playerVelocity.z *= Math.exp(-0.5 * deltaTime);
        }

        // Jump logic
        if (this.isGrounded && this.jumpPressed) {
            this.playerVelocity.y = JUMP_VELOCITY;
            this.isGrounded = false;
            this.jumpTriggered = true;
        } else {
            this.jumpTriggered = false;
        }

        // Crouch/Stand transition logic
        const wantCrouch = this.crouchPressed;
        this.targetHeight = wantCrouch ? CROUCH_HEIGHT : STAND_HEIGHT;

        const desiredColliderSegmentLength = this.targetHeight - 2 * COLLIDER_RADIUS;
        const currentColliderSegmentLength = this.playerCollider.end.y - this.playerCollider.start.y;

        // Smoothly interpolate current height towards target height
        const newHeight = this.currentHeight + (this.targetHeight - this.currentHeight) * Math.min(1, CROUCH_SPEED * deltaTime);

        // Adjust collider position based on height change
        if (Math.abs(newHeight - this.currentHeight) > 0.001) { // Only adjust if there's a significant height change
            const heightDelta = newHeight - this.currentHeight;

            if (this.isGrounded) {
                // When grounded, adjust both start and end points to effectively change height
                // while keeping the *bottom* of the capsule in place relative to the ground.
                this.playerCollider.start.y += heightDelta;
                this.playerCollider.end.y += heightDelta;
            } else {
                // When airborne, adjust relative to the collider's existing start point.
                // The visual effect will be that the player's "feet" move relative to their current position.
                this.playerCollider.end.y = this.playerCollider.start.y + (newHeight - 2 * COLLIDER_RADIUS);
            }
            this.currentHeight = newHeight;
        }

        if (!this.playerCollider || !this.playerCollider.start || !this.playerCollider.end) {
            console.error("ERROR: playerCollider or its start/end points are undefined before updating end.y in controls!");
            return;
        }
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

        const physicsSteps = 5;
        for (let i = 0; i < physicsSteps; i++) {
            this._singlePhysicsStep(deltaTime / physicsSteps);
        }

        // Landing audio logic: Detect transition from not grounded to grounded
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
        } else if (!this.isGrounded && this.fallStartY === null && this.playerVelocity.y < 0) {
            if (!this.fallStartTimer) {
                this.fallStartTimer = setTimeout(() => {
                    this.fallStartY = this.camera.position.y;
                    this.fallStartTimer = null;
                }, this.fallDelay);
            }
        } else if (this.isGrounded && this.fallStartY !== null) {
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
        this.camera.position.y = this.playerCollider.start.y + (this.currentHeight * 0.9); // Keep camera at eye level based on currentHeight

        // Optional: Update player model position and rotation (if you have one)
        if (this.playerModel) {
            // Player model position should match the collider's base
            this.playerModel.position.copy(this.playerCollider.start);
            this.playerModel.position.y -= COLLIDER_RADIUS; // Adjust model position to sit on collider base

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
