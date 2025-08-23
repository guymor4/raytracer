import { Triangle, BoundingBox, BVHNode, Vec3 } from './types.js';

export class BVH {
    private root: BVHNode | null = null;
    private triangles: Triangle[] = [];

    constructor(triangles: Triangle[]) {
        this.triangles = triangles;
        this.buildBVH();
    }

    private buildBVH(): void {
        if (this.triangles.length === 0) return;

        // Create indices for all triangles
        const triangleIndices = Array.from({ length: this.triangles.length }, (_, i) => i);
        
        // Calculate bounding box for all triangles
        const sceneBoundingBox = this.calculateSceneBoundingBox();
        
        // Create root node and split it
        this.root = {
            boundingBox: sceneBoundingBox,
            triangleIndices: triangleIndices,
            leftChild: null,
            rightChild: null,
            isLeaf: false
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
        let minX = firstVertex[0], minY = firstVertex[1], minZ = firstVertex[2];
        let maxX = firstVertex[0], maxY = firstVertex[1], maxZ = firstVertex[2];

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
            max: [maxX, maxY, maxZ]
        };
    }

    private calculateTriangleCentroid(triangleIndex: number): Vec3 {
        const triangle = this.triangles[triangleIndex];
        return [
            (triangle.v0[0] + triangle.v1[0] + triangle.v2[0]) / 3,
            (triangle.v0[1] + triangle.v1[1] + triangle.v2[1]) / 3,
            (triangle.v0[2] + triangle.v1[2] + triangle.v2[2]) / 3
        ];
    }

    private calculateBoundingBoxForTriangles(triangleIndices: number[]): BoundingBox {
        if (triangleIndices.length === 0) {
            return { min: [0, 0, 0], max: [0, 0, 0] };
        }

        // Initialize with first triangle's first vertex
        const firstTriangle = this.triangles[triangleIndices[0]];
        const firstVertex = firstTriangle.v0;
        let minX = firstVertex[0], minY = firstVertex[1], minZ = firstVertex[2];
        let maxX = firstVertex[0], maxY = firstVertex[1], maxZ = firstVertex[2];

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
            max: [maxX, maxY, maxZ]
        };
    }

    private splitNode(node: BVHNode): void {
        if (node.triangleIndices.length <= 1) {
            // Make it a leaf if it has 1 or fewer triangles
            node.isLeaf = true;
            return;
        }

        const bbox = node.boundingBox;
        const bboxSize = [
            bbox.max[0] - bbox.min[0],
            bbox.max[1] - bbox.min[1],
            bbox.max[2] - bbox.min[2]
        ];

        // Find the axis with the largest extent
        let splitAxis: 0 | 1 | 2 = 0;
        if (bboxSize[1] > bboxSize[0]) {
            splitAxis = 1;
        }
        if (bboxSize[2] > bboxSize[1]) {
            splitAxis = 2;
        }

        // Calculate split point (middle of the bounding box on the split axis)
        const splitPoint = bbox.min[splitAxis] + bboxSize[splitAxis] * 0.5;

        // Partition triangles based on their centroids
        const leftTriangles: number[] = [];
        const rightTriangles: number[] = [];

        for (const triangleIndex of node.triangleIndices) {
            const centroid = this.calculateTriangleCentroid(triangleIndex);
            if (centroid[splitAxis] < splitPoint) {
                leftTriangles.push(triangleIndex);
            } else {
                rightTriangles.push(triangleIndex);
            }
        }

        // If all triangles ended up on one side, split them evenly
        if (leftTriangles.length === 0 || rightTriangles.length === 0) {
            const mid = Math.floor(node.triangleIndices.length / 2);
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
            isLeaf: true
        };

        node.rightChild = {
            boundingBox: this.calculateBoundingBoxForTriangles(rightTriangles),
            triangleIndices: rightTriangles,
            leftChild: null,
            rightChild: null,
            isLeaf: true
        };

        // Clear triangle indices from internal node
        node.triangleIndices = [];
    }

    public getRoot(): BVHNode | null {
        return this.root;
    }

    public getBoundingBoxes(): BoundingBox[] {
        if (!this.root) {
            return [];
        }

        const boxes: BoundingBox[] = [];
        this.collectBoundingBoxes(this.root, boxes);

        return boxes;
    }

    private collectBoundingBoxes(node: BVHNode, boxes: BoundingBox[]): void {
        boxes.push(node.boundingBox);
        
        if (node.leftChild) {
            this.collectBoundingBoxes(node.leftChild, boxes);
        }
        if (node.rightChild) {
            this.collectBoundingBoxes(node.rightChild, boxes);
        }
    }

    // Generate wireframe vertices for all leaf bounding box edges
    public getWireframeVertices(): Float32Array {
        if (!this.root) return new Float32Array(0);
        
        const boundingBoxes = this.getBoundingBoxes();
        const allVertices: number[] = [];
        
        for (const bbox of boundingBoxes) {
            const vertices = this.generateBoundingBoxVertices(bbox);
            allVertices.push(...vertices);
        }

        console.log("BBs", boundingBoxes)
        return new Float32Array(allVertices);
    }

    private generateBoundingBoxVertices(bbox: BoundingBox): number[] {
        const { min, max } = bbox;
        
        // Create the 8 corners of the bounding box
        const corners = [
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
        const scale = 1.02;
        for (let i = 0; i < corners.length; i++) {
            corners[i][0] = min[0] + (corners[i][0] - min[0]) * scale;
            corners[i][1] = min[1] + (corners[i][1] - min[1]) * scale;
            corners[i][2] = min[2] + (corners[i][2] - min[2]) * scale;
        }
        
        // Define the 12 edges of a cube (each edge as two vertex indices)
        const edges = [
            // Bottom face (Z = min)
            [0, 1], [1, 2], [2, 3], [3, 0],
            // Top face (Z = max)
            [4, 5], [5, 6], [6, 7], [7, 4],
            // Vertical edges
            [0, 4], [1, 5], [2, 6], [3, 7]
        ];
        
        // Convert edges to vertex array (2 vertices per edge, 3 components per vertex)
        const vertices: number[] = [];
        
        for (const [start, end] of edges) {
            // Start vertex
            vertices.push(corners[start][0], corners[start][1], corners[start][2]);
            // End vertex
            vertices.push(corners[end][0], corners[end][1], corners[end][2]);
        }
        
        return vertices;
    }
    
    public getWireframeVertexCount(): number {
        if (!this.root) return 0;
        const boundingBoxes = this.getBoundingBoxes();
        return boundingBoxes.length * 24; // 12 edges × 2 vertices per edge × number of boxes
    }
}