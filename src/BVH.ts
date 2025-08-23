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
        
        // Create root node with all triangles (for now, just a single node)
        this.root = {
            boundingBox: sceneBoundingBox,
            triangleIndices: triangleIndices,
            leftChild: null,
            rightChild: null,
            isLeaf: true
        };

        console.log('BVH created with single root node:');
        console.log(`- Bounding box: min(${sceneBoundingBox.min[0]}, ${sceneBoundingBox.min[1]}, ${sceneBoundingBox.min[2]}) max(${sceneBoundingBox.max[0]}, ${sceneBoundingBox.max[1]}, ${sceneBoundingBox.max[2]})`);
        console.log(`- Triangle count: ${this.triangles.length}`);
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

    public getRoot(): BVHNode | null {
        return this.root;
    }

    public getBoundingBoxes(): BoundingBox[] {
        const boxes: BoundingBox[] = [];
        if (this.root) {
            this.collectBoundingBoxes(this.root, boxes);
        }
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

    // Generate wireframe vertices for bounding box edges
    public getWireframeVertices(): Float32Array {
        if (!this.root) return new Float32Array(0);
        
        const bbox = this.root.boundingBox;
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
        const vertices = new Float32Array(edges.length * 2 * 3);
        let vertexIndex = 0;
        
        for (const [start, end] of edges) {
            // Start vertex
            vertices[vertexIndex++] = corners[start][0];
            vertices[vertexIndex++] = corners[start][1];
            vertices[vertexIndex++] = corners[start][2];
            
            // End vertex
            vertices[vertexIndex++] = corners[end][0];
            vertices[vertexIndex++] = corners[end][1];
            vertices[vertexIndex++] = corners[end][2];
        }
        
        return vertices;
    }
    
    public getWireframeVertexCount(): number {
        return this.root ? 24 : 0; // 12 edges × 2 vertices per edge
    }
}