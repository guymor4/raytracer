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
