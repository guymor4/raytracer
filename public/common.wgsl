// Common structures and utilities

// Constants
const PI: f32 = 3.14159265358979323846;

// Data structures
struct Ray {
    origin: vec3<f32>,
    direction: vec3<f32>,
}

struct Sphere {
    center: vec3<f32>,
    radius: f32,
    color: vec3<f32>, 
    smoothness: f32,
    emissionColor: vec3<f32>,
    emissionStrength: f32,
    specularProbability: f32,
}

struct Triangle {
    v0: vec3<f32>,
    v1: vec3<f32>,
    v2: vec3<f32>,
//    normal: vec3<f32>,
    color: vec3<f32>,
    emissionColor: vec3<f32>,
    emissionStrength: f32,
    smoothness: f32,
    specularProbability: f32,
}

struct Camera {
    position: vec3<f32>,
    rotation: vec3<f32>,
    fov: f32,
    nearPlane: f32,
    farPlane: f32,
}

struct Uniforms {
    camera: Camera,
    frameIndex: f32,
    resolution: vec2<f32>,
    samplesPerPixel: f32,
}

struct HitInfo {
    t: f32,
    color: vec3<f32>,
    normal: vec3<f32>,
    emission: vec3<f32>,
    smoothness: f32,
    specularProbability: f32,
}

// Random number generation
fn rand_f(state: ptr<function, u32>) -> f32 {
    *state = *state * 747796405u + 2891336453u;
    let word = ((*state >> ((*state >> 28u) + 4u)) ^ *state) * 277803737u;
    return f32((word >> 22u) ^ word) * bitcast<f32>(0x2f800004u);
}

fn wang_hash(s: u32) -> u32 {
    var ns = (s ^ 61u) ^ (s >> 16u);
    ns = ns * 9u;
    ns = ns ^ (ns >> 4u);
    ns = ns * 0x27d4eb2du;
    ns = ns ^ (ns >> 15u);
    return ns;
}

// Math utilities
fn to_radians(d: f32) -> f32 { 
    return d * 3.1415926535 / 180.0; 
}

fn rotate_yaw_pitch(v: vec3<f32>, yaw: f32, pitch: f32) -> vec3<f32> {
    // Yaw around Y, then pitch around X. dir_world = R_y(yaw) * R_x(pitch) * v
    let cy = cos(yaw);  let sy = sin(yaw);
    let cx = cos(pitch);let sx = sin(pitch);

    // R_y * R_x (combined 3x3)
    let r0 = vec3<f32>( cy,      sy*sx,  sy*cx);
    let r1 = vec3<f32>( 0.0,     cx,    -sx   );
    let r2 = vec3<f32>(-sy,      cy*sx,  cy*cx);

    // Multiply matrix by vector
    return normalize(vec3<f32>(
        dot(r0, v),
        dot(r1, v),
        dot(r2, v)
    ));
}

// Sampling functions
fn sample_cosine_hemisphere(normal: vec3<f32>, state: ptr<function, u32>) -> vec3<f32> {
    // Generate two uniform random numbers
    let r1 = rand_f(state);
    let r2 = rand_f(state);

    // Cosine-weighted hemisphere sampling in tangent space
    let phi = 2.0 * PI * r1;
    let cos_theta = sqrt(r2);
    let sin_theta = sqrt(1.0 - r2);

    let local_dir = vec3<f32>(
        cos(phi) * sin_theta,
        cos_theta,
        sin(phi) * sin_theta
    );

    // Build an orthonormal basis around the normal
    let up = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(normal.y) > 0.99);
    let tangent = normalize(cross(up, normal));
    let bitangent = cross(normal, tangent);

    // Transform from local (tangent space) to world space
    return normalize(
        tangent * local_dir.x +
        normal  * local_dir.y +
        bitangent * local_dir.z
    );
}

// Ray-geometry intersection functions
fn ray_sphere_intersect(ray: Ray, sphere: Sphere) -> HitInfo {
    let oc = ray.origin - sphere.center;
    let a = dot(ray.direction, ray.direction);
    let b = 2.0 * dot(oc, ray.direction);
    let c = dot(oc, oc) - sphere.radius * sphere.radius;
    let discriminant = b * b - 4.0 * a * c;
    if (discriminant < 0.0) {
        return HitInfo(-1.0, vec3<f32>(), vec3<f32>(), vec3<f32>(), 0, 0);
    }

    let sqrt_discriminant = sqrt(discriminant);
    
    let t1 = (-b - sqrt_discriminant) / (2.0 * a);
    let t2 = (-b + sqrt_discriminant) / (2.0 * a);

    let color = sphere.color;
    let emission = sphere.emissionColor * sphere.emissionStrength;

    if (t1 > 0.01) {
        let hit_point = ray.origin + ray.direction * t1;
        let normal = normalize(hit_point - sphere.center);
        return HitInfo(t1, sphere.color, normal, emission, sphere.smoothness, sphere.specularProbability);
    }

    if (t2 > 0.01) {
        let hit_point = ray.origin + ray.direction * t2;
        let normal = normalize(hit_point - sphere.center);
        return HitInfo(t1, sphere.color, normal, emission, sphere.smoothness, sphere.specularProbability);
    }
    
    return HitInfo(-1.0, vec3<f32>(), vec3<f32>(), vec3<f32>(), 0, 0);
}

fn ray_triangle_intersect(ray: Ray, tri: Triangle) -> HitInfo {
    // Möller-Trumbore algorithm for ray-triangle intersection
    let edge01 = tri.v1 - tri.v0;
    let edge02 = tri.v2 - tri.v0;

    let h = cross(ray.direction, edge02);
    let a = dot(edge01, h);

    // Ray is parallel to triangle
    if (abs(a) < 0.0001) {
        return HitInfo(-1.0, vec3<f32>(), vec3<f32>(), vec3<f32>(), 0, 0);
    }

    let f = 1.0 / a;
    let s = ray.origin - tri.v0;
    let u = f * dot(s, h);
    if (u < 0.0 || u > 1.0) {
        return HitInfo(-1.0, vec3<f32>(), vec3<f32>(), vec3<f32>(), 0, 0);
    }

    let q = cross(s, edge01);
    let v = f * dot(ray.direction, q);
    if (v < 0.0 || u + v > 1.0) {
        return HitInfo(-1.0, vec3<f32>(), vec3<f32>(), vec3<f32>(), 0, 0);
    }

    let t = f * dot(edge02, q);
    if (t < 0.001) {
        return HitInfo(-1.0, vec3<f32>(), vec3<f32>(), vec3<f32>(), 0, 0);
    }

    // Calculate surface normal (counter-clockwise winding)
    let normal = normalize(cross(edge01, edge02));

    // Back-face culling
    if (dot(normal, ray.direction) > 0.0) {
        return HitInfo(-1.0, vec3<f32>(), vec3<f32>(), vec3<f32>(), 0, 0);
    }

    let emission = tri.emissionColor * tri.emissionStrength;
    return HitInfo(t, tri.color, normal, emission, tri.smoothness, tri.specularProbability);
}

// Approximate triangle normal intersection using a small sphere at the triangle's center + normal
fn ray_triangle_normal_intersect(ray: Ray, tri: Triangle) -> HitInfo {
    let triangleCenter = (tri.v0 + tri.v1 + tri.v2) / 3.0;
    let triangleNormal = normalize(cross(tri.v1 - tri.v0, tri.v2 - tri.v0));
    let normalSphereCenter = triangleCenter + triangleNormal * 0.2;
    return ray_sphere_intersect(ray, Sphere(normalSphereCenter, 0.1, triangleNormal, 0.0, vec3<f32>(), 0.0, 0.0) );
}