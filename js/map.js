// js/map.js

import { Loader } from './Loader.js'; // Keep this import
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OctreeV2 } from './OctreeV2.js'; // Import the new OctreeV2
// LZString is loaded globally via a script tag in index.html, no import needed here.

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
    window.envMeshes = [];
    window.mapReady = false;

    // Initialize loader UI with two milestones: 70% for GLB, 30% for octree
    const loaderUI = new Loader(); // Re-added
    const mapLoadPercentages = [0.7, 0.3]; // Adjusted percentages for GLB and Octree
    loaderUI.show('Loading CrocodilosConstruction Map & Building Octree...', mapLoadPercentages); // Re-added

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

    const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/croccodilosconstruction.glb';
    const OCTREE_MAP_URL = 'https://raw.githubusercontent.com/thearthd/VoidFFA/refs/heads/main/octreeMaps/crocodilosConstructionOctree.json';

    let gltfGroup = null;
    let allModelTriangles = []; // This will hold the flat array of triangles from the GLB

    // 1) Load the GLB model first
    let onGLBProgress = () => {}; // Will be set by loaderUI.track
    const glbLoadPromise = new Promise((resolve, reject) => {
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
                        // Ensure geometry has index for Octree processing
                        if (!child.geometry.index) {
                            child.geometry.setIndex(generateSequentialIndices(child.geometry.attributes.position.count));
                        }
                    }
                });

                // Extract all triangles from the GLTF scene into a flat array
                gltfGroup.traverse((obj) => {
                    if (obj.isMesh === true) {
                        let geometry;
                        // Use the already non-indexed geometry if it was converted, or convert now
                        if (obj.geometry.index !== null) {
                            geometry = obj.geometry.toNonIndexed();
                        } else {
                            geometry = obj.geometry;
                        }

                        const positionAttribute = geometry.getAttribute('position');
                        if (positionAttribute) {
                            for (let i = 0; i < positionAttribute.count; i += 3) {
                                const v1 = new THREE.Vector3().fromBufferAttribute(positionAttribute, i);
                                const v2 = new THREE.Vector3().fromBufferAttribute(positionAttribute, i + 1);
                                const v3 = new THREE.Vector3().fromBufferAttribute(positionAttribute, i + 2);

                                v1.applyMatrix4(obj.matrixWorld);
                                v2.applyMatrix4(obj.matrixWorld);
                                v3.applyMatrix4(obj.matrixWorld);

                                allModelTriangles.push(new THREE.Triangle(v1, v2, v3));
                            }
                        }
                        // Dispose of temporary non-indexed geometry if created
                        if (obj.geometry.index !== null) {
                            geometry.dispose();
                        }
                    }
                });

                console.log('✔️ GLB mesh loaded and triangles extracted.');
                resolve(gltfGroup);
            },
            // progress callback for GLTFLoader, now hooked up to onGLBProgress
            evt => {
                if (evt.lengthComputable) onGLBProgress(evt);
            },
            err => { console.error('❌ Error loading CrocodilosConstruction GLB:', err); reject(err); }
        );
    });

    // track GLB load at 70%, with live percent updates
    loaderUI.track(mapLoadPercentages[0], glbLoadPromise, cb => { // Re-added
        onGLBProgress = cb;
    });

    // 2) Once GLB is loaded, attempt to load or build the Octree
    let onOctreeProgress = () => {}; // Will be set by loaderUI.track
    const octreeLoadPromise = glbLoadPromise.then(async () => {
        let loadedOctree = null;
        let octreeBuildSuccess = false;

        // Try to load pre-built Octree
        try {
            console.log(`Attempting to load Octree from: ${OCTREE_MAP_URL}`);
            // Removed: loaderUI.updateMessage('Loading Octree from file...');
            
            const response = await fetch(OCTREE_MAP_URL);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const compressedData = await response.text();

            if (typeof LZString === 'undefined') {
                throw new Error("LZString library not found. Cannot decompress Octree data.");
            }
            const decompressedString = LZString.decompressFromBase64(compressedData);
            if (!decompressedString) {
                throw new Error("Failed to decompress Octree data. File might be corrupted or not compressed with LZ-String.");
            }
            const serializedOctree = JSON.parse(decompressedString);
            
            loadedOctree = OctreeV2.deserialize(serializedOctree, allModelTriangles);
            physicsController.setOctreeAndTriangles(loadedOctree, allModelTriangles);
            console.log('✔️ Octree loaded from file successfully!');
            octreeBuildSuccess = true;
            onOctreeProgress({ loaded: 1, total: 1 }); // Mark 100% for this phase
        } catch (error) {
            console.warn(`❌ Failed to load Octree from file: ${error.message}. Building from scratch.`);
            // Removed: loaderUI.updateMessage('Building Octree from scratch...');
            // Fallback to building from scratch
            const tempOctree = new OctreeV2();
            // Manually set total triangle count for progress tracking in buildOctree
            tempOctree._totalTriangleCount = allModelTriangles.length;
            await tempOctree.fromGraphNode(gltfGroup, (evt) => {
                const overallProgress = evt.loaded; // fromGraphNode already handles its own internal progress
                onOctreeProgress({ loaded: overallProgress, total: 1 }); // Pass progress to loaderUI
            });
            physicsController.setOctreeAndTriangles(tempOctree, allModelTriangles);
            octreeBuildSuccess = true;
            console.log('✔️ Octree built from scratch successfully!');
        }

        if (!octreeBuildSuccess) {
            throw new Error("Octree could not be loaded or built.");
        }
    });

    // track octree build at 30%, with live percent updates
    loaderUI.track(mapLoadPercentages[1], octreeLoadPromise, cb => { // Re-added
        onOctreeProgress = cb;
    });

    await Promise.all([glbLoadPromise, octreeLoadPromise]);

    // when fully done
    loaderUI.onComplete(() => { // Re-added
        window.mapReady = true;
        console.log('🗺️ CrocodilosConstruction Map + Octree fully ready!');
    });

    return spawnPoints;
}


export async function createSigmaCity(scene, physicsController) {
    window.envMeshes = [];
    window.mapReady = false;

    // Initialize loader UI with two milestones: 70% for GLB, 30% for octree
    const loaderUI = new Loader(); // Re-added
    const mapLoadPercentages = [0.7, 0.3]; // Adjusted percentages for GLB and Octree
    loaderUI.show('Loading SigmaCity Map & Building Octree...', mapLoadPercentages); // Re-added

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

    const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/sigmaCITYPLEASE.glb';
    const OCTREE_MAP_URL = 'https://raw.githubusercontent.com/thearthd/VoidFFA/refs/heads/main/octreeMaps/sigmaCityOctree.json';

    let gltfGroup = null;
    let allModelTriangles = []; // This will hold the flat array of triangles from the GLB

    // 1) Load the GLB model first
    let onGLBProgress = () => {}; // Will be set by loaderUI.track
    const glbLoadPromise = new Promise((resolve, reject) => {
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
                        // Ensure geometry has index for Octree processing
                        if (!child.geometry.index) {
                            child.geometry.setIndex(generateSequentialIndices(child.geometry.attributes.position.count));
                        }
                    }
                });

                // Extract all triangles from the GLTF scene into a flat array
                gltfGroup.traverse((obj) => {
                    if (obj.isMesh === true) {
                        let geometry;
                        // Use the already non-indexed geometry if it was converted, or convert now
                        if (obj.geometry.index !== null) {
                            geometry = obj.geometry.toNonIndexed();
                        } else {
                            geometry = obj.geometry;
                        }

                        const positionAttribute = geometry.getAttribute('position');
                        if (positionAttribute) {
                            for (let i = 0; i < positionAttribute.count; i += 3) {
                                const v1 = new THREE.Vector3().fromBufferAttribute(positionAttribute, i);
                                const v2 = new THREE.Vector3().fromBufferAttribute(positionAttribute, i + 1);
                                const v3 = new THREE.Vector3().fromBufferAttribute(positionAttribute, i + 2);

                                v1.applyMatrix4(obj.matrixWorld);
                                v2.applyMatrix4(obj.matrixWorld);
                                v3.applyMatrix4(obj.matrixWorld);

                                allModelTriangles.push(new THREE.Triangle(v1, v2, v3));
                            }
                        }
                        // Dispose of temporary non-indexed geometry if created
                        if (obj.geometry.index !== null) {
                            geometry.dispose();
                        }
                    }
                });

                console.log('✔️ GLB mesh loaded and triangles extracted.');
                resolve(gltfGroup);
            },
            // progress callback for GLTFLoader, now hooked up to onGLBProgress
            evt => {
                if (evt.lengthComputable) onGLBProgress(evt);
            },
            err => { console.error('❌ Error loading SigmaCity GLB:', err); reject(err); }
        );
    });

    // track GLB load at 70%, with live percent updates
    loaderUI.track(mapLoadPercentages[0], glbLoadPromise, cb => { // Re-added
        onGLBProgress = cb;
    });

    // 2) Once GLB is loaded, attempt to load or build the Octree
    let onOctreeProgress = () => {}; // Will be set by loaderUI.track
    const octreeLoadPromise = glbLoadPromise.then(async () => {
        let loadedOctree = null;
        let octreeBuildSuccess = false;

        // Try to load pre-built Octree
        try {
            console.log(`Attempting to load Octree from: ${OCTREE_MAP_URL}`);
            // Removed: loaderUI.updateMessage('Loading Octree from file...');
            
            const response = await fetch(OCTREE_MAP_URL);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const compressedData = await response.text();

            if (typeof LZString === 'undefined') {
                throw new Error("LZString library not found. Cannot decompress Octree data.");
            }
            const decompressedString = LZString.decompressFromBase64(compressedData);
            if (!decompressedString) {
                throw new Error("Failed to decompress Octree data. File might be corrupted or not compressed with LZ-String.");
            }
            const serializedOctree = JSON.parse(decompressedString);
            
            loadedOctree = OctreeV2.deserialize(serializedOctree, allModelTriangles);
            physicsController.setOctreeAndTriangles(loadedOctree, allModelTriangles);
            console.log('✔️ Octree loaded from file successfully!');
            octreeBuildSuccess = true;
            onOctreeProgress({ loaded: 1, total: 1 }); // Mark 100% for this phase
        } catch (error) {
            console.warn(`❌ Failed to load Octree from file: ${error.message}. Building from scratch.`);
            // Removed: loaderUI.updateMessage('Building Octree from scratch...');
            // Fallback to building from scratch
            const tempOctree = new OctreeV2();
            // Manually set total triangle count for progress tracking in buildOctree
            tempOctree._totalTriangleCount = allModelTriangles.length;
            await tempOctree.fromGraphNode(gltfGroup, (evt) => {
                const overallProgress = evt.loaded; // fromGraphNode already handles its own internal progress
                onOctreeProgress({ loaded: overallProgress, total: 1 }); // Pass progress to loaderUI
            });
            physicsController.setOctreeAndTriangles(tempOctree, allModelTriangles);
            octreeBuildSuccess = true;
            console.log('✔️ Octree built from scratch successfully!');
        }

        if (!octreeBuildSuccess) {
            throw new Error("Octree could not be loaded or built.");
        }
    });

    // track octree build at 30%, with live percent updates
    loaderUI.track(mapLoadPercentages[1], octreeLoadPromise, cb => { // Re-added
        onOctreeProgress = cb;
    });

    await Promise.all([glbLoadPromise, octreeLoadPromise]);

    // when fully done
    loaderUI.onComplete(() => { // Re-added
        window.mapReady = true;
        console.log('🗺️ SigmaCity Map + Octree fully ready!');
    });

    return spawnPoints;
}
