// OctreeV2.js
// This file contains the OctreeV2 class and its helper functions,
// extracted from the previous HTML Canvas for modularity.

import {
	Box3,
	Line3,
	Plane,
	Sphere,
	Triangle,
	Vector3,
    Color, // Added Color for generateVisualization
    Object3D // Added Object3D for generateVisualization (Group is a subclass)
} from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js';

import { Capsule } from 'three/examples/jsm/math/Capsule.js';


const _v1 = new Vector3();
const _v2 = new Vector3();
const _point1 = new Vector3();
const _point2 = new Vector3();
const _plane = new Plane();
const _line1 = new Line3();
const _line2 = new Line3();
const _sphere = new Sphere();
const _capsule = new Capsule(); // Corrected import for Capsule


// Missing lineToLineClosestPoints from the original three.js example.
// Re-adding it as it's used by triangleCapsuleIntersect.
function lineToLineClosestPoints( line1, line2, target1 = null, target2 = null ) {

    const r = _v1.copy( line1.end ).sub( line1.start );
    const s = _v2.copy( line2.end ).sub( line2.start );
    const w = _point1.copy( line2.start ).sub( line1.start ); // Using _point1 as temp

    const a = r.dot( s ),
        b = r.dot( r ),
        c = s.dot( s ),
        d = s.dot( w ),
        e = r.dot( w );

    let t1, t2;
    const EPS = 1e-10; // Defined locally in original, moved here for consistency
    const divisor = b * c - a * a;

    if ( Math.abs( divisor ) < EPS ) {

        const d1 = - d / c;
        const d2 = ( a - d ) / c;

        if ( Math.abs( d1 - 0.5 ) < Math.abs( d2 - 0.5 ) ) {

            t1 = 0;
            t2 = d1;

        } else {

            t1 = 1;
            t2 = d2;

        }

    } else {

        t1 = ( d * a + e * c ) / divisor;
        t2 = ( t1 * a - d ) / c;

    }

    t1 = Math.max( 0, Math.min( 1, t1 ) );
    t2 = Math.max( 0, Math.min( 1, t2 ) );

    if ( target1 ) {

        target1.copy( r ).multiplyScalar( t1 ).add( line1.start );

    }

    if ( target2 ) {

        target2.copy( s ).multiplyScalar( t2 ).add( line2.start );

    }

}


export class OctreeV2 {

    constructor( box ) {

        this.triangleIndices = []; // Stores indices to a global triangle array
        this.box = box;
        this.subTrees = [];
        this.bounds = null; // Will be initialized in addTriangle

        this._totalTrianglesAdded = 0;
        this._totalTriangleCount = 0;
        this._onProgressCallback = null;
        this._addPhaseWeight = 0.5;
        this._buildPhaseWeight = 0.5;

        this._splitQueue = [];
        this._cellsProcessedForSplit = 0;
        this._totalCellsToSplitEstimate = 0;
    }

    addTriangle( triangle, originalIndex ) {

        if ( ! this.bounds ) this.bounds = new Box3(); // Use Box3 directly

        this.bounds.min.x = Math.min( this.bounds.min.x, triangle.a.x, triangle.b.x, triangle.c.x );
        this.bounds.min.y = Math.min( this.bounds.min.y, triangle.a.y, triangle.b.y, triangle.c.y );
        this.bounds.min.z = Math.min( this.bounds.min.z, triangle.a.z, triangle.b.z, triangle.c.z );
        this.bounds.max.x = Math.max( this.bounds.max.x, triangle.a.x, triangle.b.x, triangle.c.x );
        this.bounds.max.y = Math.max( this.bounds.max.y, triangle.a.y, triangle.b.y, triangle.c.y );
        this.bounds.max.z = Math.max( this.bounds.max.z, triangle.a.z, triangle.b.z, triangle.c.z );

        this.triangleIndices.push( originalIndex );
        this._totalTrianglesAdded++;

        return this;

    }

    calcBox() {

        if (this.triangleIndices.length === 0) {
            this.box = new Box3(); // Use Box3 directly
            return this;
        }

        this.box = this.bounds.clone();

        this.box.min.x -= 0.01;
        this.box.min.y -= 0.01;
        this.box.min.z -= 0.01;

        return this;

    }

    _splitIterative( level, allTriangles, onComplete ) {
        const trianglesPerLeaf = 8;
        const maxLevel = 10;

        const processBatchSize = 100;

        if (level === 0 && this._splitQueue.length === 0 && this.triangleIndices.length > trianglesPerLeaf) {
            this._splitQueue.push({ octree: this, level: 0 });
            this._totalCellsToSplitEstimate = Math.ceil(this._totalTriangleCount / trianglesPerLeaf) * 2;
            if (this._totalCellsToSplitEstimate === 0) this._totalCellsToSplitEstimate = 1;
        } else if (this.triangleIndices.length <= trianglesPerLeaf || level >= maxLevel) {
            onComplete();
            return;
        }


        const processNextSplitBatch = () => {
            let processedInBatch = 0;
            while (this._splitQueue.length > 0 && processedInBatch < processBatchSize) {
                const { octree, level } = this._splitQueue.shift();

                if (octree.triangleIndices.length > trianglesPerLeaf && level < maxLevel) {

                    const subTrees = [];
                    const halfsize = _v2.copy( octree.box.max ).sub( octree.box.min ).multiplyScalar( 0.5 );

                    for ( let x = 0; x < 2; x ++ ) {
                        for ( let y = 0; y < 2; y ++ ) {
                            for ( let z = 0; z < 2; z ++ ) {
                                const box = new Box3(); // Use Box3 directly
                                const v = _v1.set( x, y, z );
                                box.min.copy( octree.box.min ).add( v.multiply( halfsize ) );
                                box.max.copy( box.min ).add( halfsize );
                                subTrees.push( new OctreeV2( box ) );
                            }
                        }
                    }

                    let triangleIndex;
                    const triangleIndicesToRedistribute = octree.triangleIndices.splice(0);

                    while ( triangleIndex = triangleIndicesToRedistribute.pop() ) {
                        const triangle = allTriangles[triangleIndex];
                        for (let subTreeIdx = 0; subTreeIdx < subTrees.length; subTreeIdx++) {
                            if ( subTrees[ subTreeIdx ].box.intersectsTriangle( triangle ) ) {
                                subTrees[ subTreeIdx ].triangleIndices.push( triangleIndex );
                            }
                        }
                    }

                    for ( let i = 0; i < subTrees.length; i ++ ) {
                        const len = subTrees[ i ].triangleIndices.length;

                        if ( len > trianglesPerLeaf && level <= maxLevel ) {
                            this._splitQueue.push({ octree: subTrees[i], level: level + 1 });
                        }

                        if ( len !== 0 ) {
                            octree.subTrees.push( subTrees[ i ] );
                        }
                    }
                }
                this._cellsProcessedForSplit++;
                processedInBatch++;
            }

            if (this._onProgressCallback && this._totalTriangleCount > 0) {
                const currentSplitProgress = Math.min(1, this._cellsProcessedForSplit / this._totalCellsToSplitEstimate);
                const overallProgress = this._addPhaseWeight + (currentSplitProgress * this._buildPhaseWeight);
                this._onProgressCallback({ loaded: overallProgress, total: 1 });
            }

            if (this._splitQueue.length > 0) {
                requestAnimationFrame(processNextSplitBatch);
            } else {
                this._onProgressCallback({ loaded: 1, total: 1 });
                if (onComplete) onComplete();
            }
        };

        requestAnimationFrame(processNextSplitBatch);
    }


    /**
     * Builds the Octree.
     *
     * @param {Array<Triangle>} allTriangles - A flat array of all triangles from the model.
     * @param {function({loaded: number, total: number}):void} [onProgress] - Callback for progress updates (0-1).
     * @return {Promise<Octree>} A promise that resolves to this Octree when building is complete.
     */
    build( allTriangles, onProgress = () => {} ) {
        this._onProgressCallback = onProgress;
        this._cellsProcessedForSplit = 0;
        this._splitQueue = [];

        this.calcBox();

        if (this.triangleIndices.length === 0 && this.subTrees.length === 0) {
            onProgress({ loaded: 1, total: 1 });
            return Promise.resolve(this);
        }

        return new Promise(resolve => {
            this._splitIterative(0, allTriangles, () => {
                resolve(this);
            });
        });
    }

    getRayTriangles( ray, triangles, allTriangles ) {

        for ( let i = 0; i < this.subTrees.length; i ++ ) {

            const subTree = this.subTrees[ i ];
            if ( ! ray.intersectsBox( subTree.box ) ) continue;

            if ( subTree.triangleIndices.length > 0 ) {

                for ( let j = 0; j < subTree.triangleIndices.length; j ++ ) {

                    const triangle = allTriangles[subTree.triangleIndices[j]];
                    if ( triangles.indexOf( triangle ) === - 1 ) triangles.push( triangle );

                }

            } else {

                subTree.getRayTriangles( ray, triangles, allTriangles );

            }

        }

        return triangles;

    }

    triangleCapsuleIntersect( capsule, triangle ) {

        triangle.getPlane( _plane );

        const d1 = _plane.distanceToPoint( capsule.start ) - capsule.radius;
        const d2 = _plane.distanceToPoint( capsule.end ) - capsule.radius;

        if ( ( d1 > 0 && d2 > 0 ) || ( d1 < - capsule.radius && d2 < - capsule.radius ) ) {

            return false;

        }

        const delta = Math.abs( d1 / ( Math.abs( d1 ) + Math.abs( d2 ) ) );
        const intersectPoint = _v1.copy( capsule.start ).lerp( capsule.end, delta );

        if ( triangle.containsPoint( intersectPoint ) ) {

            return { normal: _plane.normal.clone(), point: intersectPoint.clone(), depth: Math.abs( Math.min( d1, d2 ) ) };

        }

        const r2 = capsule.radius * capsule.radius;

        const line1 = _line1.set( capsule.start, capsule.end );

        const lines = [
            [ triangle.a, triangle.b ],
            [ triangle.b, triangle.c ],
            [ triangle.c, triangle.a ]
        ];

        for ( let i = 0; i < lines.length; i ++ ) {

            const line2 = _line2.set( lines[ i ][ 0 ], lines[ i ][ 1 ] );

            lineToLineClosestPoints( line1, line2, _point1, _point2 );

            if ( _point1.distanceToSquared( _point2 ) < r2 ) {

                return { normal: _point1.clone().sub( _point2 ).normalize(), point: _point2.clone(), depth: capsule.radius - _point1.distanceTo( _point2 ) };

            }

        }

        return false;

    }

    triangleSphereIntersect( sphere, triangle ) {

        triangle.getPlane( _plane );

        if ( ! sphere.intersectsPlane( _plane ) ) return false;

        const depth = Math.abs( _plane.distanceToSphere( sphere ) );
        const r2 = sphere.radius * sphere.radius - depth * depth;

        const plainPoint = _plane.projectPoint( sphere.center, _v1 );

        if ( triangle.containsPoint( sphere.center ) ) {

            return { normal: _plane.normal.clone(), point: plainPoint.clone(), depth: Math.abs( _plane.distanceToSphere( sphere ) ) };

        }

        const lines = [
            [ triangle.a, triangle.b ],
            [ triangle.b, triangle.c ],
            [ triangle.c, triangle.a ]
        ];

        for ( let i = 0; i < lines.length; i ++ ) {

            _line1.set( lines[ i ][ 0 ], lines[ i ][ 1 ] );
            _line1.closestPointToPoint( plainPoint, true, _v2 );

            const d = _v2.distanceToSquared( sphere.center );

            if ( d < r2 ) {

                return { normal: sphere.center.clone().sub( _v2 ).normalize(), point: _v2.clone(), depth: sphere.radius - Math.sqrt( d ) };

            }

        }

        return false;

    }

    getSphereTriangles( sphere, triangles, allTriangles ) {

        for ( let i = 0; i < this.subTrees.length; i ++ ) {

            const subTree = this.subTrees[ i ];

            if ( ! sphere.intersectsBox( subTree.box ) ) continue;

            if ( subTree.triangleIndices.length > 0 ) {

                for ( let j = 0; j < subTree.triangleIndices.length; j ++ ) {

                    const triangle = allTriangles[subTree.triangleIndices[j]];
                    if ( triangles.indexOf( triangle ) === - 1 ) triangles.push( triangle );

                }

            } else {

                subTree.getSphereTriangles( sphere, triangles, allTriangles );

            }

        }

    }

    getCapsuleTriangles( capsule, triangles, allTriangles ) {

        for ( let i = 0; i < this.subTrees.length; i ++ ) {

            const subTree = this.subTrees[ i ];

            if ( ! capsule.intersectsBox( subTree.box ) ) continue;

            if ( subTree.triangleIndices.length > 0 ) {

                for ( let j = 0; j < subTree.triangleIndices.length; j ++ ) {

                    const triangle = allTriangles[subTree.triangleIndices[j]];
                    if ( triangles.indexOf( triangle ) === - 1 ) triangles.push( triangle );

                }

            } else {

                subTree.getCapsuleTriangles( capsule, triangles, allTriangles );

            }

        }

    }

    sphereIntersect( sphere, allTriangles ) {

        _sphere.copy( sphere );

        const triangles = [];
        let result, hit = false;

        this.getSphereTriangles( sphere, triangles, allTriangles );

        for ( let i = 0; i < triangles.length; i ++ ) {

            if ( result = this.triangleSphereIntersect( _sphere, triangles[ i ] ) ) {

                hit = true;

                _sphere.center.add( result.normal.multiplyScalar( result.depth ) );

            }

        }

        if ( hit ) {

            const collisionVector = _sphere.center.clone().sub( sphere.center );
            const depth = collisionVector.length();

            return { normal: collisionVector.normalize(), depth: depth };

        }

        return false;

    }

    capsuleIntersect( capsule, allTriangles ) {

        _capsule.copy( capsule );

        const triangles = [];
        let result, hit = false;

        this.getCapsuleTriangles( _capsule, triangles, allTriangles );

        for ( let i = 0; i < triangles.length; i ++ ) {

            if ( result = this.triangleCapsuleIntersect( _capsule, triangles[ i ] ) ) {

                hit = true;

                _capsule.translate( result.normal.multiplyScalar( result.depth ) );

            }

        }

        if ( hit ) {

            const collisionVector = _capsule.getCenter( new Vector3() ).sub( capsule.getCenter( _v1 ) ); // Use Vector3 directly
            const depth = collisionVector.length();

            return { normal: collisionVector.normalize(), depth: depth };

        }

        return false;

    }

    rayIntersect( ray, allTriangles ) {

        if ( ray.direction.length() === 0 ) return;

        const triangles = [];
        let triangle, position, distance = 1e100;

        this.getRayTriangles( ray, triangles, allTriangles );

        for ( let i = 0; i < triangles.length; i ++ ) {

            const result = ray.intersectTriangle( triangles[ i ].a, triangles[ i ].b, triangles[ i ].c, true, _v1 );

            if ( result ) {

                const newdistance = result.sub( ray.origin ).length();

                if ( distance > newdistance ) {

                    position = result.clone().add( ray.origin );
                    distance = newdistance;
                    triangle = triangles[ i ];

                }

            }

        }

        return distance < 1e100 ? { distance: distance, triangle: triangle, position: position } : false;

    }


    /**
     * Constructs the Octree from the given 3D object.
     * This method also extracts all triangles into a flat array.
     *
     * @param {Object3D} group - The scene graph node.
     * @param {function({loaded: number, total: number}):void} [onProgress] - Callback for progress updates (0-1).
     * @return {Promise<Array<Triangle>>} A promise that resolves to the flat array of all triangles.
     */
    fromGraphNode( group, onProgress = () => {} ) {

        this.clear();

        group.updateWorldMatrix( true, true );

        let totalMeshTriangles = 0;
        const allTriangles = [];

        group.traverse( ( obj ) => {
            if ( obj.isMesh === true ) {
                let geometry, isTemp = false;

                if ( obj.geometry.index !== null ) {
                    isTemp = true;
                    geometry = obj.geometry.toNonIndexed();
                } else {
                    geometry = obj.geometry;
                }

                const positionAttribute = geometry.getAttribute( 'position' );
                if (positionAttribute) {
                    totalMeshTriangles += positionAttribute.count / 3;
                    for ( let i = 0; i < positionAttribute.count; i += 3 ) {
                        const v1 = new Vector3().fromBufferAttribute( positionAttribute, i ); // Use Vector3 directly
                        const v2 = new Vector3().fromBufferAttribute( positionAttribute, i + 1 ); // Use Vector3 directly
                        const v3 = new Vector3().fromBufferAttribute( positionAttribute, i + 2 ); // Use Vector3 directly

                        v1.applyMatrix4( obj.matrixWorld );
                        v2.applyMatrix4( obj.matrixWorld );
                        v3.applyMatrix4( obj.matrixWorld );

                        allTriangles.push(new Triangle( v1, v2, v3 )); // Use Triangle directly
                    }
                }

                if ( isTemp ) {
                    geometry.dispose();
                }
            }
        });

        this._totalTriangleCount = totalMeshTriangles;
        this._totalTrianglesAdded = 0;
        this._onProgressCallback = onProgress;
        this._splitQueue = [];
        this._cellsProcessedForSplit = 0;
        this._totalCellsToSplitEstimate = 0;

        const triangleIndicesToAddQueue = [];
        for(let i = 0; i < allTriangles.length; i++) {
            triangleIndicesToAddQueue.push(i);
        }

        return new Promise(resolve => {
            const processAddTrianglesBatch = () => {
                let processedInBatch = 0;
                const triangleAddBatchSize = 1000;
                while(triangleIndicesToAddQueue.length > 0 && processedInBatch < triangleAddBatchSize) {
                    const triangleIndex = triangleIndicesToAddQueue.shift();
                    this.addTriangle(allTriangles[triangleIndex], triangleIndex);
                    processedInBatch++;

                    const progress = (this._totalTrianglesAdded / this._totalTriangleCount) * this._addPhaseWeight;
                    if (this._onProgressCallback) {
                        this._onProgressCallback({ loaded: progress, total: 1 });
                    }
                }

                if (triangleIndicesToAddQueue.length > 0) {
                    requestAnimationFrame(processAddTrianglesBatch);
                } else {
                    this.build(allTriangles, this._onProgressCallback).then(() => {
                        resolve(allTriangles); // Resolve with allTriangles
                    });
                }
            };

            requestAnimationFrame(processAddTrianglesBatch);
        });
    }

    clear() {

        this.box = null;
        this.bounds = null;
        this.triangleIndices.length = 0;
        this.subTrees.length = 0;


        this._totalTrianglesAdded = 0;
        this._totalTriangleCount = 0;
        this._onProgressCallback = null;
        this._splitQueue = [];
        this._cellsProcessedForSplit = 0;
        this._totalCellsToSplitEstimate = 0;

        return this;

    }

    /**
     * Generates a THREE.Group containing THREE.Box3Helper for each octree node.
     * @param {Color} [color=0x00ff00] - Color of the bounding boxes.
     * @param {number} [maxDepth=-1] - Maximum depth to visualize. -1 for all depths.
     * @param {number} [currentDepth=0] - Current recursion depth (internal use).
     * @returns {Object3D} A group containing the octree visualization.
     */


    /**
     * Serializes the Octree structure into a plain JavaScript object.
     * Only stores bounding box data and triangle indices.
     * @returns {Object} A serializable representation of the octree.
     */
    serialize() {
        const serializeNode = (node) => {
            const serialized = {
                box: {
                    min: [node.box.min.x, node.box.min.y, node.box.min.z],
                    max: [node.box.max.x, node.box.max.y, node.box.max.z]
                },
                triangleIndices: node.triangleIndices,
                subTrees: []
            };
            for (const subTree of node.subTrees) {
                serialized.subTrees.push(serializeNode(subTree));
            }
            return serialized;
        };
        return serializeNode(this);
    }

    /**
     * Deserializes a plain JavaScript object into an OctreeV2 instance.
     * Requires the original flat array of THREE.Triangle objects.
     * @param {Object} serializedData - The serialized octree data.
     * @param {Array<Triangle>} allTriangles - The flat array of all triangles from the model.
     * @returns {OctreeV2} A new OctreeV2 instance.
     */
    static deserialize(serializedData, allTriangles) {
        const deserializeNode = (data) => {
            const octree = new OctreeV2(
                new Box3( // Use Box3 directly
                    new Vector3(data.box.min[0], data.box.min[1], data.box.min[2]), // Use Vector3 directly
                    new Vector3(data.box.max[0], data.box.max[1], data.box.max[2]) // Use Vector3 directly
                )
            );
            octree.triangleIndices = data.triangleIndices;
            octree.bounds = octree.box.clone();

            for (const subTreeData of data.subTrees) {
                octree.subTrees.push(deserializeNode(subTreeData));
            }
            return octree;
        };
        const newOctree = deserializeNode(serializedData);
        newOctree._totalTriangleCount = allTriangles.length;
        return newOctree;
    }
}
