import {
	Box3,
	Line3,
	Plane,
	Sphere,
	Triangle,
	Vector3
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

function lineToLineClosestPoints( line1, line2, target1 = null, target2 = null ) {

	const r = _v1.copy( line1.end ).sub( line1.start );
	const s = _v2.copy( line2.end ).sub( line2.start );
	const w = _point1.copy( line2.start ).sub( line1.start );

	const a = r.dot( s ),
		b = r.dot( r ),
		c = s.dot( s ),
		d = s.dot( w ),
		e = r.dot( w );

	let t1, t2;
	const EPS = 1e-10;
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
		this.bounds = null;

		this._totalTrianglesAdded = 0;
		this._totalTriangleCount = 0;
		this._onProgressCallback = null;
		this._addPhaseWeight = 0.5;
		this._buildPhaseWeight = 0.5;

		this._splitQueue = [];
		this._cellsProcessedForSplit = 0;
		this._totalCellsToSplitEstimate = 0;
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
		this._totalTrianglesAdded++;

		return this;

	}

	calcBox() {

		if (this.triangles.length === 0) {
			this.box = new Box3();
			return this;
		}

		this.box = this.bounds.clone();

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

	fromGraphNode( group, onProgress = () => {} ) {

		this.clear();

		group.updateWorldMatrix( true, true );

		let totalMeshTriangles = 0;
		group.traverse( ( obj ) => {
			if ( obj.isMesh === true ) {
				const geometry = obj.geometry;
				const positionAttribute = geometry.getAttribute( 'position' );
				if (positionAttribute) {
					totalMeshTriangles += (geometry.index ? geometry.index.count : positionAttribute.count) / 3;
				}
			}
		});

		this._totalTriangleCount = totalMeshTriangles;
		this._totalTrianglesAdded = 0;
		this._onProgressCallback = onProgress;
		this._splitQueue = [];
		this._cellsProcessedForSplit = 0;
		this._totalCellsToSplitEstimate = 0;

		const trianglesToAddQueue = [];

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

		const triangleAddBatchSize = 1000;
		let trianglesAddedInCurrentPhase = 0;

		return new Promise(resolve => {
			const processAddTrianglesBatch = () => {
				let processedInBatch = 0;
				while(trianglesToAddQueue.length > 0 && processedInBatch < triangleAddBatchSize) {
					this.addTriangle(trianglesToAddQueue.shift());
					processedInBatch++;
					trianglesAddedInCurrentPhase++;

					const progress = (trianglesAddedInCurrentPhase / this._totalTriangleCount) * this._addPhaseWeight;
					if (this._onProgressCallback) {
						this._onProgressCallback({ loaded: progress, total: 1 });
					}
				}

				if (trianglesToAddQueue.length > 0) {
					requestAnimationFrame(processAddTrianglesBatch);
				} else {
					this.build(this._onProgressCallback).then(() => {
						resolve(this);
					});
				}
			};

			requestAnimationFrame(processAddTrianglesBatch);
		});
	}

	clear() {

		this.box = null;
		this.bounds = null;
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

    // --- NEW: Serialization Methods ---

    /**
     * Converts a Vector3 to a plain object for JSON serialization.
     * @param {Vector3} v
     * @returns {Object}
     */
    static serializeVector3(v) {
        if (!v) return null;
        return { x: v.x, y: v.y, z: v.z };
    }

    /**
     * Reconstructs a Vector3 from a plain object.
     * @param {Object} obj
     * @returns {Vector3}
     */
    static deserializeVector3(obj) {
        if (!obj) return null;
        return new Vector3(obj.x, obj.y, obj.z);
    }

    /**
     * Converts a Box3 to a plain object for JSON serialization.
     * @param {Box3} box
     * @returns {Object}
     */
    static serializeBox3(box) {
        if (!box) return null;
        return {
            min: OctreeV2.serializeVector3(box.min),
            max: OctreeV2.serializeVector3(box.max)
        };
    }

    /**
     * Reconstructs a Box3 from a plain object.
     * @param {Object} obj
     * @returns {Box3}
     */
    static deserializeBox3(obj) {
        if (!obj) return null;
        const min = OctreeV2.deserializeVector3(obj.min);
        const max = OctreeV2.deserializeVector3(obj.max);
        return new Box3(min, max);
    }

    /**
     * Converts a Triangle to a plain object for JSON serialization.
     * @param {Triangle} triangle
     * @returns {Object}
     */
    static serializeTriangle(triangle) {
        if (!triangle) return null;
        return {
            a: OctreeV2.serializeVector3(triangle.a),
            b: OctreeV2.serializeVector3(triangle.b),
            c: OctreeV2.serializeVector3(triangle.c)
        };
    }

    /**
     * Reconstructs a Triangle from a plain object.
     * @param {Object} obj
     * @returns {Triangle}
     */
    static deserializeTriangle(obj) {
        if (!obj) return null;
        const a = OctreeV2.deserializeVector3(obj.a);
        const b = OctreeV2.deserializeVector3(obj.b);
        const c = OctreeV2.deserializeVector3(obj.c);
        return new Triangle(a, b, c);
    }

    /**
     * Converts the OctreeV2 instance to a JSON-serializable plain object.
     * @returns {Object}
     */
    toJSON() {
        return {
            box: OctreeV2.serializeBox3(this.box),
            bounds: OctreeV2.serializeBox3(this.bounds),
            triangles: this.triangles.map(t => OctreeV2.serializeTriangle(t)),
            subTrees: this.subTrees.map(st => st.toJSON()) // Recursively serialize sub-trees
            // Other properties like _totalTrianglesAdded, _totalTriangleCount, etc.,
            // are internal for building and not necessary for the saved structure.
        };
    }

    /**
     * Reconstructs an OctreeV2 instance from a JSON-serializable plain object.
     * This is a static method as it creates a new instance.
     * @param {Object} jsonObject
     * @returns {OctreeV2}
     */
    static fromJSON(jsonObject) {
        const octree = new OctreeV2(OctreeV2.deserializeBox3(jsonObject.box));
        octree.bounds = OctreeV2.deserializeBox3(jsonObject.bounds);
        octree.triangles = jsonObject.triangles.map(t => OctreeV2.deserializeTriangle(t));
        octree.subTrees = jsonObject.subTrees.map(st => OctreeV2.fromJSON(st)); // Recursively deserialize sub-trees
        return octree;
    }

    // --- END NEW ---

}

export { OctreeV2 };
