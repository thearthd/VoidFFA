// js/map.js (Keep as is from the last update)

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

    // Initialize loader UI with two milestones: 70% for GLB, 30% for octree
    const loaderUI = new Loader();
    const mapLoadPercentages = [0.9, 0.1]; // GLB is 70%, Octree is 30%
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

    // 1) Load the GLB into the scene, wiring up a progress callback
    let gltfGroup = null; // Declare gltfGroup here
    let onGLBProgress = () => {};
    const mapLoadPromise = new Promise((resolve, reject) => {
        new GLTFLoader().load(
            GLB_MODEL_URL,
            gltf => {
                gltfGroup = gltf.scene; // Assign to gltfGroup
                gltfGroup.scale.set(SCALE, SCALE, SCALE);
                gltfGroup.updateMatrixWorld(true); // Crucial for correct vertex transformation
                scene.add(gltfGroup);

                // enable shadows and anisotropy on all meshes
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
                resolve(gltfGroup); // Resolve with the group so octree can use it
            },
            // progress callback
            evt => {
                if (evt.lengthComputable) onGLBProgress(evt);
            },
            err => {
                console.error('❌ Error loading CrocodilosConstruction GLB:', err);
                reject(err);
            }
        );
    });

    // track GLB load at 70%, with live percent updates
    loaderUI.track(mapLoadPercentages[0], mapLoadPromise, cb => {
        onGLBProgress = cb;
    });

    // 2) Once GLB is added, build the octree
    let onOctreeProgress = () => {};
    const octreePromise = mapLoadPromise.then(group => {
        // physicsController.buildOctree now returns a promise and takes the progress callback
        return physicsController.buildOctree(group, (evt) => {
            onOctreeProgress(evt);
        });
    });

    // track octree build at 30%, with live percent updates
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

    // initialize loader UI with two milestones: 70% for GLB, 30% for octree
    const loaderUI = new Loader();
    const mapLoadPercentages = [0.9, 0.1]; // GLB is 70%, Octree is 30%
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

    // 1) Load the GLB into the scene, wiring up a progress callback
    let gltfGroup = null; // Declare gltfGroup here
    let onGLBProgress = () => {};
    const mapLoadPromise = new Promise((resolve, reject) => {
        new GLTFLoader().load(
            GLB_MODEL_URL,
            gltf => {
                gltfGroup = gltf.scene; // Assign to gltfGroup
                gltfGroup.scale.set(SCALE, SCALE, SCALE);
                gltfGroup.updateMatrixWorld(true); // Crucial for correct vertex transformation
                scene.add(gltfGroup);

                // enable shadows and anisotropy on all meshes
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
                resolve(gltfGroup); // Resolve with the group so octree can use it
            },
            // progress callback
            evt => {
                if (evt.lengthComputable) onGLBProgress(evt);
            },
            err => {
                console.error('❌ Error loading SigmaCity GLB:', err);
                reject(err);
            }
        );
    });

    // track GLB load at 70%, with live percent updates
    loaderUI.track(mapLoadPercentages[0], mapLoadPromise, cb => {
        onGLBProgress = cb;
    });

    // 2) Once GLB is added, build the octree
    let onOctreeProgress = () => {};
    const octreePromise = mapLoadPromise.then(group => {
        return physicsController.buildOctree(group, (evt) => {
            onOctreeProgress(evt);
        });
    });

    // track octree build at 30%, with live percent updates
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
