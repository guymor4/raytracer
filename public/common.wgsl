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
    padding1: f32,
    emissionColor: vec3<f32>,
    emissionStrength: f32,
    padding: vec4<f32>, // 16 bytes padding to make total 64 bytes
}

struct Plane {
    position: vec3<f32>,
    padding1: f32,
    normal: vec3<f32>,
    padding2: f32,
    color: vec3<f32>,
    padding3: f32,
    emissionColor: vec3<f32>,
    emissionStrength: f32,
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
}

struct HitInfo {
    t: f32,
    color: vec3<f32>,
    normal: vec3<f32>,
    emission: vec3<f32>,
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
        return HitInfo(-1.0, vec3<f32>(), vec3<f32>(), vec3<f32>());
    }

    let sqrt_discriminant = sqrt(discriminant);
    
    let t1 = (-b - sqrt_discriminant) / (2.0 * a);
    let t2 = (-b + sqrt_discriminant) / (2.0 * a);
    
    if (t1 > 0.01) {
        let hit_point = ray.origin + ray.direction * t1;
        let normal = normalize(hit_point - sphere.center);
        let emission = sphere.emissionColor * sphere.emissionStrength;
        return HitInfo(t1, sphere.color, normal, emission);
    } else if (t2 > 0.01) {
        let hit_point = ray.origin + ray.direction * t2;
        let normal = normalize(hit_point - sphere.center);
        let emission = sphere.emissionColor * sphere.emissionStrength;
        return HitInfo(t2, sphere.color, normal, emission);
    }
    
    return HitInfo(-1.0, vec3<f32>(), vec3<f32>(), vec3<f32>());
}

fn ray_plane_intersect(ray: Ray, plane: Plane) -> HitInfo {
    let denom = dot(plane.normal, ray.direction);
    if (abs(denom) < 0.001) {
        return HitInfo(-1.0, vec3<f32>(), vec3<f32>(), vec3<f32>()); // Ray is parallel to the plane
    }

    let t = dot(plane.position - ray.origin, plane.normal) / denom;
    if (t < 0.001) {
        return HitInfo(-1.0, vec3<f32>(), vec3<f32>(), vec3<f32>()); // Intersection behind the ray origin
    }
    var hit_point = ray.origin + ray.direction * t;

    var hit_color: vec3<f32> = plane.color;
    let emission = plane.emissionColor * plane.emissionStrength;
    return HitInfo(
        t,
        hit_color,
        plane.normal,
        emission
    );
}