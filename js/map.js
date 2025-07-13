// js/map.js (Updated with Geometry → BufferGeometry conversion for BVH)

import { Loader } from './Loader.js';
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
    computeBoundsTree,
    disposeBoundsTree,
    acceleratedRaycast,
    MeshBVH,
} from 'https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.9.1/+esm';

// Extend BufferGeometry and Mesh with BVH methods
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// Helper: generate sequential indices for un‑indexed geometries
function generateSequentialIndices(vertexCount) {
    const idx = [];
    for (let i = 0; i < vertexCount; i++) idx.push(i);
    return idx;
}

// Helper: convert legacy THREE.Geometry → non‑indexed BufferGeometry
function legacyToBufferGeometry(geom) {
    const positions = [];
    const normals = [];

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

                // center vertically
                const box = new THREE.Box3().setFromObject(lanternGroup);
                lanternGroup.position.y = -box.min.y;

                lanternGroup.traverse(child => {
                    if (!child.isMesh) return;

                    let geom = child.geometry;

                    // Convert old Geometry → BufferGeometry
                    if (geom instanceof THREE.Geometry) {
                        console.warn('Converting legacy Geometry → BufferGeometry for BVH');
                        geom = legacyToBufferGeometry(geom);
                        child.geometry = geom;
                    }

                    // Ensure indexed
                    if (!geom.index) {
                        const count = geom.attributes.position.count;
                        const array = new Uint32Array(count);
                        for (let i = 0; i < count; i++) array[i] = i;
                        geom.setIndex(new THREE.BufferAttribute(array, 1));
                    }

                    // Build the BVH
                    geom.computeBoundsTree();

                    child.material = new THREE.MeshStandardMaterial({
                        color: 0xffffff,
                        roughness: 0.8,
                        metalness: 0.7,
                        side: THREE.DoubleSide
                    });
                    child.castShadow = child.receiveShadow = true;
                });

                this.container.add(lanternGroup);

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

export async function createCrocodilosConstruction(scene, physicsController) {
    window.envMeshes = [];
    window.mapReady = false;

    const loaderUI = new Loader();
    const mapLoadPercentages = [0.9, 0.1];
    loaderUI.show('Loading CrocodilosConstruction Map & Building BVH...', mapLoadPercentages);

    const SCALE = 5;
    const rawSpawnPoints = [ new THREE.Vector3(-14,7,-36), /*…*/ ];
    const spawnPoints = rawSpawnPoints.map(p => p.clone().multiplyScalar(SCALE / 5));

    const sunLight = new THREE.DirectionalLight(0xffffff, 1);
    sunLight.position.set(50,100,50);
    sunLight.target.position.set(0,0,0);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048,2048);
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
                    let geom = child.geometry;

                    if (geom instanceof THREE.Geometry) {
                        console.warn('Converting legacy Geometry → BufferGeometry for BVH');
                        geom = legacyToBufferGeometry(geom);
                        child.geometry = geom;
                    }

                    if (!geom.index) {
                        const count = geom.attributes.position.count;
                        const idx = new Uint32Array(count);
                        for (let i = 0; i < count; i++) idx[i] = i;
                        geom.setIndex(new THREE.BufferAttribute(idx,1));
                    }

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

export async function createSigmaCity(scene, physicsController) {
    window.envMeshes = [];
    window.mapReady = false;

    const loaderUI = new Loader();
    const mapLoadPercentages = [0.9, 0.1];
    loaderUI.show('Loading SigmaCity Map & Building BVH...', mapLoadPercentages);

    const SCALE = 2;
    const rawSpawnPoints = [ new THREE.Vector3(0,15,0) ];
    const spawnPoints = rawSpawnPoints.map(p => p.clone().multiplyScalar(SCALE / 2));

    const sunLight = new THREE.DirectionalLight(0xffffff, 1);
    sunLight.position.set(50,100,50);
    sunLight.target.position.set(0,0,0);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048,2048);
    const d = 100;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.camera.near = 0.1;
    sunLight.shadow.camera.far = 200;
    scene.add(sunLight, sunLight.target);

    const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/sigmaCITYPLEASE.glb';

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
                    let geom = child.geometry;

                    if (geom instanceof THREE.Geometry) {
                        console.warn('Converting legacy Geometry → BufferGeometry for BVH');
                        geom = legacyToBufferGeometry(geom);
                        child.geometry = geom;
                    }

                    if (!geom.index) {
                        const count = geom.attributes.position.count;
                        const idx = new Uint32Array(count);
                        for (let i = 0; i < count; i++) idx[i] = i;
                        geom.setIndex(new THREE.BufferAttribute(idx,1));
                    }

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

    let onBVHProgress = () => {};
    const bvhPromise = mapLoadPromise.then(group => physicsController.buildBVH(group, onBVHProgress));
    loaderUI.track(mapLoadPercentages[1], bvhPromise, cb => onBVHProgress = cb);

    await Promise.all([mapLoadPromise, bvhPromise]);
    loaderUI.onComplete(() => { window.mapReady = true; });

    return spawnPoints;
}
