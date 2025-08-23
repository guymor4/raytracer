// Compute raytracer - outputs to intermediate texture for accumulation
// common.wgsl is included separately and concatenated

// Bindings for compute shader
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> spheres: array<Sphere>;
@group(0) @binding(2) var<storage, read> triangles: array<Triangle>;
@group(0) @binding(3) var intermediate_texture: texture_storage_2d<rgba16float, write>;

fn ray_all(ray: Ray) -> HitInfo {
   var closest_hit = HitInfo(-1.0, vec3<f32>(), vec3<f32>(), vec3<f32>(), 0, 0);

   // Check sphere intersections
   for (var i = 0u; i < arrayLength(&spheres); i++) {
       let hit_info = ray_sphere_intersect(ray, spheres[i]);
       if (hit_info.t > 0.0 && (closest_hit.t < 0 || hit_info.t < closest_hit.t)) {
           closest_hit = hit_info;
       }
   }

   // Check triangle intersections
   for (var i = 0u; i < arrayLength(&triangles); i++) {
       let hit_info = ray_triangle_intersect(ray, triangles[i]);
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

        // If color is too dark, stop tracing
        if (color.x + color.y + color.z < 0.01) {
            break;
        }

        // Simple diffuse reflection
        let new_origin = current_ray.origin + current_ray.direction * hit_info.t + hit_info.normal * 0.01; // Offset to prevent self-intersection
        var hitNormal = hit_info.normal;

        let diffuseDir = sample_cosine_hemisphere(hitNormal, state);

        let isSpecularBounce = hit_info.specularProbability >= rand_f(state);
        let specularDir = reflect(current_ray.direction, hitNormal);

        let new_direction = normalize(mix(diffuseDir, specularDir, select(0, hit_info.smoothness, isSpecularBounce)));
        current_ray = Ray(new_origin, new_direction);
    }

    return light;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let pixel_coords = vec2<i32>(global_id.xy);
    let resolution = vec2<i32>(uniforms.resolution);
    
    // Check bounds
    if (pixel_coords.x >= resolution.x || pixel_coords.y >= resolution.y) {
        return;
    }

    let aspect = uniforms.resolution.x / uniforms.resolution.y;

    // Calculate UV coordinates
    let uv = vec2<f32>(
        (f32(pixel_coords.x) + 0.5) / uniforms.resolution.x,
        (f32(pixel_coords.y) + 0.5) / uniforms.resolution.y
    );

    // Initialize random state for sampling
    var seed: u32 = u32(pixel_coords.y) * u32(uniforms.resolution.x) + u32(pixel_coords.x) + u32(uniforms.frameIndex) * 12345;
    var state: u32 = wang_hash(seed);

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

    // Generate a random offset for anti aliasing (half pixel jitter)
    var offset = vec2<f32>(rand_f(&state) - 0.5, rand_f(&state) - 0.5) / uniforms.resolution;
    let coord = vec2<f32>(
        ((uv.x + offset.x) * 2.0 - 1.0) * aspect,
        (1.0 - (uv.y + offset.y) * 2.0)
    );
    let ray_dir = normalize(
        right * coord.x +
        up * coord.y +
        forward * focal_length
    );
    let ray = Ray(uniforms.camera.position, ray_dir);

    let maxBounceCount: u32 = 6; // Maximum number of bounces for ray tracing

    var totalColor = vec3<f32>(0.0, 0.0, 0.0);
    for (var i = 0u; i < u32(uniforms.samplesPerPixel); i++) {
        totalColor += ray_trace(ray, maxBounceCount, &state);
    }
    let color = totalColor / f32(uniforms.samplesPerPixel);

    // Write to intermediate texture
    textureStore(intermediate_texture, pixel_coords, vec4<f32>(color, 1.0));
}