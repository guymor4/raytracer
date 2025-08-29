export interface Vec3 {
    0: number;
    1: number;
    2: number;
}

export namespace Vec3 {
    export function add(a: Vec3, b: Vec3): Vec3 {
        return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    }

    export function subtract(a: Vec3, b: Vec3): Vec3 {
        return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    }

    export function multiply(a: Vec3, b: Vec3): Vec3 {
        return [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
    }

    export function scale(v: Vec3, s: number): Vec3 {
        return [v[0] * s, v[1] * s, v[2] * s];
    }
}

export interface Camera {
    position: Vec3;
    rotation: Vec3;
    fov: number;
    nearPlane: number;
    farPlane: number;
}

type Material = {
    color: Vec3;
    emissionColor: Vec3;
    emissionStrength: number;
    smoothness: number;
    specularProbability: number;
};

export type Sphere = {
    center: Vec3;
    radius: number;
} & Material;

export type Triangle = {
    v0: Vec3;
    v1: Vec3;
    v2: Vec3;
} & Material;

export type Model = {
    path: string;
    position: Vec3;
    rotation: Vec3;
    scale: Vec3;
} & Material;

export type RawScene = {
    camera: Camera;
    spheres: Sphere[];
    triangles: Triangle[];
    models: Model[];
};

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
    depth: number; // Depth of the node in the BVH tree (for debugging purposes)
}
