import { Triangle, BoundingBox, BVHNode, Vec3 } from './types.js';

export class BVH {
    private root: BVHNode | null = null;
    private triangles: Triangle[] = [];

    private stats:
        | {
              leafNodes: number;
              totalTriangles: number;
              totalNodes: number;
              maxDepth: number;
          }
        | undefined;
    private wireframeVerticesCount: number = 0;

    constructor(triangles: Triangle[]) {
        this.triangles = triangles;
        this.buildBVH();

        if (this.root) {
            this.stats = this.collectBVHStats(this.root, 0);
        }
    }

    private buildBVH(): void {
        if (this.triangles.length === 0) return;

        // Create indices for all triangles
        const triangleIndices = Array.from(
            { length: this.triangles.length },
            (_, i) => i
        );

        // Calculate bounding box for all triangles
        const sceneBoundingBox = this.calculateSceneBoundingBox();

        // Create root node and split it
        this.root = {
            boundingBox: sceneBoundingBox,
            triangleIndices: triangleIndices,
            leftChild: null,
            rightChild: null,
            isLeaf: false,
            depth: 0,
        };

        // Split the root node into two children
        this.splitNode(this.root);
    }

    private calculateSceneBoundingBox(): BoundingBox {
        if (this.triangles.length === 0) {
            return { min: [0, 0, 0], max: [0, 0, 0] };
        }

        // Initialize with first triangle's first vertex
        const firstVertex = this.triangles[0].v0;
        let minX = firstVertex[0],
            minY = firstVertex[1],
            minZ = firstVertex[2];
        let maxX = firstVertex[0],
            maxY = firstVertex[1],
            maxZ = firstVertex[2];

        // Check all vertices of all triangles
        for (const triangle of this.triangles) {
            const vertices = [triangle.v0, triangle.v1, triangle.v2];

            for (const vertex of vertices) {
                minX = Math.min(minX, vertex[0]);
                minY = Math.min(minY, vertex[1]);
                minZ = Math.min(minZ, vertex[2]);

                maxX = Math.max(maxX, vertex[0]);
                maxY = Math.max(maxY, vertex[1]);
                maxZ = Math.max(maxZ, vertex[2]);
            }
        }

        return {
            min: [minX, minY, minZ],
            max: [maxX, maxY, maxZ],
        };
    }

    private calculateTriangleCentroid(triangleIndex: number): Vec3 {
        const triangle = this.triangles[triangleIndex];
        return [
            (triangle.v0[0] + triangle.v1[0] + triangle.v2[0]) / 3,
            (triangle.v0[1] + triangle.v1[1] + triangle.v2[1]) / 3,
            (triangle.v0[2] + triangle.v1[2] + triangle.v2[2]) / 3,
        ];
    }

    private calculateSurfaceArea(boundingBox: BoundingBox): number {
        const size = [
            boundingBox.max[0] - boundingBox.min[0],
            boundingBox.max[1] - boundingBox.min[1],
            boundingBox.max[2] - boundingBox.min[2],
        ];

        // Surface area of a box: 2 * (width*height + width*depth + height*depth)
        return 2 * (size[0] * size[1] + size[0] * size[2] + size[1] * size[2]);
    }

    private findBestSAHSplit(
        node: BVHNode
    ): { axis: 0 | 1 | 2; position: number; cost: number } | null {
        const triangleCount = node.triangleIndices.length;
        const nodeSurfaceArea = this.calculateSurfaceArea(node.boundingBox);

        // SAH constants
        const traversalCost = 1.0;
        const intersectionCost = 1.0;

        let bestCost = Infinity;
        let bestAxis: 0 | 1 | 2 = 0;
        let bestPosition = 0;

        // Test each axis
        for (let axis = 0; axis < 3; axis++) {
            // Sort triangle centroids along this axis
            const sortedCentroids = node.triangleIndices
                .map((index) => ({
                    index,
                    centroid:
                        this.calculateTriangleCentroid(index)[
                            axis.toString() as '0' | '1' | '2'
                        ],
                }))
                .sort((a, b) => a.centroid - b.centroid);

            // Test splits between each pair of adjacent triangles
            for (let i = 1; i < triangleCount; i++) {
                const splitPosition =
                    (sortedCentroids[i - 1].centroid +
                        sortedCentroids[i].centroid) *
                    0.5;

                // Count triangles on each side
                const leftTriangles = sortedCentroids
                    .slice(0, i)
                    .map((item) => item.index);
                const rightTriangles = sortedCentroids
                    .slice(i)
                    .map((item) => item.index);

                // Calculate bounding boxes for each side
                const leftBBox =
                    this.calculateBoundingBoxForTriangles(leftTriangles);
                const rightBBox =
                    this.calculateBoundingBoxForTriangles(rightTriangles);

                // Calculate surface areas
                const leftSurfaceArea = this.calculateSurfaceArea(leftBBox);
                const rightSurfaceArea = this.calculateSurfaceArea(rightBBox);

                // Calculate SAH cost
                const leftProbability = leftSurfaceArea / nodeSurfaceArea;
                const rightProbability = rightSurfaceArea / nodeSurfaceArea;

                const cost =
                    traversalCost +
                    intersectionCost *
                        (leftProbability * leftTriangles.length +
                            rightProbability * rightTriangles.length);

                if (cost < bestCost) {
                    bestCost = cost;
                    bestAxis = axis as 0 | 1 | 2;
                    bestPosition = splitPosition;
                }
            }
        }

        // Compare with cost of not splitting (making this a leaf)
        const leafCost = intersectionCost * triangleCount;

        if (bestCost >= leafCost) {
            return null; // Better to make this a leaf
        }

        return { axis: bestAxis, position: bestPosition, cost: bestCost };
    }

    private calculateBoundingBoxForTriangles(
        triangleIndices: number[]
    ): BoundingBox {
        if (triangleIndices.length === 0) {
            return { min: [0, 0, 0], max: [0, 0, 0] };
        }

        // Initialize with first triangle's first vertex
        const firstTriangle = this.triangles[triangleIndices[0]];
        const firstVertex = firstTriangle.v0;
        let minX = firstVertex[0],
            minY = firstVertex[1],
            minZ = firstVertex[2];
        let maxX = firstVertex[0],
            maxY = firstVertex[1],
            maxZ = firstVertex[2];

        // Check all vertices of specified triangles
        for (const triangleIndex of triangleIndices) {
            const triangle = this.triangles[triangleIndex];
            const vertices = [triangle.v0, triangle.v1, triangle.v2];

            for (const vertex of vertices) {
                minX = Math.min(minX, vertex[0]);
                minY = Math.min(minY, vertex[1]);
                minZ = Math.min(minZ, vertex[2]);

                maxX = Math.max(maxX, vertex[0]);
                maxY = Math.max(maxY, vertex[1]);
                maxZ = Math.max(maxZ, vertex[2]);
            }
        }

        return {
            min: [minX, minY, minZ],
            max: [maxX, maxY, maxZ],
        };
    }

    private splitNode(node: BVHNode): void {
        if (node.triangleIndices.length <= 1) {
            // Make it a leaf if it has 1 or fewer triangles
            node.isLeaf = true;
            return;
        }

        // Find the best split using Surface Area Heuristic
        const bestSplit = this.findBestSAHSplit(node);

        if (!bestSplit) {
            // Fallback to leaf if no good split found
            node.isLeaf = true;
            return;
        }

        // Partition triangles based on the best split
        const leftTriangles: number[] = [];
        const rightTriangles: number[] = [];

        for (const triangleIndex of node.triangleIndices) {
            const centroid = this.calculateTriangleCentroid(triangleIndex);
            if (centroid[bestSplit.axis] < bestSplit.position) {
                leftTriangles.push(triangleIndex);
            } else {
                rightTriangles.push(triangleIndex);
            }
        }

        // Ensure both sides have triangles (fallback to even split if needed)
        if (leftTriangles.length === 0 || rightTriangles.length === 0) {
            const mid = Math.floor(node.triangleIndices.length / 2);
            // Sort by centroid on the split axis for better spatial locality
            node.triangleIndices.sort((a, b) => {
                const centroidA = this.calculateTriangleCentroid(a);
                const centroidB = this.calculateTriangleCentroid(b);
                return centroidA[bestSplit.axis] - centroidB[bestSplit.axis];
            });

            leftTriangles.length = 0;
            rightTriangles.length = 0;
            leftTriangles.push(...node.triangleIndices.slice(0, mid));
            rightTriangles.push(...node.triangleIndices.slice(mid));
        }

        // Create child nodes
        node.leftChild = {
            boundingBox: this.calculateBoundingBoxForTriangles(leftTriangles),
            triangleIndices: leftTriangles,
            leftChild: null,
            rightChild: null,
            isLeaf: false,
            depth: node.depth + 1,
        };

        node.rightChild = {
            boundingBox: this.calculateBoundingBoxForTriangles(rightTriangles),
            triangleIndices: rightTriangles,
            leftChild: null,
            rightChild: null,
            isLeaf: false,
            depth: node.depth + 1,
        };

        // Clear triangle indices from internal node
        node.triangleIndices = [];

        // Recursively split child nodes
        this.splitNode(node.leftChild);
        this.splitNode(node.rightChild);
    }

    // Generate wireframe vertices for all leaf bounding box edges
    public getWireframeVertices(maxDepth: number = -1): Float32Array {
        if (!this.root) return new Float32Array(0);

        const allVertices: { position: Vec3; color: Vec3 }[] = [];

        // Traverse BVH and add bounding boxes of leaf nodes
        const nodesToVisit: BVHNode[] = [this.root];

        while (nodesToVisit.length > 0) {
            const currentNode = nodesToVisit.pop()!;
            if (maxDepth >= 0 && currentNode.depth > maxDepth) {
                continue; // Skip nodes deeper than maxDepth
            }

            const vertices = this.generateBoundingBoxVertices(
                currentNode.boundingBox
            );
            allVertices.push(
                ...vertices.map((vertex) => ({
                    position: vertex,
                    color: [
                        currentNode.depth / (this.stats?.maxDepth ?? 4),
                        0,
                        0,
                    ] as Vec3, // White color for bounding box edges
                }))
            );

            if (!currentNode.isLeaf) {
                if (currentNode.leftChild) {
                    nodesToVisit.push(currentNode.leftChild);
                }
                if (currentNode.rightChild) {
                    nodesToVisit.push(currentNode.rightChild);
                }
            }
        }

        this.wireframeVerticesCount = allVertices.length;
        return new Float32Array(
            allVertices.flatMap((v) => [
                v.position[0],
                v.position[1],
                v.position[2],
                v.color[0],
                v.color[1],
                v.color[2],
            ])
        );
    }

    private generateBoundingBoxVertices(bbox: BoundingBox): Vec3[] {
        const { min, max } = bbox;

        // Create the 8 corners of the bounding box
        const corners: Vec3[] = [
            [min[0], min[1], min[2]], // 0: min corner
            [max[0], min[1], min[2]], // 1: +X
            [max[0], max[1], min[2]], // 2: +X +Y
            [min[0], max[1], min[2]], // 3: +Y
            [min[0], min[1], max[2]], // 4: +Z
            [max[0], min[1], max[2]], // 5: +X +Z
            [max[0], max[1], max[2]], // 6: max corner
            [min[0], max[1], max[2]], // 7: +Y +Z
        ];

        // Scale up the box slightly to avoid z-fighting
        const scale = 1.01;
        for (let i = 0; i < corners.length; i++) {
            corners[i][0] = min[0] + (corners[i][0] - min[0]) * scale;
            corners[i][1] = min[1] + (corners[i][1] - min[1]) * scale;
            corners[i][2] = min[2] + (corners[i][2] - min[2]) * scale;
        }

        // Define the 12 edges of a cube (each edge as two vertex indices)
        const edges = [
            // Bottom face (Z = min)
            [0, 1],
            [1, 2],
            [2, 3],
            [3, 0],
            // Top face (Z = max)
            [4, 5],
            [5, 6],
            [6, 7],
            [7, 4],
            // Vertical edges
            [0, 4],
            [1, 5],
            [2, 6],
            [3, 7],
        ];

        // Convert edges to vertex array (2 vertices per edge, 3 components per vertex)
        const vertices: Vec3[] = [];

        for (const [start, end] of edges) {
            // Start vertex
            vertices.push(corners[start]);
            // End vertex
            vertices.push(corners[end]);
        }

        return vertices;
    }

    public getBVHStats() {
        return this.stats;
    }

    private collectBVHStats(
        node: BVHNode,
        depth: number
    ): {
        leafNodes: number;
        totalTriangles: number;
        totalNodes: number;
        maxDepth: number;
    } {
        const nodeStats = {
            totalNodes: 1,
            leafNodes: node.isLeaf ? 1 : 0,
            totalTriangles: node.isLeaf ? node.triangleIndices.length : 0,
            maxDepth: depth,
        };

        if (node.leftChild) {
            const childStats = this.collectBVHStats(node.leftChild, depth + 1);
            nodeStats.totalNodes += childStats.totalNodes;
            nodeStats.leafNodes += childStats.leafNodes;
            nodeStats.totalTriangles += childStats.totalTriangles;
            nodeStats.maxDepth = Math.max(
                nodeStats.maxDepth,
                childStats.maxDepth
            );
        }
        if (node.rightChild) {
            const childStats = this.collectBVHStats(node.rightChild, depth + 1);
            nodeStats.totalNodes += childStats.totalNodes;
            nodeStats.leafNodes += childStats.leafNodes;
            nodeStats.totalTriangles += childStats.totalTriangles;
            nodeStats.maxDepth = Math.max(
                nodeStats.maxDepth,
                childStats.maxDepth
            );
        }

        return nodeStats;
    }

    getWireframeVerticesCount() {
        return this.wireframeVerticesCount;
    }

    // Serialize BVH to linear arrays for GPU
    public serializeBVH(): {
        nodes: Float32Array;
        triangleIndices: Uint32Array;
    } {
        if (!this.root) {
            return {
                nodes: new Float32Array(0),
                triangleIndices: new Uint32Array(0),
            };
        }

        const nodeList: BVHNode[] = [];
        const triangleIndexList: number[] = [];

        // Flatten tree into linear array using depth-first traversal
        this.flattenBVH(this.root, nodeList, triangleIndexList);

        // Convert to GPU-friendly format
        // Each node: [minX, minY, minZ, padding, maxX, maxY, maxZ, leftChild/triangleStart, rightChild/triangleCount, isLeaf, padding, padding]
        const nodes = new Float32Array(nodeList.length * 12);

        let offset = 0;
        for (let i = 0; i < nodeList.length; i++) {
            const node = nodeList[i];

            // Bounding box
            nodes[offset++] = node.boundingBox.min[0];
            nodes[offset++] = node.boundingBox.min[1];
            nodes[offset++] = node.boundingBox.min[2];
            nodes[offset++] = 0.0; // padding
            nodes[offset++] = node.boundingBox.max[0];
            nodes[offset++] = node.boundingBox.max[1];
            nodes[offset++] = node.boundingBox.max[2];
            // nodes[offset++] = 0.0; // padding

            if (node.isLeaf) {
                // For leaf nodes: triangleStart, triangleCount
                const triangleStart = (node as any).triangleStart || 0;
                const triangleCount = node.triangleIndices.length;
                nodes[offset++] = triangleStart;
                nodes[offset++] = triangleCount;
                nodes[offset++] = 1.0; // isLeaf = true
            } else {
                // For internal nodes: leftChildIndex, rightChildIndex
                const leftIndex = (node as any).leftIndex || -1;
                const rightIndex = (node as any).rightIndex || -1;
                nodes[offset++] = leftIndex;
                nodes[offset++] = rightIndex;
                nodes[offset++] = 0.0; // isLeaf = false
            }
            nodes[offset++] = 0.0; // padding
            nodes[offset++] = 0.0; // padding
        }

        return {
            nodes,
            triangleIndices: new Uint32Array(triangleIndexList),
        };
    }

    private flattenBVH(
        node: BVHNode,
        nodeList: BVHNode[],
        triangleIndexList: number[]
    ): number {
        const currentIndex = nodeList.length;
        nodeList.push(node);

        if (node.isLeaf) {
            // Store triangle indices and set triangle start
            (node as any).triangleStart = triangleIndexList.length;
            for (const triIndex of node.triangleIndices) {
                triangleIndexList.push(triIndex);
            }
        } else {
            // Process children and store their indices
            if (node.leftChild) {
                const leftIndex = this.flattenBVH(
                    node.leftChild,
                    nodeList,
                    triangleIndexList
                );
                (node as any).leftIndex = leftIndex;
            }
            if (node.rightChild) {
                const rightIndex = this.flattenBVH(
                    node.rightChild,
                    nodeList,
                    triangleIndexList
                );
                (node as any).rightIndex = rightIndex;
            }
        }

        return currentIndex;
    }
}
