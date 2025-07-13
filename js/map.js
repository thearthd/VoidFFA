// js/map.js (Updated with Geometry Conversion)

import { Loader } from './Loader.js';
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
    computeBoundsTree,
    disposeBoundsTree,
    acceleratedRaycast,
    MeshBVH, // Although imported, MeshBVH is primarily used internally by the extensions
} from 'https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.9.1/+esm';

// ─── BVH Setup: Extend BufferGeometry and Mesh prototypes ───────────────────
// These lines integrate three-mesh-bvh functionality directly into Three.js objects.
// computeBoundsTree and disposeBoundsTree are added to BufferGeometry.prototype
// so any BufferGeometry can build and dispose of its BVH.
// acceleratedRaycast is added to Mesh.prototype, allowing meshes to use the BVH for faster raycasting.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;


// ─── Helper: build sequential indices if none present ────────────────────────
/**
 * Generates a sequential index array for a given vertex count.
 * This is used for BufferGeometries that might not have an index buffer,
 * which is required by MeshBVH.
 * @param {number} vertexCount - The number of vertices in the geometry.
 * @returns {number[]} An array of sequential indices.
 */
function generateSequentialIndices(vertexCount) {
    const idx = [];
    for (let i = 0; i < vertexCount; i++) idx.push(i);
    return idx;
}

// ─── Lantern class ─────────────────────────────────────────────────────────
export class Lantern {
    /**
     * Creates a 3D lantern model with an associated spot light.
     * The model is loaded from an OBJ file and scaled.
     * Its geometry is ensured to be BufferGeometry with an index for BVH compatibility.
     * @param {THREE.Object3D} parent - The parent object to add the lantern to.
     * @param {THREE.Vector3} position - The position of the lantern.
     * @param {number} [scale=1] - The uniform scale factor for the lantern model.
     * @param {object} [lightOptions={}] - Options for the spot light.
     * @param {number} [lightOptions.color=0xffffff] - Color of the spot light.
     * @param {number} [lightOptions.intensity=1] - Intensity of the spot light.
     * @param {number} [lightOptions.distance=10] - Maximum range of the spot light.
     * @param {number} [lightOptions.angle=Math.PI / 8] - Angle of the spot light cone.
     * @param {number} [lightOptions.penumbra=0.5] - Percentage of the spotlight cone that is attenuated.
     * @param {number} [lightOptions.decay=2] - The amount the light dims along the distance of the light.
     */
    constructor(parent, position, scale = 1, lightOptions = {}) {
        // Create a container for the lantern model and light
        this.container = new THREE.Object3D();
        this.container.position.copy(position);
        parent.add(this.container);

        // URL for the lantern OBJ model
        const url = 'https://raw.githubusercontent.com/thearthd/3d-models/refs/heads/main/uploads_files_2887463_Lantern.obj';
        const loader = new OBJLoader();

        loader.load(
            url,
            lanternGroup => {
                // Scale the loaded group
                lanternGroup.scale.set(scale, scale, scale);
                // Update world matrix to ensure correct bounding box calculation and transformations
                lanternGroup.updateMatrixWorld(true);

                // Center the lantern vertically
                const box = new THREE.Box3().setFromObject(lanternGroup);
                lanternGroup.position.y = -box.min.y;

                // Traverse all children to configure meshes
                lanternGroup.traverse(child => {
                    if (!child.isMesh) return; // Only process meshes

                    // Ensure BufferGeometry. OBJLoader from jsm/loaders should return BufferGeometry.
                    // However, if an old THREE.Geometry is encountered, convert it.
                    if (child.geometry && !(child.geometry instanceof THREE.BufferGeometry)) {
                        console.warn('Converting non-BufferGeometry to BufferGeometry for BVH:', child.name);
                        // Correctly call the static method fromGeometry
                        child.geometry = THREE.BufferGeometry.fromGeometry(child.geometry);
                    }

                    // Ensure geometry has an index for BVH, if not, create sequential indices
                    if (child.geometry && !child.geometry.index) {
                        child.geometry.setIndex(generateSequentialIndices(child.geometry.attributes.position.count));
                    }

                    // Apply standard material and shadow properties
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0xffffff,
                        roughness: 0.8,
                        metalness: 0.7,
                        side: THREE.DoubleSide
                    });
                    child.castShadow = child.receiveShadow = true;
                });

                this.container.add(lanternGroup);

                // Configure and add the spot light
                const {
                    color = 0xffffff,
                    intensity = 1,
                    distance = 10,
                    angle = Math.PI / 8,
                    penumbra = 0.5,
                    decay = 2
                } = lightOptions;

                const spot = new THREE.SpotLight(color, intensity, distance, angle, penumbra, decay);
                // Position the spot light relative to the lantern
                spot.position.set(0, (box.max.y - box.min.y) * 0.75, 0);
                // Set the target for the spot light (where it points)
                spot.target.position.set(0, -20, 0);
                spot.castShadow = true;
                spot.shadow.mapSize.set(512, 512); // Shadow map resolution
                spot.shadow.camera.near = 0.5;
                spot.shadow.camera.far = distance;
                this.container.add(spot, spot.target); // Add both light and its target to the container
            },
            null, // onProgress callback (not used here, but can be added)
            err => console.error('Error loading lantern model:', err)
        );
    }
}

/**
 * Loads the "CrocodilosConstruction" GLB map, configures lighting, and builds a BVH for physics.
 * @param {THREE.Scene} scene - The Three.js scene to add the map to.
 * @param {object} physicsController - An object with a `buildBVH` method for physics processing.
 * @returns {Promise<THREE.Vector3[]>} A promise that resolves with an array of spawn points.
 */
export async function createCrocodilosConstruction(scene, physicsController) {
    // Global flags for tracking map loading status
    window.envMeshes = []; // Stores all environment meshes for potential later use (e.g., raycasting)
    window.mapReady = false; // Flag indicating if the map and BVH are fully loaded

    // Initialize loader UI with progress milestones
    // 90% for GLB model loading, 10% for BVH building
    const loaderUI = new Loader();
    const mapLoadPercentages = [0.9, 0.1];
    loaderUI.show('Loading CrocodilosConstruction Map & Building BVH...', mapLoadPercentages);

    // Define scaling and initial raw spawn points for players
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
    // Scale spawn points according to the map's scale
    const spawnPoints = rawSpawnPoints.map(p => p.clone().multiplyScalar(SCALE / 5));


    // Set up directional sunlight for the scene, enabling shadows
    const sunLight = new THREE.DirectionalLight(0xffffff, 1);
    sunLight.position.set(50, 100, 50); // Position of the sun
    sunLight.target.position.set(0, 0, 0); // Where the sun points
    sunLight.castShadow = true; // Enable shadow casting
    sunLight.shadow.mapSize.set(2048, 2048); // Shadow map resolution
    const d = 100; // Frustum size for the shadow camera
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.camera.near = 0.1; // Near plane of shadow camera
    sunLight.shadow.camera.far = 200; // Far plane of shadow camera
    scene.add(sunLight, sunLight.target); // Add light and its target to the scene

    // URL of the GLB model for the map
    const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/croccodilosconstruction.glb';

    // 1) Load the GLB model into the scene
    let gltfGroup = null; // Variable to hold the loaded GLTF scene
    let onGLBProgress = () => {}; // Callback for GLB loading progress

    const mapLoadPromise = new Promise((resolve, reject) => {
        new GLTFLoader().load(
            GLB_MODEL_URL,
            gltf => {
                gltfGroup = gltf.scene; // Get the scene from the GLTF
                gltfGroup.scale.set(SCALE, SCALE, SCALE); // Apply overall scale
                gltfGroup.updateMatrixWorld(true); // Crucial for correct vertex transformation and bounding box calculation
                scene.add(gltfGroup); // Add the loaded model to the scene

                // Traverse all children of the loaded model
                gltfGroup.traverse(child => {
                    if (child.isMesh) {
                        // Ensure BufferGeometry. GLTFLoader typically provides BufferGeometry.
                        // However, if an old THREE.Geometry is encountered, convert it.
                        if (child.geometry && !(child.geometry instanceof THREE.BufferGeometry)) {
                            console.warn('Converting non-BufferGeometry to BufferGeometry for BVH:', child.name);
                            // Correctly call the static method fromGeometry
                            child.geometry = THREE.BufferGeometry.fromGeometry(child.geometry);
                        }

                        child.castShadow = true; // Enable shadow casting for the mesh
                        child.receiveShadow = true; // Enable shadow receiving for the mesh
                        // Set anisotropy for better texture filtering at oblique angles
                        if (child.material.map) {
                            child.material.map.anisotropy = 4;
                        }
                        window.envMeshes.push(child); // Add mesh to global environment meshes list

                        // Ensure geometry has an index for BVH. If not, create sequential indices.
                        if (!child.geometry.index) {
                            child.geometry.setIndex(generateSequentialIndices(child.geometry.attributes.position.count));
                        }
                    }
                });

                console.log('✔️ GLB mesh loaded into scene.');
                resolve(gltfGroup); // Resolve the promise with the loaded group
            },
            // Progress callback for GLB loading
            evt => {
                if (evt.lengthComputable) onGLBProgress(evt);
            },
            // Error callback for GLB loading
            err => {
                console.error('❌ Error loading CrocodilosConstruction GLB:', err);
                reject(err);
            }
        );
    });

    // Track GLB load progress using the loader UI
    loaderUI.track(mapLoadPercentages[0], mapLoadPromise, cb => {
        onGLBProgress = cb; // Assign the UI's progress callback to our GLB loader
    });

    // 2) Once GLB is added, build the BVH (Bounding Volume Hierarchy) for collision detection
    let onBVHProgress = () => {}; // Callback for BVH building progress
    const bvhPromise = mapLoadPromise.then(group => {
        // physicsController.buildBVH is expected to return a promise and take a progress callback
        return physicsController.buildBVH(group, (evt) => {
            onBVHProgress(evt); // Update BVH progress in the UI
        });
    });

    // Track BVH build progress using the loader UI
    loaderUI.track(mapLoadPercentages[1], bvhPromise, cb => {
        onBVHProgress = cb; // Assign the UI's progress callback to our BVH builder
    });

    // Wait for both GLB loading and BVH building to complete
    await Promise.all([mapLoadPromise, bvhPromise]);

    // When all loading steps are fully done
    loaderUI.onComplete(() => {
        window.mapReady = true; // Set global flag to true
        console.log('🗺️ Map + BVH fully ready!');
    });

    return spawnPoints; // Return the calculated spawn points
}

/**
 * Loads the "SigmaCity" GLB map, configures lighting, and builds a BVH for physics.
 * This function is very similar in structure to `createCrocodilosConstruction`.
 * @param {THREE.Scene} scene - The Three.js scene to add the map to.
 * @param {object} physicsController - An object with a `buildBVH` method for physics processing.
 * @returns {Promise<THREE.Vector3[]>} A promise that resolves with an array of spawn points.
 */
export async function createSigmaCity(scene, physicsController) {
    // Global flags for tracking map loading status
    window.envMeshes = [];
    window.mapReady = false;

    // Initialize loader UI with progress milestones
    const loaderUI = new Loader();
    const mapLoadPercentages = [0.9, 0.1];
    loaderUI.show('Loading SigmaCity Map & Building BVH...', mapLoadPercentages);

    // Define scaling and initial raw spawn points
    const SCALE = 2;
    const rawSpawnPoints = [
        new THREE.Vector3(0, 15, 0), // 1
    ];
    const spawnPoints = rawSpawnPoints.map(p => p.clone().multiplyScalar(SCALE / 2));


    // Set up directional sunlight for the scene, enabling shadows
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

    // URL of the GLB model for the map
    const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/sigmaCITYPLEASE.glb';

    // 1) Load the GLB model into the scene
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

                // Traverse all children of the loaded model
                gltfGroup.traverse(child => {
                    if (child.isMesh) {
                        // Ensure BufferGeometry. GLTFLoader typically provides BufferGeometry.
                        // However, if an old THREE.Geometry is encountered, convert it.
                        if (child.geometry && !(child.geometry instanceof THREE.BufferGeometry)) {
                            console.warn('Converting non-BufferGeometry to BufferGeometry for BVH:', child.name);
                            // Correctly call the static method fromGeometry
                            child.geometry = THREE.BufferGeometry.fromGeometry(child.geometry);
                        }
                        child.castShadow = true;
                        child.receiveShadow = true;
                        if (child.material.map) {
                            child.material.map.anisotropy = 4;
                        }
                        window.envMeshes.push(child);

                        // Ensure geometry has an index for BVH. If not, create sequential indices.
                        if (!child.geometry.index) {
                            child.geometry.setIndex(generateSequentialIndices(child.geometry.attributes.position.count));
                        }
                    }
                });

                console.log('✔️ GLB mesh loaded into scene.');
                resolve(gltfGroup);
            },
            // Progress callback for GLB loading
            evt => {
                if (evt.lengthComputable) onGLBProgress(evt);
            },
            // Error callback for GLB loading
            err => {
                console.error('❌ Error loading SigmaCity GLB:', err);
                reject(err);
            }
        );
    });

    // Track GLB load progress
    loaderUI.track(mapLoadPercentages[0], mapLoadPromise, cb => {
        onGLBProgress = cb;
    });

    // 2) Once GLB is added, build the BVH
    let onBVHProgress = () => {};
    const bvhPromise = mapLoadPromise.then(group => {
        return physicsController.buildBVH(group, (evt) => {
            onBVHProgress(evt);
        });
    });

    // Track BVH build progress
    loaderUI.track(mapLoadPercentages[1], bvhPromise, cb => {
        onBVHProgress = cb;
    });

    // Wait for both loading steps
    await Promise.all([mapLoadPromise, bvhPromise]);

    // When fully done
    loaderUI.onComplete(() => {
        window.mapReady = true;
        console.log('🗺️ Map + BVH fully ready!');
    });

    return spawnPoints;
}
