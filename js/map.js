// js/map.js

import { Loader } from './Loader.js';
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
    computeBoundsTree,
    disposeBoundsTree,
    acceleratedRaycast,
} from 'https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.9.1/+esm';

// ─── BVH Setup ────────────────────────────────────────────────────────────
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;


// ─── Helper: build sequential indices if none present ────────────────────────
function generateSequentialIndices(vertexCount) {
    const idx = [];
    for (let i = 0; i < vertexCount; i++) idx.push(i);
    return idx;
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
                const box = new THREE.Box3().setFromObject(lanternGroup);
                lanternGroup.position.y = -box.min.y;

                lanternGroup.traverse(child => {
                    if (!child.isMesh) return;
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0xffffff,
                        roughness: 0.8,
                        metalness: 0.7,
                        side: THREE.DoubleSide
                    });
                    child.castShadow = child.receiveShadow = true;
                });

                // Original had: this.container.add(spot, spot.target);
                // Corrected to add lanternGroup and then the spot light
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
    // track loaded meshes and readiness
    window.envMeshes = [];
    window.mapReady = false;

    // Initialize loader UI with two milestones: GLB loading and Octree (load or build)
    const loaderUI = new Loader();
    // GLB loading is 90% of the total, Octree loading/building is 10%
    const mapLoadPercentages = [0.9, 0.1];
    loaderUI.show('Loading CrocodilosConstruction Map & Building Octree...', mapLoadPercentages);

    // scaling and spawn points
    const SCALE = 5;
    const rawSpawnPoints = [
        new THREE.Vector3(-14, 7, -36), // 1
        new THREE.Vector3(-2, 2, 37), // 2
        new THREE.Vector3(0, 2, 0), // 3
        new THREE.Vector3(2, 7, 34), // 4
        new THREE.Vector3(-5, 2, -38), // 5
        new THREE.Vector3(-18, 2, 12), // 6
        new THREE.Vector3(11, 2, 23), // 7
        new THREE.Vector3(-7, 7, -1), // 8
    ];
    const spawnPoints = rawSpawnPoints.map(p => p.clone().multiplyScalar(SCALE / 5));


    // set up sunlight and shadows
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

    // URL of the GLB model
    const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/croccodilosconstruction.glb';
    const OCTREE_STORAGE_KEY = 'crocodilosOctree'; // Unique key for localStorage
    // This is where you would place your pre-built Octree JSON file
    // Example: 'path/to/your/prebuilt_crocodilos_octree.json'
    const OCTREE_FILE_URL = null; // Set to your file URL, or null to skip file loading

    let gltfGroup = null;

    // 1) Load the GLB into the scene, wiring up a progress callback
    let onGLBProgress = () => {};
    const mapLoadPromise = new Promise((resolve, reject) => {
        new GLTFLoader().load(
            GLB_MODEL_URL,
            gltf => {
                gltfGroup = gltf.scene;
                gltfGroup.scale.set(SCALE, SCALE, SCALE);
                gltfGroup.updateMatrixWorld(true);
                scene.add(gltfGroup);

                gltfGroup.traverse(child => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        if (child.material.map) {
                            child.material.map.anisotropy = 4;
                        }
                        window.envMeshes.push(child);
                    }
                });

                console.log('✔️ GLB mesh loaded into scene.');
                resolve(gltfGroup);
            },
            evt => {
                if (evt.lengthComputable) onGLBProgress(evt);
            },
            err => {
                console.error('❌ Error loading CrocodilosConstruction GLB:', err);
                reject(err);
            }
        );
    });

    // track GLB load at 90%, with live percent updates
    loaderUI.track(mapLoadPercentages[0], mapLoadPromise, cb => {
        onGLBProgress = cb;
    });

    // 2) Once GLB is loaded, try to load Octree from storage, then file, then build
    let onOctreeProgress = () => {};
    const octreePromise = mapLoadPromise.then(async (group) => {
        let octreeResult = null;

        // Attempt 1: Load from Local Storage
        octreeResult = await physicsController.worldOctree.loadFromLocalStorage(OCTREE_STORAGE_KEY, onOctreeProgress);
        if (octreeResult) {
            console.log("Octree for CrocodilosConstruction loaded from local storage!");
            return; // Octree is loaded, exit
        }

        // Attempt 2: Load from Pre-built File (if URL is provided)
        if (OCTREE_FILE_URL) {
            octreeResult = await physicsController.worldOctree.loadFromFile(OCTREE_FILE_URL, onOctreeProgress);
            if (octreeResult) {
                console.log("Octree for CrocodilosConstruction loaded from file!");
                // Optionally save to local storage after successful file load for next time
                physicsController.worldOctree.saveToLocalStorage(OCTREE_STORAGE_KEY);
                return; // Octree is loaded, exit
            }
        }

        // Attempt 3: Build from GLB (fallback)
        console.log("No saved Octree found (or failed to load from file). Building Octree from GLB data...");
        await physicsController.buildOctree(group, onOctreeProgress);
        // After successful build, save to local storage
        physicsController.worldOctree.saveToLocalStorage(OCTREE_STORAGE_KEY);
        console.log("Octree built and saved to local storage!");
    });


    // track octree build/load at 10%, with live percent updates
    loaderUI.track(mapLoadPercentages[1], octreePromise, cb => {
        onOctreeProgress = cb;
    });

    // wait for both loading steps
    await Promise.all([mapLoadPromise, octreePromise]);

    // when fully done
    loaderUI.onComplete(() => {
        window.mapReady = true;
        console.log('🗺️ Map + Octree fully ready!');
    });

    return spawnPoints;
}


export async function createSigmaCity(scene, physicsController) {
    // track loaded meshes and readiness
    window.envMeshes = [];
    window.mapReady = false;

    // initialize loader UI with two milestones: GLB loading and Octree (load or build)
    const loaderUI = new Loader();
    const mapLoadPercentages = [0.9, 0.1];
    loaderUI.show('Loading SigmaCity Map & Building Octree...', mapLoadPercentages);

    // scaling and spawn points
    const SCALE = 2;
    const rawSpawnPoints = [
        new THREE.Vector3(0, 15, 0), // 1
    ];
    const spawnPoints = rawSpawnPoints.map(p => p.clone().multiplyScalar(SCALE / 2));


    // set up sunlight and shadows
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

    // URL of the GLB model
    const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/sigmaCITYPLEASE.glb';
    const OCTREE_STORAGE_KEY = 'sigmaCityOctree'; // Unique key for localStorage
    // This is where you would place your pre-built Octree JSON file
    // Example: 'path/to/your/prebuilt_sigma_octree.json'
    const OCTREE_FILE_URL = null; // Set to your file URL, or null to skip file loading

    // 1) Load the GLB into the scene, wiring up a progress callback
    let gltfGroup = null;
    let onGLBProgress = () => {};
    const mapLoadPromise = new Promise((resolve, reject) => {
        new GLTFLoader().load(
            GLB_MODEL_URL,
            gltf => {
                gltfGroup = gltf.scene;
                gltfGroup.scale.set(SCALE, SCALE, SCALE);
                gltfGroup.updateMatrixWorld(true);
                scene.add(gltfGroup);

                gltfGroup.traverse(child => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        if (child.material.map) {
                            child.material.map.anisotropy = 4;
                        }
                        window.envMeshes.push(child);
                    }
                    if (child.isMesh && child.geometry && !child.geometry.index) {
                        child.geometry.setIndex(generateSequentialIndices(child.geometry.attributes.position.count));
                    }
                });

                console.log('✔️ GLB mesh loaded into scene.');
                resolve(gltfGroup);
            },
            evt => {
                if (evt.lengthComputable) onGLBProgress(evt);
            },
            err => {
                console.error('❌ Error loading SigmaCity GLB:', err);
                reject(err);
            }
        );
    });

    // track GLB load at 90%, with live percent updates
    loaderUI.track(mapLoadPercentages[0], mapLoadPromise, cb => {
        onGLBProgress = cb;
    });

    // 2) Once GLB is loaded, try to load Octree from storage, then file, then build
    let onOctreeProgress = () => {};
    const octreePromise = mapLoadPromise.then(async (group) => {
        let octreeResult = null;

        // Attempt 1: Load from Local Storage
        octreeResult = await physicsController.worldOctree.loadFromLocalStorage(OCTREE_STORAGE_KEY, onOctreeProgress);
        if (octreeResult) {
            console.log("Octree for SigmaCity loaded from local storage!");
            return; // Octree is loaded, exit
        }

        // Attempt 2: Load from Pre-built File (if URL is provided)
        if (OCTREE_FILE_URL) {
            octreeResult = await physicsController.worldOctree.loadFromFile(OCTREE_FILE_URL, onOctreeProgress);
            if (octreeResult) {
                console.log("Octree for SigmaCity loaded from file!");
                // Optionally save to local storage after successful file load for next time
                physicsController.worldOctree.saveToLocalStorage(OCTREE_STORAGE_KEY);
                return; // Octree is loaded, exit
            }
        }

        // Attempt 3: Build from GLB (fallback)
        console.log("No saved Octree found (or failed to load from file). Building Octree from GLB data...");
        await physicsController.buildOctree(group, onOctreeProgress);
        // After successful build, save to local storage
        physicsController.worldOctree.saveToLocalStorage(OCTREE_STORAGE_KEY);
        console.log("Octree built and saved to local storage!");
    });

    // track octree build/load at 10%, with live percent updates
    loaderUI.track(mapLoadPercentages[1], octreePromise, cb => {
        onOctreeProgress = cb;
    });

    // wait for both loading steps
    await Promise.all([mapLoadPromise, octreePromise]);

    // when fully done
    loaderUI.onComplete(() => {
        window.mapReady = true;
        console.log('🗺️ Map + Octree fully ready!');
    });

    return spawnPoints;
}
