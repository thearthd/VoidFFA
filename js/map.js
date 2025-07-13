// js/map.js (Now with strict BufferGeometry guard for BVH)

import { Loader } from './Loader.js';
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
    computeBoundsTree,
    disposeBoundsTree,
    acceleratedRaycast
} from 'https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.9.1/+esm';

// ─── BVH Setup ───────────────────────────────────────────────────────────────
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// ─── Helpers ────────────────────────────────────────────────────────────────
function generateSequentialIndices(vertexCount) {
    const idx = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) idx[i] = i;
    return idx;
}

function legacyToBufferGeometry(geom) {
    // If it’s already a BufferGeometry, just return it
    if (geom.isBufferGeometry) return geom;

    // Otherwise assume old THREE.Geometry
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

// ─── Lantern Class ──────────────────────────────────────────────────────────
export class Lantern {
    constructor(parent, position, scale = 1, lightOptions = {}) {
        this.container = new THREE.Object3D();
        this.container.position.copy(position);
        parent.add(this.container);

        const loader = new OBJLoader();
        loader.load(
            'https://raw.githubusercontent.com/thearthd/3d-models/refs/heads/main/uploads_files_2887463_Lantern.obj',
            group => {
                group.scale.set(scale, scale, scale);
                group.updateMatrixWorld(true);

                // center vertically
                const box = new THREE.Box3().setFromObject(group);
                group.position.y = -box.min.y;

                group.traverse(child => {
                    if (!child.isMesh) return;

                    let geom = child.geometry;
                    // convert legacy → buffer if needed
                    if (!geom || !geom.isBufferGeometry) {
                        geom = legacyToBufferGeometry(geom);
                        child.geometry = geom;
                    }
                    // ensure indexed
                    if (!geom.index) {
                        geom.setIndex(new THREE.BufferAttribute(generateSequentialIndices(geom.attributes.position.count), 1));
                    }
                    // strict guard
                    if (!geom.isBufferGeometry) {
                        console.warn(`Skipping ${child.name}—not a BufferGeometry.`);
                        return;
                    }
                    // build BVH
                    geom.computeBoundsTree();

                    // material & shadows
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0xffffff,
                        roughness: 0.8,
                        metalness: 0.7,
                        side: THREE.DoubleSide
                    });
                    child.castShadow = child.receiveShadow = true;
                });

                this.container.add(group);

                const { color=0xffffff, intensity=1, distance=10, angle=Math.PI/8, penumbra=0.5, decay=2 } = lightOptions;
                const spot = new THREE.SpotLight(color, intensity, distance, angle, penumbra, decay);
                spot.position.set(0, (box.max.y - box.min.y) * 0.75, 0);
                spot.target.position.set(0, -20, 0);
                spot.castShadow = true;
                spot.shadow.mapSize.set(512,512);
                spot.shadow.camera.near = 0.5;
                spot.shadow.camera.far = distance;
                this.container.add(spot, spot.target);
            },
            null,
            err => console.error('Error loading Lantern OBJ:', err)
        );
    }
}

// ─── createCrocodilosConstruction ───────────────────────────────────────────
export async function createCrocodilosConstruction(scene, physicsController) {
    window.envMeshes = [];
    window.mapReady = false;

    const loaderUI = new Loader();
    loaderUI.show('Loading CrocodilosConstruction Map & Building BVH...', [0.9, 0.1]);

    // sunlight
    const sun = new THREE.DirectionalLight(0xffffff,1);
    sun.position.set(50,100,50);
    sun.target.position.set(0,0,0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048,2048);
    const d = 100;
    Object.assign(sun.shadow.camera, { left:-d, right:d, top:d, bottom:-d, near:0.1, far:200 });
    scene.add(sun, sun.target);

    const SCALE = 5;
    const rawSpawns = [
        new THREE.Vector3(-14,7,-36),
        new THREE.Vector3(-2,2,37),
        new THREE.Vector3(0,2,0),
        new THREE.Vector3(2,7,34),
        new THREE.Vector3(-5,2,-38),
        new THREE.Vector3(-18,2,12),
        new THREE.Vector3(11,2,23),
        new THREE.Vector3(-7,7,-1),
    ];
    const spawns = rawSpawns.map(p => p.clone().multiplyScalar(SCALE/5));

    // 1) load GLB
    let onGLB = () => {};
    const glbPromise = new Promise((res, rej) => {
        new GLTFLoader().load(
            'https://raw.githubusercontent.com/thearthd/3d-models/main/croccodilosconstruction.glb',
            gltf => {
                const grp = gltf.scene;
                grp.scale.set(SCALE,SCALE,SCALE);
                grp.updateMatrixWorld(true);
                scene.add(grp);

                grp.traverse(child => {
                    if (!child.isMesh) return;

                    let geom = child.geometry;
                    if (!geom || !geom.isBufferGeometry) {
                        geom = legacyToBufferGeometry(geom);
                        child.geometry = geom;
                    }
                    if (!geom.index) {
                        geom.setIndex(new THREE.BufferAttribute(generateSequentialIndices(geom.attributes.position.count),1));
                    }
                    if (!geom.isBufferGeometry) {
                        console.warn(`Skipping ${child.name}: not BufferGeometry.`);
                        return;
                    }
                    geom.computeBoundsTree();

                    child.castShadow = child.receiveShadow = true;
                    if (child.material.map) child.material.map.anisotropy = 4;
                    window.envMeshes.push(child);
                });
                res(grp);
            },
            evt => { if (evt.lengthComputable) onGLB(evt); },
            err => rej(err)
        );
    });
    loaderUI.track(0.9, glbPromise, cb => onGLB = cb);

    // 2) build BVH
    let onBVH = () => {};
    const bvhPromise = glbPromise.then(grp => physicsController.buildBVH(grp, onBVH));
    loaderUI.track(0.1, bvhPromise, cb => onBVH = cb);

    await Promise.all([glbPromise, bvhPromise]);
    loaderUI.onComplete(() => { window.mapReady = true; });

    return spawns;
}

// ─── createSigmaCity ────────────────────────────────────────────────────────
export async function createSigmaCity(scene, physicsController) {
    window.envMeshes = [];
    window.mapReady = false;

    const loaderUI = new Loader();
    loaderUI.show('Loading SigmaCity Map & Building BVH...', [0.9, 0.1]);

    // sunlight
    const sun = new THREE.DirectionalLight(0xffffff,1);
    sun.position.set(50,100,50);
    sun.target.position.set(0,0,0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048,2048);
    const d2 = 100;
    Object.assign(sun.shadow.camera, { left:-d2, right:d2, top:d2, bottom:-d2, near:0.1, far:200 });
    scene.add(sun, sun.target);

    const SCALE = 2;
    const spawns = [ new THREE.Vector3(0,15,0) ].map(p => p.clone().multiplyScalar(SCALE/2));

    let onGLB2 = () => {};
    const glbPromise2 = new Promise((res, rej) => {
        new GLTFLoader().load(
            'https://raw.githubusercontent.com/thearthd/3d-models/main/sigmaCITYPLEASE.glb',
            gltf => {
                const grp = gltf.scene;
                grp.scale.set(SCALE,SCALE,SCALE);
                grp.updateMatrixWorld(true);
                scene.add(grp);

                grp.traverse(child => {
                    if (!child.isMesh) return;

                    let geom = child.geometry;
                    if (!geom || !geom.isBufferGeometry) {
                        geom = legacyToBufferGeometry(geom);
                        child.geometry = geom;
                    }
                    if (!geom.index) {
                        geom.setIndex(new THREE.BufferAttribute(generateSequentialIndices(geom.attributes.position.count),1));
                    }
                    if (!geom.isBufferGeometry) {
                        console.warn(`Skipping ${child.name}: not BufferGeometry.`);
                        return;
                    }
                    geom.computeBoundsTree();

                    child.castShadow = child.receiveShadow = true;
                    if (child.material.map) child.material.map.anisotropy = 4;
                    window.envMeshes.push(child);
                });
                res(grp);
            },
            evt => { if (evt.lengthComputable) onGLB2(evt); },
            err => rej(err)
        );
    });
    loaderUI.track(0.9, glbPromise2, cb => onGLB2 = cb);

    let onBVH2 = () => {};
    const bvhPromise2 = glbPromise2.then(grp => physicsController.buildBVH(grp, onBVH2));
    loaderUI.track(0.1, bvhPromise2, cb => onBVH2 = cb);

    await Promise.all([glbPromise2, bvhPromise2]);
    loaderUI.onComplete(() => { window.mapReady = true; });

    return spawns;
}
