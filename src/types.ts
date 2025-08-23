export interface Vec3 {
    0: number;
    1: number;
    2: number;
}

export interface Camera {
    position: Vec3;
    rotation: Vec3;
    fov: number;
    nearPlane: number;
    farPlane: number;
}

export interface Uniforms {
    camera: Camera;
    frameIndex: number;
    samples: number;
}

export interface Sphere {
    center: Vec3;
    radius: number;
    color: Vec3;
    emissionColor: Vec3;
    emissionStrength: number;
    smoothness: number;
    specularProbability: number;
}

export interface Triangle {
    v0: Vec3;
    v1: Vec3;
    v2: Vec3;
    color: Vec3;
    emissionColor: Vec3;
    emissionStrength: number;
    smoothness: number;
    specularProbability: number;
}

export interface Scene {
    camera: Camera;
    spheres: Sphere[];
    triangles: Triangle[];
}

// BVH (Bounding Volume Hierarchy) structures
export interface BoundingBox {
    min: Vec3;
    max: Vec3;
}

export interface BVHNode {
    boundingBox: BoundingBox;
    triangleIndices: number[]; // Indices of triangles in this node
    leftChild: BVHNode | null;
    rightChild: BVHNode | null;
    isLeaf: boolean;
}
