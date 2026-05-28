import * as d from 'typegpu/data';

export const CameraSchema = d.struct({
    position: d.vec3f,
    rotation: d.vec3f,
    fov: d.f32,
    nearPlane: d.f32,
    farPlane: d.f32,
});

export const UniformsSchema = d.struct({
    camera: CameraSchema,
    frameIndex: d.f32,
    resolution: d.vec2f,
    samplesPerPixel: d.f32,
    debugEnabled: d.f32,
});

export const SphereSchema = d.struct({
    center: d.vec3f,
    radius: d.f32,
    color: d.vec3f,
    smoothness: d.f32,
    emissionColor: d.vec3f,
    emissionStrength: d.f32,
    specularProbability: d.f32,
});

export const TriangleSchema = d.struct({
    v0: d.vec3f,
    v1: d.vec3f,
    v2: d.vec3f,
    color: d.vec3f,
    emissionColor: d.vec3f,
    emissionStrength: d.f32,
    smoothness: d.f32,
    specularProbability: d.f32,
});
