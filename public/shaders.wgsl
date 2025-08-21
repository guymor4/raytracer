struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

// Vertex shader for a fullscreen quad
@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var pos = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>( 1.0,  1.0),
        vec2<f32>(-1.0,  1.0)
    );
    
    var uv = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 0.0)
    );
    
    var output: VertexOutput;
    output.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
    output.uv = uv[vertexIndex];
    return output;
}

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

// Shader bindings
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> spheres: array<Sphere>;
@group(0) @binding(2) var<storage, read> planes: array<Plane>;
@group(0) @binding(3) var accumulationR: texture_storage_2d<r32float, read_write>;
@group(0) @binding(4) var accumulationG: texture_storage_2d<r32float, read_write>;
@group(0) @binding(5) var accumulationB: texture_storage_2d<r32float, read_write>;

const PI: f32 = 3.14159265358979323846;

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

// Calculates intersection of a ray with a plane
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

fn rand_f(state: ptr<function, u32>) -> f32 {
    *state = *state * 747796405u + 2891336453u;
    let word = ((*state >> ((*state >> 28u) + 4u)) ^ *state) * 277803737u;
    return f32((word >> 22u) ^ word) * bitcast<f32>(0x2f800004u);
}

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

fn ray_all(ray: Ray) -> HitInfo {
   var closest_hit = HitInfo(-1, vec3<f32>(), vec3<f32>(), vec3<f32>());

   // Check sphere intersections
   for (var i = 0u; i < arrayLength(&spheres); i++) {
       let hit_info = ray_sphere_intersect(ray, spheres[i]);
       if (hit_info.t > 0.0 && (closest_hit.t < 0 || hit_info.t < closest_hit.t)) {
           closest_hit = hit_info;
       }
   }

   // Check plane intersections
   for (var i = 0u; i < arrayLength(&planes); i++) {
       let hit_info = ray_plane_intersect(ray, planes[i]);
       if (hit_info.t > 0.0 && (closest_hit.t < 0 || hit_info.t < closest_hit.t)) {
           closest_hit = hit_info;
       }
   }

    return closest_hit;
}

fn ray_trace(ray: Ray, maxBounceCount: u32, state: ptr<function, u32>) -> vec3<f32> {
    var sky_color = vec3<f32>(1.0, 1.0, 1.0) * 0.4;
    var color: vec3<f32> = vec3<f32>(1, 1, 1);
    var light: vec3<f32> = vec3<f32>(0, 0, 0);

    var current_ray = ray;
    for (var i = 0u; i < maxBounceCount; i++) {
        var hit_info = ray_all(current_ray);
        if (hit_info.t < 0.0) {
            // No hit, environment color and light
            light += sky_color * color; // Sky color
            break;
        }

        // Hit detected, accumulate light and color
        light += hit_info.emission * color;
        color *= hit_info.color;

        if (color.x < 0.001 && color.y < 0.001 && color.z < 0.001) {
            // If color is too dark, stop tracing
            break;
        }

        // Simple diffuse reflection
        let new_origin = current_ray.origin + current_ray.direction * hit_info.t + hit_info.normal * 0.01; // Offset to prevent self-intersection
        var hitNormal = hit_info.normal;
        if (dot(hitNormal, current_ray.direction) > 0.0) { hitNormal = -hitNormal; }
        let new_direction = sample_cosine_hemisphere(hitNormal, state);
        current_ray = Ray(new_origin, new_direction);
    }

    return light;
}

fn to_radians(d: f32) -> f32 { return d * 3.1415926535 / 180.0; }

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

fn wang_hash(s: u32) -> u32 {
    var ns = (s ^ 61u) ^ (s >> 16u);
    ns = ns * 9u;
    ns = ns ^ (ns >> 4u);
    ns = ns * 0x27d4eb2du;
    ns = ns ^ (ns >> 15u);
    return ns;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let resolution = vec2<f32>(1024.0, 768.0);
    let aspect = resolution.x / resolution.y;
    let coord = vec2<f32>(
        (input.uv.x * 2.0 - 1.0) * aspect,
        (1.0 - input.uv.y * 2.0)
    );


    // Simple rotation approach: yaw (Y) and pitch (X) only for now
    let rotation_rad = uniforms.camera.rotation * 3.14159 / 180.0;
    let yaw = rotation_rad.y;
    let pitch = rotation_rad.x;

    // Calculate forward vector from yaw and pitch
    let forward = rotate_yaw_pitch(vec3<f32>(0, 0, -1), yaw, pitch);

    // Calculate right vector (perpendicular to forward and world up)
    let world_up = vec3<f32>(0.0, 1.0, 0.0);
    let right = normalize(cross(forward, world_up));
    let up = cross(right, forward); // Calculate up vector

    let fov = uniforms.camera.fov * 3.14159 / 180.0;
    let focal_length = 1.0 / tan(fov * 0.5);

    let ray_dir = normalize(
        right * coord.x +
        up * coord.y +
        forward * focal_length
    );
    let ray = Ray(uniforms.camera.position, ray_dir);

    // Calculate pixel coordinates in the accumulation texture clamped to the resolution
    let pixelCoordRaw = vec2<i32>(i32(input.uv.x * resolution.x), i32(input.uv.y * resolution.y));
    let pixelCoord = clamp(pixelCoordRaw, vec2<i32>(0, 0), vec2<i32>(i32(resolution.x - 1), i32(resolution.y - 1)));

    // Initialize random state for sampling
    var seed: u32 = u32(pixelCoord.y) * u32(resolution.x) + u32(pixelCoord.x) + u32(uniforms.frameIndex) * 12345;
    var state: u32 = wang_hash(seed);

    let maxBounceCount: u32 = 6; // Maximum number of bounces for ray tracing
    let samples: u32 = 8; // Number of samples per pixel

    var totalColor = vec3<f32>(0.0, 0.0, 0.0);
    for (var i = 0u; i < samples; i++) {
        totalColor += ray_trace(ray, maxBounceCount, &state);
    }
    var color = totalColor / f32(samples);

    // Read back from accumulation textures or initialize to zero
    var storedColor: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
    // skip the read on the first frame
    if (uniforms.frameIndex > 0) {
        let storedR = textureLoad(accumulationR, pixelCoord).r;
        let storedG = textureLoad(accumulationG, pixelCoord).r;
        let storedB = textureLoad(accumulationB, pixelCoord).r;
        storedColor = vec3<f32>(storedR, storedG, storedB);
    }

    let weight = 1.0 / f32(uniforms.frameIndex + 1);
    // Combine previous frame with current frame. Weight the contributions to result in an average over all frames.
    let accumulatedColor = saturate(storedColor * (1 - weight) + color * weight);

    // Write to accumulation textures
    textureStore(accumulationR, pixelCoord, vec4<f32>(accumulatedColor.r, 0.0, 0.0, 0.0));
    textureStore(accumulationG, pixelCoord, vec4<f32>(accumulatedColor.g, 0.0, 0.0, 0.0));
    textureStore(accumulationB, pixelCoord, vec4<f32>(accumulatedColor.b, 0.0, 0.0, 0.0));
    return vec4<f32>(accumulatedColor, 1.0);
}