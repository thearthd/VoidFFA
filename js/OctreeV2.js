// js/OctreeV2.js

import {
	Box3,
	Line3,
	Plane,
	Sphere,
	Triangle,
	Vector3,
    // Added for generateSerializedOctreeData static utility method
    Group,
    Mesh,
    BufferGeometry,
    BufferAttribute,
    Matrix4 // Used for applyMatrix4
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
const _capsule = new Capsule();
const _tempMatrix4 = new Matrix4(); // Added for temporary matrix in static method

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


class OctreeV2 {

	constructor( box ) {

		this.triangles = [];
		this.box = box;
		this.subTrees = [];
		this.bounds = null; // Will be initialized in addTriangle

		// Custom properties for progress tracking
		this._totalTrianglesAdded = 0; // Tracks triangles added during fromGraphNode / _processAndBuildFromSerializedData
		this._totalTriangleCount = 0; // The total number of triangles expected
		this._onProgressCallback = null; // Stored callback for progress updates
		this._addPhaseWeight = 0.5; // How much of the total build is the 'addTriangle' phase (0.0 to 1.0)
		this._buildPhaseWeight = 0.5; // How much of the total build is the 'split' phase (0.0 to 1.0)

		// Internal state for iterative splitting to avoid stack overflow and enable progress
		this._splitQueue = []; // Stores { octreeInstance: Octree, level: number }
		this._cellsProcessedForSplit = 0; // Counts how many cells have been processed in splitting
		this._totalCellsToSplitEstimate = 0; // Estimate for total cells that will be split

		this._serializedTriangles = null; // Stores serialized triangle data for quick re-saving
	}

	addTriangle( triangle ) {

		if ( ! this.bounds ) this.bounds = new Box3();

		this.bounds.min.x = Math.min( this.bounds.min.x, triangle.a.x, triangle.b.x, triangle.c.x );
		this.bounds.min.y = Math.min( this.bounds.min.y, triangle.a.y, triangle.b.y, triangle.c.y );
		this.bounds.min.z = Math.min( this.bounds.min.z, triangle.a.z, triangle.b.z, triangle.c.z );
		this.bounds.max.x = Math.max( this.bounds.max.x, triangle.a.x, triangle.b.x, triangle.c.x );
		this.bounds.max.y = Math.max( this.bounds.max.y, triangle.a.y, triangle.b.y, triangle.c.y );
		this.bounds.max.z = Math.max( this.bounds.max.z, triangle.a.z, triangle.b.z, triangle.c.z );

		this.triangles.push( triangle );
		this._totalTrianglesAdded++; // Increment counter for progress

		return this;

	}

	calcBox() {

		// If no triangles were added, bounds might be empty. Handle this case.
		if (this.triangles.length === 0) {
			this.box = new Box3(); // Create an empty box
			return this;
		}

		this.box = this.bounds.clone();

		// offset small amount to account for regular grid
		this.box.min.x -= 0.01;
		this.box.min.y -= 0.01;
		this.box.min.z -= 0.01;

		return this;

	}

	_splitIterative( level, onComplete ) {
		const trianglesPerLeaf = 8;
		const maxLevel = 16;

		const processBatchSize = 100;

		if (level === 0 && this._splitQueue.length === 0 && this.triangles.length > trianglesPerLeaf) {
			this._splitQueue.push({ octree: this, level: 0 });
			this._totalCellsToSplitEstimate = Math.ceil(this._totalTriangleCount / trianglesPerLeaf) * 2;
			if (this._totalCellsToSplitEstimate === 0) this._totalCellsToSplitEstimate = 1;
		} else if (this.triangles.length <= trianglesPerLeaf || level >= maxLevel) {
			onComplete();
			return;
		}


		const processNextSplitBatch = () => {
			let processedInBatch = 0;
			while (this._splitQueue.length > 0 && processedInBatch < processBatchSize) {
				const { octree, level } = this._splitQueue.shift();

				if (octree.triangles.length > trianglesPerLeaf && level < maxLevel) {

					const subTrees = [];
					const halfsize = _v2.copy( octree.box.max ).sub( octree.box.min ).multiplyScalar( 0.5 );

					for ( let x = 0; x < 2; x ++ ) {
						for ( let y = 0; y < 2; y ++ ) {
							for ( let z = 0; z < 2; z ++ ) {
								const box = new Box3();
								const v = _v1.set( x, y, z );
								box.min.copy( octree.box.min ).add( v.multiply( halfsize ) );
								box.max.copy( box.min ).add( halfsize );
								subTrees.push( new OctreeV2( box ) );
							}
						}
					}

					let triangle;
					const trianglesToRedistribute = octree.triangles.splice(0);

					while ( triangle = trianglesToRedistribute.pop() ) {
						for ( let i = 0; i < subTrees.length; i ++ ) {
							if ( subTrees[ i ].box.intersectsTriangle( triangle ) ) {
								subTrees[ i ].triangles.push( triangle );
							}
						}
					}

					for ( let i = 0; i < subTrees.length; i ++ ) {
						const len = subTrees[ i ].triangles.length;

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

			// Report progress for the 'build' (splitting) phase
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
	 * @param {function({loaded: number, total: number}):void} [onProgress] - Callback for progress updates (0-1).
	 * @return {Promise<Octree>} A promise that resolves to this Octree when building is complete.
	 */
	build( onProgress = () => {} ) {
		this._onProgressCallback = onProgress;
		this._cellsProcessedForSplit = 0;
		this._splitQueue = [];

		this.calcBox();

		if (this.triangles.length === 0 && this.subTrees.length === 0) {
			onProgress({ loaded: 1, total: 1 });
			return Promise.resolve(this);
		}

		return new Promise(resolve => {
			this._splitIterative(0, () => {
				resolve(this);
			});
		});
	}

	getRayTriangles( ray, triangles ) {

		for ( let i = 0; i < this.subTrees.length; i ++ ) {

			const subTree = this.subTrees[ i ];
			if ( ! ray.intersectsBox( subTree.box ) ) continue;

			if ( subTree.triangles.length > 0 ) {

				for ( let j = 0; j < subTree.triangles.length; j ++ ) {

					if ( triangles.indexOf( subTree.triangles[ j ] ) === - 1 ) triangles.push( subTree.triangles[ j ] );

				}

			} else {

				subTree.getRayTriangles( ray, triangles );

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

	getSphereTriangles( sphere, triangles ) {

		for ( let i = 0; i < this.subTrees.length; i ++ ) {

			const subTree = this.subTrees[ i ];

			if ( ! sphere.intersectsBox( subTree.box ) ) continue;

			if ( subTree.triangles.length > 0 ) {

				for ( let j = 0; j < subTree.triangles.length; j ++ ) {

					if ( triangles.indexOf( subTree.triangles[ j ] ) === - 1 ) triangles.push( subTree.triangles[ j ] );

				}

			} else {

				subTree.getSphereTriangles( sphere, triangles );

			}

		}

	}

	getCapsuleTriangles( capsule, triangles ) {

		for ( let i = 0; i < this.subTrees.length; i ++ ) {

			const subTree = this.subTrees[ i ];

			if ( ! capsule.intersectsBox( subTree.box ) ) continue;

			if ( subTree.triangles.length > 0 ) {

				for ( let j = 0; j < subTree.triangles.length; j ++ ) {

					if ( triangles.indexOf( subTree.triangles[ j ] ) === - 1 ) triangles.push( subTree.triangles[ j ] );

				}

			} else {

				subTree.getCapsuleTriangles( capsule, triangles );

			}

		}

	}

	sphereIntersect( sphere ) {

		_sphere.copy( sphere );

		const triangles = [];
		let result, hit = false;

		this.getSphereTriangles( sphere, triangles );

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

	capsuleIntersect( capsule ) {

		_capsule.copy( capsule );

		const triangles = [];
		let result, hit = false;

		this.getCapsuleTriangles( _capsule, triangles );

		for ( let i = 0; i < triangles.length; i ++ ) {

			if ( result = this.triangleCapsuleIntersect( _capsule, triangles[ i ] ) ) {

				hit = true;

				_capsule.translate( result.normal.multiplyScalar( result.depth ) );

			}

		}

		if ( hit ) {

			const collisionVector = _capsule.getCenter( new Vector3() ).sub( capsule.getCenter( _v1 ) );
			const depth = collisionVector.length();

			return { normal: collisionVector.normalize(), depth: depth };

		}

		return false;

	}

	rayIntersect( ray ) {

		if ( ray.direction.length() === 0 ) return;

		const triangles = [];
		let triangle, position, distance = 1e100;

		this.getRayTriangles( ray, triangles );

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
	 *
	 * @param {Object3D} group - The scene graph node.
	 * @param {function({loaded: number, total: number}):void} [onProgress] - Callback for progress updates (0-1).
	 * @return {Promise<Octree>} A promise that resolves to this Octree when building is complete.
	 */
	fromGraphNode( group, onProgress = () => {} ) {

		this.clear(); // Clear existing data before building

		group.updateWorldMatrix( true, true );

		let totalMeshTriangles = 0;
		const trianglesToCollect = []; // Collect triangles here first

		group.traverse( ( obj ) => {
			if ( obj.isMesh === true ) {
				const geometry = obj.geometry;
				const positionAttribute = geometry.getAttribute( 'position' );
				if (positionAttribute) {
					totalMeshTriangles += (geometry.index ? geometry.index.count : positionAttribute.count) / 3;

					let currentGeometry, isTemp = false;

					if ( geometry.index !== null ) {
						isTemp = true;
						currentGeometry = geometry.toNonIndexed();
					} else {
						currentGeometry = geometry;
					}

					const currentPositionAttribute = currentGeometry.getAttribute( 'position' );
					const objMatrixWorld = obj.matrixWorld;

					for ( let i = 0; i < currentPositionAttribute.count; i += 3 ) {
						const v1 = new Vector3().fromBufferAttribute( currentPositionAttribute, i );
						const v2 = new Vector3().fromBufferAttribute( currentPositionAttribute, i + 1 );
						const v3 = new Vector3().fromBufferAttribute( currentPositionAttribute, i + 2 );

						v1.applyMatrix4( objMatrixWorld );
						v2.applyMatrix4( objMatrixWorld );
						v3.applyMatrix4( objMatrixWorld );

						trianglesToCollect.push(new Triangle( v1, v2, v3 ));
					}

					if ( isTemp ) {
						currentGeometry.dispose();
					}
				}
			}
		});

        // Store the collected triangles for potential serialization
        this._serializedTriangles = this._serializeTriangles(trianglesToCollect);

        // Now, process and build from the collected triangles
        return this._processAndBuildFromSerializedData(this._serializedTriangles, onProgress);
	}

    /**
     * Internal method to process serialized triangle data and rebuild the octree.
     * This is used by fromGraphNode, loadFromLocalStorage, and loadFromFile.
     * @param {number[][]} serializedData - The array of serialized triangle data.
     * @param {function({loaded: number, total: number}):void} [onProgress] - Callback for progress updates.
     * @returns {Promise<OctreeV2>} A promise that resolves to this Octree when building is complete.
     */
    _processAndBuildFromSerializedData(serializedData, onProgress = () => {}) {
        this.clear(); // Clear existing data

        if (!serializedData || serializedData.length === 0) {
            onProgress({ loaded: 1, total: 1 });
            return Promise.resolve(this);
        }

        const deserializedTriangles = this._deserializeTriangles(serializedData);

        this._totalTriangleCount = deserializedTriangles.length;
        this._totalTrianglesAdded = 0;
        this._onProgressCallback = onProgress;
        this._cellsProcessedForSplit = 0;
        this._totalCellsToSplitEstimate = Math.ceil(this._totalTriangleCount / 8) * 2;
        if (this._totalCellsToSplitEstimate === 0) this._totalCellsToSplitEstimate = 1;


        const triangleAddBatchSize = 1000;
        let trianglesAddedInCurrentPhase = 0;
        const trianglesToProcessQueue = [...deserializedTriangles];

        return new Promise(resolve => {
            const processAddTrianglesBatch = () => {
                let processedInBatch = 0;
                while(trianglesToProcessQueue.length > 0 && processedInBatch < triangleAddBatchSize) {
                    this.addTriangle(trianglesToProcessQueue.shift());
                    processedInBatch++;
                    trianglesAddedInCurrentPhase++;

                    // Update progress for the 'addTriangle' phase
                    const progress = (trianglesAddedInCurrentPhase / this._totalTriangleCount) * this._addPhaseWeight;
                    if (this._onProgressCallback) {
                        this._onProgressCallback({ loaded: progress, total: 1 });
                    }
                }

                if (trianglesToProcessQueue.length > 0) {
                    requestAnimationFrame(processAddTrianglesBatch);
                } else {
                    // All triangles have been added. Now start the build (split) phase.
                    this.build(this._onProgressCallback).then(() => {
                        resolve(this);
                    });
                }
            };

            requestAnimationFrame(processAddTrianglesBatch);
        });
    }


    /**
     * Serializes an array of THREE.Triangle objects into a JSON-compatible format.
     * Each triangle is represented by its 9 coordinate values.
     * @param {THREE.Triangle[]} triangles An array of Three.js Triangle objects.
     * @returns {number[][]} An array of arrays, where each inner array contains 9 numbers (x,y,z for each vertex).
     * @private
     */
    _serializeTriangles(triangles) {
        const serializedData = [];
        triangles.forEach(triangle => {
            serializedData.push([
                triangle.a.x, triangle.a.y, triangle.a.z,
                triangle.b.x, triangle.b.y, triangle.b.z,
                triangle.c.x, triangle.c.y, triangle.c.z
            ]);
        });
        return serializedData;
    }

    /**
     * Deserializes triangle data from a JSON-compatible format back into THREE.Triangle objects.
     * @param {number[][]} serializedData An array of arrays, where each inner array contains 9 numbers.
     * @returns {THREE.Triangle[]} An array of Three.js Triangle objects.
     * @private
     */
    _deserializeTriangles(serializedData) {
        const triangles = [];
        serializedData.forEach(data => {
            const v1 = new Vector3(data[0], data[1], data[2]);
            const v2 = new Vector3(data[3], data[4], data[5]);
            const v3 = new Vector3(data[6], data[7], data[8]);
            triangles.push(new Triangle(v1, v2, v3));
        });
        return triangles;
    }

    /**
     * Saves the octree's underlying triangle data to Local Storage.
     * This data can later be used to quickly rebuild the Octree.
     * @param {string} key The key to use for storing data in Local Storage.
     * @returns {boolean} True if save was successful, false otherwise.
     */
    saveToLocalStorage(key) {
        if (!this._serializedTriangles) {
            console.warn("Octree has not been built/loaded with serialized data. Cannot save to local storage.");
            return false;
        }
        try {
            // Check if data is too large for localStorage first
            const dataString = JSON.stringify(this._serializedTriangles);
            // localStorage usually has a 5MB limit. This is a rough estimate.
            // A more robust check would involve trying a small item first.
            if (dataString.length > 4 * 1024 * 1024) { // Roughly 4MB
                console.warn(`Serialized Octree data size (${(dataString.length / (1024 * 1024)).toFixed(2)} MB) might exceed localStorage quota (typically 5MB). Consider using IndexedDB or a pre-built file.`);
                // We still try to save, but warn. The QuotaExceededError will still occur if it's too big.
            }

            localStorage.setItem(key, dataString);
            console.log(`Octree data saved to local storage under key: ${key}`);
            return true;
        } catch (e) {
            console.error(`Failed to save Octree to local storage for key ${key}:`, e);
            // If quota exceeded or other error, clear potentially partial data
            localStorage.removeItem(key);
            return false;
        }
    }

    /**
     * Loads serialized triangle data from Local Storage and rebuilds the Octree.
     * @param {string} key The key used for storing data in Local Storage.
     * @param {function({loaded: number, total: number})} onProgress Callback for progress updates during rebuild.
     * @returns {Promise<OctreeV2|null>} A promise that resolves to the current OctreeV2 instance if successful,
     * or null if no data found or an error occurred.
     */
    loadFromLocalStorage(key, onProgress = () => {}) {
        return new Promise(resolve => {
            try {
                const data = localStorage.getItem(key);
                if (!data) {
                    // console.log(`No Octree data found in local storage for key: ${key}`);
                    resolve(null);
                    return;
                }

                const serializedTriangles = JSON.parse(data);
                if (!serializedTriangles || serializedTriangles.length === 0) {
                    console.warn(`Empty or invalid Octree data found for key: ${key}. Clearing.`);
                    localStorage.removeItem(key); // Clear invalid data
                    resolve(null);
                    return;
                }

                this._serializedTriangles = serializedTriangles; // Store for future save calls
                this._processAndBuildFromSerializedData(serializedTriangles, onProgress)
                    .then(() => {
                        console.log(`Octree successfully rebuilt from local storage for key: ${key}`);
                        resolve(this);
                    })
                    .catch(buildError => {
                        console.error(`Error rebuilding Octree from local storage for key ${key}:`, buildError);
                        localStorage.removeItem(key);
                        resolve(null);
                    });

            } catch (e) {
                console.error(`Failed to load Octree from local storage for key ${key}:`, e);
                localStorage.removeItem(key);
                resolve(null);
            }
        });
    }

    /**
     * Loads serialized triangle data from a remote file (JSON) and rebuilds the Octree.
     * @param {string} url - The URL to the pre-built Octree JSON data file.
     * @param {function({loaded: number, total: number})} onProgress Callback for progress updates during rebuild.
     * @returns {Promise<OctreeV2|null>} A promise that resolves to the current OctreeV2 instance if successful,
     * or null if an error occurred.
     */
    async loadFromFile(url, onProgress = () => {}) {
        try {
            console.log(`Fetching Octree data from file: ${url}`);
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const serializedTriangles = await response.json();

            if (!serializedTriangles || serializedTriangles.length === 0) {
                console.warn(`Empty or invalid Octree data found in file: ${url}`);
                return null;
            }

            this._serializedTriangles = serializedTriangles; // Store for potential re-saving
            return this._processAndBuildFromSerializedData(serializedTriangles, onProgress)
                .then(() => {
                    console.log(`Octree successfully rebuilt from file: ${url}`);
                    return this;
                })
                .catch(buildError => {
                    console.error(`Error rebuilding Octree from file ${url}:`, buildError);
                    return null;
                });

        } catch (e) {
            console.error(`Failed to load Octree from file ${url}:`, e);
            return null;
        }
    }

    /**
     * Static utility method to generate serialized Octree data from a Three.js Object3D group.
     * This is useful for pre-building Octree data during a development or build process.
     * You would call this in a separate script or in your browser's console after a model loads.
     * The result can then be saved to a .json file.
     *
     * @param {Object3D} group - The Three.js Object3D (e.g., GLTF scene) to extract triangles from.
     * @returns {Promise<number[][]>} A promise that resolves with the serialized triangle data.
     */
    static async generateSerializedOctreeData(group) {
        return new Promise(resolve => {
            group.updateWorldMatrix(true, true); // Ensure world matrices are up to date

            const trianglesToCollect = [];

            group.traverse( ( obj ) => {
                if ( obj.isMesh === true ) {
                    let geometry, isTemp = false;

                    // Ensure geometry is non-indexed for direct vertex access
                    if ( obj.geometry.index !== null ) {
                        isTemp = true;
                        geometry = obj.geometry.toNonIndexed();
                    } else {
                        geometry = obj.geometry;
                    }

                    const positionAttribute = geometry.getAttribute( 'position' );
                    const objMatrixWorld = obj.matrixWorld;

                    for ( let i = 0; i < positionAttribute.count; i += 3 ) {
                        const v1 = new Vector3().fromBufferAttribute( positionAttribute, i );
                        const v2 = new Vector3().fromBufferAttribute( positionAttribute, i + 1 );
                        const v3 = new Vector3().fromBufferAttribute( positionAttribute, i + 2 );

                        v1.applyMatrix4( objMatrixWorld );
                        v2.applyMatrix4( objMatrixWorld );
                        v3.applyMatrix4( objMatrixWorld );

                        trianglesToCollect.push(new Triangle( v1, v2, v3 ));
                    }

                    if ( isTemp ) {
                        geometry.dispose();
                    }
                }
            });

            const tempOctree = new OctreeV2(); // Use a temporary instance to access _serializeTriangles
            const serializedData = tempOctree._serializeTriangles(trianglesToCollect);
            console.log(`Generated serialized data for ${trianglesToCollect.length} triangles.`);
            resolve(serializedData);
        });
    }


	clear() {

		this.box = null;
		this.bounds = null; // Reset bounds as well
		this.triangles.length = 0;
		this.subTrees.length = 0;


		this._totalTrianglesAdded = 0;
		this._totalTriangleCount = 0;
		this._onProgressCallback = null;
		this._splitQueue = [];
		this._cellsProcessedForSplit = 0;
		this._totalCellsToSplitEstimate = 0;
        this._serializedTriangles = null; // Clear cached serialized data

		return this;

	}

}

export { OctreeV2 };
