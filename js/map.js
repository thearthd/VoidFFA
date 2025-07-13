// js/map.js (Fully updated with safe Geometry→BufferGeometry conversion for BVH)

import { Loader } from './Loader.js';
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
    computeBoundsTree,
    disposeBoundsTree,
    acceleratedRaycast
} from 'https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.9.1/+esm';

// ─── BVH Setup: Extend BufferGeometry and Mesh prototypes ───────────────────
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// ─── Helper: build sequential indices if none present ────────────────────────
function generateSequentialIndices(vertexCount) {
    const idx = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) idx[i] = i;
    return idx;
}

// ─── Helper: convert any non‑BufferGeometry → BufferGeometry ───────────────
function legacyToBufferGeometry(geom) {
    const positions = [];
    const normals = [];

    // If it's already a BufferGeometry but non-indexed, handle separately
    if (geom.isBufferGeometry) {
        return geom;
    }

    // Otherwise assume it behaves like old THREE.Geometry
    for (const face of geom.faces) {
        ['a','b','c'].forEach((key, i) => {
            const v = geom.vertices[ face[key] ];
            positions.push(v.x, v.y, v.z);

            const n = (face.vertexNormals.length === 3)
                ? face.vertexNormals[i]
                : face.normal;
            normals.push(n.x, n.y, n.z);
        });
    }

    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    buffer.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3));
    return buffer;
}

// ─── Lantern class ─────────────────────────────────────────────────────────
export class Lantern {
    constructor(parent, position, scale = 1, lightOptions = {}) {
        this.container = new THREE.Object3D();
        this.container.position.copy(position);
        parent.add(this.container);

        const url = 'https://raw.githubusercontent.com/thearthd/3d-models/refs/heads/main/uploads_files_2887463_Lantern.obj';
        const loader = new OBJLoader();

        loader.load(
            url,
            lanternGroup => {
                lanternGroup.scale.set(scale, scale, scale);
                lanternGroup.updateMatrixWorld(true);

                // Center vertically
                const box = new THREE.Box3().setFromObject(lanternGroup);
                lanternGroup.position.y = -box.min.y;

                lanternGroup.traverse(child => {
                    if (!child.isMesh) return;

                    // Convert any non‑BufferGeometry into BufferGeometry
                    let geom = child.geometry;
                    if (!geom.isBufferGeometry) {
                        console.warn('Converting non‑BufferGeometry → BufferGeometry for BVH');
                        geom = legacyToBufferGeometry(geom);
                        child.geometry = geom;
                    }

                    // Ensure indexed
                    if (!geom.index) {
                        geom.setIndex(new THREE.BufferAttribute(generateSequentialIndices(geom.attributes.position.count), 1));
                    }

                    // Build BVH
                    geom.computeBoundsTree();

                    // Standard material & shadows
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0xffffff,
                        roughness: 0.8,
                        metalness: 0.7,
                        side: THREE.DoubleSide
                    });
                    child.castShadow = child.receiveShadow = true;
                });

                this.container.add(lanternGroup);

                // Spot light setup
                const {
                    color = 0xffffff,
                    intensity = 1,
                    distance = 10,
                    angle = Math.PI / 8,
                    penumbra = 0.5,
                    decay = 2
                } = lightOptions;

                const spot = new THREE.SpotLight(color, intensity, distance, angle, penumbra, decay);
                spot.position.set(0, (box.max.y - box.min.y) * 0.75, 0);
                spot.target.position.set(0, -20, 0);
                spot.castShadow = true;
                spot.shadow.mapSize.set(512, 512);
                spot.shadow.camera.near = 0.5;
                spot.shadow.camera.far = distance;
                this.container.add(spot, spot.target);
            },
            null,
            err => console.error('Error loading lantern model:', err)
        );
    }
}

// ─── createCrocodilosConstruction ─────────────────────────────────────────
export async function createCrocodilosConstruction(scene, physicsController) {
    window.envMeshes = [];
    window.mapReady = false;

    const loaderUI = new Loader();
    const mapLoadPercentages = [0.9, 0.1];
    loaderUI.show('Loading CrocodilosConstruction Map & Building BVH...', mapLoadPercentages);

    const SCALE = 5;
    const rawSpawnPoints = [
        new THREE.Vector3(-14, 7, -36),
        new THREE.Vector3(-2, 2, 37),
        new THREE.Vector3(0, 2, 0),
        new THREE.Vector3(2, 7, 34),
        new THREE.Vector3(-5, 2, -38),
        new THREE.Vector3(-18, 2, 12),
        new THREE.Vector3(11, 2, 23),
        new THREE.Vector3(-7, 7, -1),
    ];
    const spawnPoints = rawSpawnPoints.map(p => p.clone().multiplyScalar(SCALE / 5));

    // Sunlight
    const sunLight = new THREE.DirectionalLight(0xffffff, 1);
    sunLight.position.set(50, 100, 50);
    sunLight.target.position.set(0, 0, 0);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    const d = 100;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.camera.near = 0.1;
    sunLight.shadow.camera.far = 200;
    scene.add(sunLight, sunLight.target);

    const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/croccodilosconstruction.glb';

    // 1) Load GLB
    let onGLBProgress = () => {};
    const mapLoadPromise = new Promise((resolve, reject) => {
        new GLTFLoader().load(
            GLB_MODEL_URL,
            gltf => {
                const group = gltf.scene;
                group.scale.set(SCALE, SCALE, SCALE);
                group.updateMatrixWorld(true);
                scene.add(group);

                group.traverse(child => {
                    if (!child.isMesh) return;

                    // Convert any non‑BufferGeometry
                    let geom = child.geometry;
                    if (!geom.isBufferGeometry) {
                        console.warn('Converting non‑BufferGeometry → BufferGeometry for BVH');
                        geom = legacyToBufferGeometry(geom);
                        child.geometry = geom;
                    }

                    // Ensure indexed
                    if (!geom.index) {
                        geom.setIndex(new THREE.BufferAttribute(generateSequentialIndices(geom.attributes.position.count), 1));
                    }

                    // Build BVH
                    geom.computeBoundsTree();

                    child.castShadow = child.receiveShadow = true;
                    if (child.material.map) child.material.map.anisotropy = 4;
                    window.envMeshes.push(child);
                });

                resolve(group);
            },
            evt => { if (evt.lengthComputable) onGLBProgress(evt); },
            err => reject(err)
        );
    });
    loaderUI.track(mapLoadPercentages[0], mapLoadPromise, cb => onGLBProgress = cb);

    // 2) Build BVH
    let onBVHProgress = () => {};
    const bvhPromise = mapLoadPromise.then(group => physicsController.buildBVH(group, onBVHProgress));
    loaderUI.track(mapLoadPercentages[1], bvhPromise, cb => onBVHProgress = cb);

    await Promise.all([mapLoadPromise, bvhPromise]);
    loaderUI.onComplete(() => { window.mapReady = true; });

    return spawnPoints;
}

// ─── createSigmaCity ───────────────────────────────────────────────────────
export async function createSigmaCity(scene, physicsController) {
    window.envMeshes = [];
    window.mapReady = false;

    const loaderUI = new Loader();
    const mapLoadPercentages = [0.9, 0.1];
    loaderUI.show('Loading SigmaCity Map & Building BVH...', mapLoadPercentages);

    const SCALE = 2;
    const rawSpawnPoints = [ new THREE.Vector3(0, 15, 0) ];
    const spawnPoints = rawSpawnPoints.map(p => p.clone().multiplyScalar(SCALE / 2));

    // Sunlight
    const sunLight = new THREE.DirectionalLight(0xffffff, 1);
    sunLight.position.set(50, 100, 50);
    sunLight.target.position.set(0, 0, 0);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    const d2 = 100;
    sunLight.shadow.camera.left = -d2;
    sunLight.shadow.camera.right = d2;
    sunLight.shadow.camera.top = d2;
    sunLight.shadow.camera.bottom = -d2;
    sunLight.shadow.camera.near = 0.1;
    sunLight.shadow.camera.far = 200;
    scene.add(sunLight, sunLight.target);

    const GLB_MODEL_URL2 = 'https://raw.githubusercontent.com/thearthd/3d-models/main/sigmaCITYPLEASE.glb';

    let onGLBProgress2 = () => {};
    const mapLoadPromise2 = new Promise((resolve, reject) => {
        new GLTFLoader().load(
            GLB_MODEL_URL2,
            gltf => {
                const group = gltf.scene;
                group.scale.set(SCALE, SCALE, SCALE);
                group.updateMatrixWorld(true);
                scene.add(group);

                group.traverse(child => {
                    if (!child.isMesh) return;

                    let geom = child.geometry;
                    if (!geom.isBufferGeometry) {
                        console.warn('Converting non‑BufferGeometry → BufferGeometry for BVH');
                        geom = legacyToBufferGeometry(geom);
                        child.geometry = geom;
                    }
                    if (!geom.index) {
                        geom.setIndex(new THREE.BufferAttribute(generateSequentialIndices(geom.attributes.position.count), 1));
                    }
                    geom.computeBoundsTree();

                    child.castShadow = child.receiveShadow = true;
                    if (child.material.map) child.material.map.anisotropy = 4;
                    window.envMeshes.push(child);
                });

                resolve(group);
            },
            evt => { if (evt.lengthComputable) onGLBProgress2(evt); },
            err => reject(err)
        );
    });
    loaderUI.track(mapLoadPercentages[0], mapLoadPromise2, cb => onGLBProgress2 = cb);

    let onBVHProgress2 = () => {};
    const bvhPromise2 = mapLoadPromise2.then(group => physicsController.buildBVH(group, onBVHProgress2));
    loaderUI.track(mapLoadPercentages[1], bvhPromise2, cb => onBVHProgress2 = cb);

    await Promise.all([mapLoadPromise2, bvhPromise2]);
    loaderUI.onComplete(() => { window.mapReady = true; });

    return spawnPoints;
}
