// js/map.js (Updated for downloading OctreeV2 JSON data)

import { Loader } from './Loader.js';
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// We are no longer using three-mesh-bvh for octree functionalities,
// so remove these specific imports if they're not used elsewhere.
// If you're using three-mesh-bvh for raycasting on meshes *separate* from your OctreeV2, keep them.
// Given your physics.js only uses OctreeV2 for collision, it's safer to remove these
// to avoid confusion or unused imports.
/*
import {
    computeBoundsTree,
    disposeBoundsTree,
    acceleratedRaycast
} from 'https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.9.1/+esm';

// ─── BVH Setup ────────────────────────────────────────────────────────────
// If you remove the above imports, you should also remove these lines
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
*/

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

    // Initialize loader UI with two milestones: 90% for GLB, 10% for octree
    const loaderUI = new Loader();
    const mapLoadPercentages = [0.9, 0.1]; // GLB is 90%, Octree is 10%
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
    const OCTREE_FILE_URL = 'path/to/your/uploaded/crocodilos_construction_octree.json'; // <--- IMPORTANT: Update this path after uploading!

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

                // enable shadows and anisotropy on all meshes, and ensure indices for BVH
                gltfGroup.traverse(child => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        if (child.material.map) {
                            child.material.map.anisotropy = 4;
                        }
                        // Ensure geometry has indices for BVH (if still using for other raycasting/BVH needs)
                        if (!child.geometry.index) {
                            child.geometry.setIndex(generateSequentialIndices(child.geometry.attributes.position.count));
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

    // track GLB load at 90%, with live percent updates
    loaderUI.track(mapLoadPercentages[0], mapLoadPromise, cb => {
        onGLBProgress = cb;
    });

    // 2) Once GLB is added, build or load the octree
    let onOctreeProgress = () => {};
    let octreePromise;

    // --- REVISED: Try to load from file first, then fallback to build ---
    if (OCTREE_FILE_URL && OCTREE_FILE_URL !== 'path/to/your/uploaded/crocodilos_construction_octree.json') {
        console.log(`Attempting to load octree for CrocodilosConstruction from ${OCTREE_FILE_URL}...`);
        octreePromise = fetch(OCTREE_FILE_URL)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json(); // Expecting JSON data
            })
            .then(octreeJsonData => {
                return physicsController.loadOctree(octreeJsonData, (evt) => {
                    onOctreeProgress(evt);
                });
            })
            .then(success => {
                if (success) {
                    console.log('✔️ Octree loaded successfully from file for CrocodilosConstruction.');
                    return physicsController.worldOctree; // Assuming worldOctree is set in physicsController
                } else {
                    console.warn('Failed to load octree from file. Rebuilding for CrocodilosConstruction...');
                    return mapLoadPromise.then(group => {
                        return physicsController.buildOctree(group, (evt) => {
                            onOctreeProgress(evt);
                        });
                    });
                }
            })
            .catch(error => {
                console.error('❌ Error fetching or loading octree file for CrocodilosConstruction:', error);
                console.warn('Rebuilding octree due to file load error for CrocodilosConstruction...');
                return mapLoadPromise.then(group => {
                    return physicsController.buildOctree(group, (evt) => {
                        onOctreeProgress(evt);
                    });
                });
            });
    } else {
        console.log('No specific octree file URL provided or URL is placeholder. Building new octree...');
        octreePromise = mapLoadPromise.then(group => {
            return physicsController.buildOctree(group, (evt) => {
                onOctreeProgress(evt);
            });
        });
    }


    // track octree build/load at 10%, with live percent updates
    loaderUI.track(mapLoadPercentages[1], octreePromise, cb => {
        onOctreeProgress = cb;
    });

    // wait for both loading steps
    await Promise.all([mapLoadPromise, octreePromise]);

    // --- REVISED: Trigger a download of the built octree if it was just built ---
    // This part should only run if you want to generate a new file,
    // not if you're consistently loading from a hosted URL.
    // For development, uncomment to generate the file once.
    // For deployment, comment this out after you have your hosted .json file.
    //
    // if (!OCTREE_FILE_URL || OCTREE_FILE_URL === 'path/to/your/uploaded/crocodilos_construction_octree.json') {
    //     const octreeData = physicsController.saveOctree(); // This now returns a JS object
    //     if (octreeData) {
    //         const jsonString = JSON.stringify(octreeData);
    //         const blob = new Blob([jsonString], { type: 'application/json' });
    //         const url = URL.createObjectURL(blob);
    //         const a = document.createElement('a');
    //         a.href = url;
    //         a.download = 'crocodilos_construction_octree.json'; // Suggest a JSON filename
    //         document.body.appendChild(a);
    //         a.click();
    //         document.body.removeChild(a);
    //         URL.revokeObjectURL(url);
    //         console.log('✔️ Octree (JSON) downloaded as crocodilos_construction_octree.json');
    //         console.warn('Upload this file to your preferred hosting/storage solution and update OCTREE_FILE_URL!');
    //     }
    // }


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

    // initialize loader UI with two milestones: 90% for GLB, 10% for octree
    const loaderUI = new Loader();
    const mapLoadPercentages = [0.9, 0.1]; // GLB is 90%, Octree is 10%
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
    const OCTREE_FILE_URL = 'path/to/your/uploaded/sigma_city_octree.json'; // <--- IMPORTANT: Update this path after uploading!

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

                // enable shadows and anisotropy on all meshes, and ensure indices for BVH
                gltfGroup.traverse(child => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        if (child.material.map) {
                            child.material.map.anisotropy = 4;
                        }
                        // Ensure geometry has indices for BVH
                        if (child.geometry && !child.geometry.index) {
                            child.geometry.setIndex(generateSequentialIndices(child.geometry.attributes.position.count));
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
                console.error('❌ Error loading SigmaCity GLB:', err);
                reject(err);
            }
        );
    });

    // track GLB load at 90%, with live percent updates
    loaderUI.track(mapLoadPercentages[0], mapLoadPromise, cb => {
        onGLBProgress = cb;
    });

    // 2) Once GLB is added, build or load the octree
    let onOctreeProgress = () => {};
    let octreePromise;

    // --- REVISED: Try to load from file first, then fallback to build ---
    if (OCTREE_FILE_URL && OCTREE_FILE_URL !== 'path/to/your/uploaded/sigma_city_octree.json') {
        console.log(`Attempting to load octree for SigmaCity from ${OCTREE_FILE_URL}...`);
        octreePromise = fetch(OCTREE_FILE_URL)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json(); // Expecting JSON data
            })
            .then(octreeJsonData => {
                return physicsController.loadOctree(octreeJsonData, (evt) => {
                    onOctreeProgress(evt);
                });
            })
            .then(success => {
                if (success) {
                    console.log('✔️ Octree loaded successfully from file for SigmaCity.');
                    return physicsController.worldOctree; // Assuming worldOctree is set in physicsController
                } else {
                    console.warn('Failed to load octree from file. Rebuilding for SigmaCity...');
                    return mapLoadPromise.then(group => {
                        return physicsController.buildOctree(group, (evt) => {
                            onOctreeProgress(evt);
                        });
                    });
                }
            })
            .catch(error => {
                console.error('❌ Error fetching or loading octree file for SigmaCity:', error);
                console.warn('Rebuilding octree due to file load error for SigmaCity...');
                return mapLoadPromise.then(group => {
                    return physicsController.buildOctree(group, (evt) => {
                        onOctreeProgress(evt);
                    });
                });
            });
    } else {
        console.log('No specific octree file URL provided or URL is placeholder. Building new octree...');
        octreePromise = mapLoadPromise.then(group => {
            return physicsController.buildOctree(group, (evt) => {
                onOctreeProgress(evt);
            });
        });
    }

    // track octree build/load at 10%, with live percent updates
    loaderUI.track(mapLoadPercentages[1], octreePromise, cb => {
        onOctreeProgress = cb;
    });

    // wait for both loading steps
    await Promise.all([mapLoadPromise, octreePromise]);

    // --- REVISED: Trigger a download of the built octree if it was just built ---
    // For development, uncomment to generate the file once.
    // For deployment, comment this out after you have your hosted .json file.
    //
   //  if (!OCTREE_FILE_URL || OCTREE_FILE_URL === 'path/to/your/uploaded/sigma_city_octree.json') {
         const octreeData = physicsController.saveOctree(); // This now returns a JS object
         if (octreeData) {
             const jsonString = JSON.stringify(octreeData);
             const blob = new Blob([jsonString], { type: 'application/json' });
             const url = URL.createObjectURL(blob);
             const a = document.createElement('a');
             a.href = url;
             a.download = 'sigma_city_octree.json'; // Suggest a JSON filename
             document.body.appendChild(a);
             a.click();
             document.body.removeChild(a);
             URL.revokeObjectURL(url);
             console.log('✔️ Octree (JSON) downloaded as sigma_city_octree.json');
             console.warn('Upload this file to your preferred hosting/storage solution and update OCTREE_FILE_URL!');
         }
  //   }

    // when fully done
    loaderUI.onComplete(() => {
        window.mapReady = true;
        console.log('🗺️ Map + Octree fully ready!');
    });

    return spawnPoints;
}
