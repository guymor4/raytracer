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
}

export interface Sphere {
    center: Vec3;
    radius: number;
    color: Vec3;
    emissionColor: Vec3;
    emissionStrength: number;
}

export interface Plane {
    position: Vec3;
    normal: Vec3;
    color: Vec3;
    emissionColor: Vec3;
    emissionStrength: number;
}

export interface Scene {
    camera: Camera;
    spheres: Sphere[];
    planes: Plane[];
}
