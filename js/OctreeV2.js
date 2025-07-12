import {
	Box3,
	Line3,
	Plane,
	Sphere,
	Triangle,
	Vector3
} from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js';

import { Capsule } from 'https://unpkg.com/three@0.152.0/examples/jsm/math/Capsule.js'; // Updated path for direct browser use

const _v1 = new Vector3();
const _v2 = new Vector3();
const _point1 = new Vector3(); // Added missing _point1
const _point2 = new Vector3(); // Added missing _point2
const _plane = new Plane();
const _line1 = new Line3();
const _line2 = new Line3();
const _sphere = new Sphere();
const _capsule = new Capsule();

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
		this._totalTrianglesAdded = 0; // Tracks triangles added during fromGraphNode
		this._totalTriangleCount = 0; // The total number of triangles expected from the entire GLTF scene
		this._onProgressCallback = null; // Stored callback for progress updates
		this._addPhaseWeight = 0.5; // How much of the total build is the 'addTriangle' phase (0.0 to 1.0)
		this._buildPhaseWeight = 0.5; // How much of the total build is the 'split' phase (0.0 to 1.0)

		// Internal state for iterative splitting to avoid stack overflow and enable progress
		this._splitQueue = []; // Stores { octreeInstance: Octree, level: number }
		this._cellsProcessedForSplit = 0; // Counts how many cells have been processed in splitting
		this._totalCellsToSplitEstimate = 0; // Estimate for total cells that will be split
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

	// This is the new iterative split method, replacing the old recursive 'split'
	_splitIterative( level, onComplete ) {
		const trianglesPerLeaf = 8; // Hardcoded from original example, can be a class property
		const maxLevel = 16; // Hardcoded from original example, can be a class property

		const processBatchSize = 100; // Number of cells to process per animation frame

		// If this is the initial call to _splitIterative (level 0), ensure the root is in the queue
		if (level === 0 && this._splitQueue.length === 0 && this.triangles.length > trianglesPerLeaf) {
			this._splitQueue.push({ octree: this, level: 0 });
			// Estimate total cells to split. This is a rough heuristic.
			// A deeper tree means more cells. A simple estimate is (total triangles / triangles per leaf) * 2 or 3.
			this._totalCellsToSplitEstimate = Math.ceil(this._totalTriangleCount / trianglesPerLeaf) * 2;
			if (this._totalCellsToSplitEstimate === 0) this._totalCellsToSplitEstimate = 1; // Avoid division by zero
		} else if (this.triangles.length <= trianglesPerLeaf || level >= maxLevel) {
			// If this specific octree instance doesn't need splitting, and it's not the root initiating,
			// just complete. This handles cases where a child cell might be pushed but then found to be small enough.
			onComplete();
			return;
		}


		const processNextSplitBatch = () => {
			let processedInBatch = 0;
			while (this._splitQueue.length > 0 && processedInBatch < processBatchSize) {
				const { octree, level } = this._splitQueue.shift(); // Get the next cell to process

				// --- DEBUG LOG: Processing Cell ---
			//	console.log(`[Octree Debug] Processing cell: Level ${level}, Triangles: ${octree.triangles.length}, Queue size: ${this._splitQueue.length + 1} (before shift)`);
				// --- END DEBUG LOG ---


				// Only split if it still needs splitting (e.g., if triangles haven't been moved by a parent's split)
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
								// --- IMPORTANT: Ensure you're creating OctreeV2 instances here ---
								subTrees.push( new OctreeV2( box ) );
								// --- END IMPORTANT ---
							}
						}
					}

					let triangle;
					// Move triangles from the current octree instance to its new sub-trees
					// Use splice to empty the current octree's triangles array
					const trianglesToRedistribute = octree.triangles.splice(0);

					// --- DEBUG LOG: Triangles Redistributed ---
				//	console.log(`[Octree Debug] Redistributing ${trianglesToRedistribute.length} triangles from current cell.`);
					// --- END DEBUG LOG ---

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
							// Push to queue for further splitting in future batches
							this._splitQueue.push({ octree: subTrees[i], level: level + 1 });
							// --- DEBUG LOG: Child Added to Queue ---
						//	console.log(`[Octree Debug] Child cell added to queue: Level ${level + 1}, Triangles: ${len}. New queue size: ${this._splitQueue.length}`);
							// --- END DEBUG LOG ---
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
				// --- DEBUG LOG: Progress Update ---
				//console.log(`[Octree Debug] Progress: ${overallProgress.toFixed(4)} (Cells processed: ${this._cellsProcessedForSplit}, Queue: ${this._splitQueue.length})`);
				// --- END DEBUG LOG ---
			}

			if (this._splitQueue.length > 0) {
				requestAnimationFrame(processNextSplitBatch); // Schedule next batch
			} else {
				// All cells have been processed and split
				this._onProgressCallback({ loaded: 1, total: 1 }); // Ensure final 100%
			//	console.log("[Octree Debug] Octree splitting complete."); // Final completion log
				if (onComplete) onComplete();
			}
		};

		// Start the batched processing
		requestAnimationFrame(processNextSplitBatch);
	}


	/**
	 * Builds the Octree.
	 *
	 * @param {function({loaded: number, total: number}):void} [onProgress] - Callback for progress updates (0-1).
	 * @return {Promise<Octree>} A promise that resolves to this Octree when building is complete.
	 */
	build( onProgress = () => {} ) {
		this._onProgressCallback = onProgress; // Store the callback
		// _totalTriangleCount is already set by fromGraphNode
		this._cellsProcessedForSplit = 0; // Reset for this build cycle
		this._splitQueue = []; // Clear queue from previous runs

		this.calcBox(); // This is synchronous and calculates the overall bounding box

		// If no triangles, or already handled by fromGraphNode's initial check
		if (this.triangles.length === 0 && this.subTrees.length === 0) {
			onProgress({ loaded: 1, total: 1 });
			return Promise.resolve(this);
		}

		return new Promise(resolve => {
			// Start the iterative splitting process.
			// The _splitIterative method will manage its own requestAnimationFrame loop
			// and call the resolve callback when it's truly done.
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

			// This line was calling a non-existent method.
			// Replaced with the correct `lineToLineClosestPoints` helper function.
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
		group.traverse( ( obj ) => {
			if ( obj.isMesh === true ) { // Removed `this.layers.test( obj.layers )` as Layers is not in this version
				const geometry = obj.geometry;
				const positionAttribute = geometry.getAttribute( 'position' );
				if (positionAttribute) {
					totalMeshTriangles += (geometry.index ? geometry.index.count : positionAttribute.count) / 3;
				}
			}
		});

		this._totalTriangleCount = totalMeshTriangles; // Set the total expected triangles
		this._totalTrianglesAdded = 0; // Reset for this build cycle
		this._onProgressCallback = onProgress; // Store the callback for internal use
		this._splitQueue = [];
		this._cellsProcessedForSplit = 0;
		this._totalCellsToSplitEstimate = 0; // Reset estimate

		const trianglesToAddQueue = []; // Store triangles to add in a queue

		group.traverse( ( obj ) => {

			if ( obj.isMesh === true ) { // Removed `this.layers.test( obj.layers )`

				let geometry, isTemp = false;

				if ( obj.geometry.index !== null ) {

					isTemp = true;
					geometry = obj.geometry.toNonIndexed();

				} else {

					geometry = obj.geometry;

				}

				const positionAttribute = geometry.getAttribute( 'position' );

				for ( let i = 0; i < positionAttribute.count; i += 3 ) {

					const v1 = new Vector3().fromBufferAttribute( positionAttribute, i );
					const v2 = new Vector3().fromBufferAttribute( positionAttribute, i + 1 );
					const v3 = new Vector3().fromBufferAttribute( positionAttribute, i + 2 );

					v1.applyMatrix4( obj.matrixWorld );
					v2.applyMatrix4( obj.matrixWorld );
					v3.applyMatrix4( obj.matrixWorld );

					trianglesToAddQueue.push(new Triangle( v1, v2, v3 ));

				}

				if ( isTemp ) {

					geometry.dispose();

				}

			}

		} );

		// Now, process trianglesToAddQueue in batches to report progress
		const triangleAddBatchSize = 1000; // Process 1000 triangles per frame
		let trianglesAddedInCurrentPhase = 0; // Tracks triangles added in this specific phase

		return new Promise(resolve => {
			const processAddTrianglesBatch = () => {
				let processedInBatch = 0;
				while(trianglesToAddQueue.length > 0 && processedInBatch < triangleAddBatchSize) {
					this.addTriangle(trianglesToAddQueue.shift()); // This increments _totalTrianglesAdded
					processedInBatch++;
					trianglesAddedInCurrentPhase++;

					// Update progress for the 'addTriangle' phase
					const progress = (trianglesAddedInCurrentPhase / this._totalTriangleCount) * this._addPhaseWeight;
					if (this._onProgressCallback) {
						this._onProgressCallback({ loaded: progress, total: 1 });
					}
				}

				if (trianglesToAddQueue.length > 0) {
					requestAnimationFrame(processAddTrianglesBatch);
				} else {
					// All triangles have been added. Now start the build (split) phase.
					this.build(this._onProgressCallback).then(() => { // Pass the stored callback to build()
						resolve(this); // Resolve fromGraphNode's promise when build is complete
					});
				}
			};

			requestAnimationFrame(processAddTrianglesBatch);
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

		return this;

	}

	/**
	 * Converts the OctreeV2 instance into a plain JavaScript object suitable for JSON serialization.
	 * @returns {object} A serializable representation of the Octree.
	 */
	toJSON() {
		const data = {
			box: this.box ? { // Only include box if it exists
				min: { x: this.box.min.x, y: this.box.min.y, z: this.box.min.z },
				max: { x: this.box.max.x, y: this.box.max.y, z: this.box.max.z }
			} : null,
			bounds: this.bounds ? { // Include bounds if it exists
				min: { x: this.bounds.min.x, y: this.bounds.min.y, z: this.bounds.min.z },
				max: { x: this.bounds.max.x, y: this.bounds.max.y, z: this.bounds.max.z }
			} : null,
			triangles: [],
			subTrees: []
		};

		// Serialize triangles
		for (const triangle of this.triangles) {
			data.triangles.push({
				a: { x: triangle.a.x, y: triangle.a.y, z: triangle.a.z },
				b: { x: triangle.b.x, y: triangle.b.y, z: triangle.b.z },
				c: { x: triangle.c.x, y: triangle.c.c, z: triangle.c.z }
			});
		}

		// Recursively serialize sub-trees
		for (const subTree of this.subTrees) {
			data.subTrees.push(subTree.toJSON()); // Recursive call
		}

		return data;
	}

	/**
	 * Creates an OctreeV2 instance from a plain JavaScript object (e.g., loaded from JSON).
	 * @param {object} jsonObj The JSON-parsed object representing the Octree.
	 * @returns {OctreeV2} A new OctreeV2 instance reconstructed from the data.
	 */
	static fromJSON(jsonObj) {
		const box = jsonObj.box ?
			new Box3(
				new Vector3(jsonObj.box.min.x, jsonObj.box.min.y, jsonObj.box.min.z),
				new Vector3(jsonObj.box.max.x, jsonObj.box.max.y, jsonObj.box.max.z)
			) : new Box3(); // Default to empty Box3 if no box data

		const octree = new OctreeV2(box);

		// Reconstruct bounds if available, otherwise default to a clone of the box
		if (jsonObj.bounds) {
			octree.bounds = new Box3(
				new Vector3(jsonObj.bounds.min.x, jsonObj.bounds.min.y, jsonObj.bounds.min.z),
				new Vector3(jsonObj.bounds.max.x, jsonObj.bounds.max.y, jsonObj.bounds.max.z)
			);
		} else {
			octree.bounds = box.clone();
		}

		// Reconstruct triangles
		for (const triData of jsonObj.triangles) {
			octree.triangles.push(new Triangle(
				new Vector3(triData.a.x, triData.a.y, triData.a.z),
				new Vector3(triData.b.x, triData.b.y, triData.b.z),
				new Vector3(triData.c.x, triData.c.y, triData.c.z)
			));
		}

		// Recursively reconstruct sub-trees
		for (const subTreeData of jsonObj.subTrees) {
			octree.subTrees.push(OctreeV2.fromJSON(subTreeData)); // Recursive call
		}

		return octree;
	}
}

export { OctreeV2 };
