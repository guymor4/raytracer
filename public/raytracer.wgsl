// Pure raytracing shader - outputs raw raytraced color to intermediate texture
// common.wgsl is included separately and concatenated

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

// Raytracer bindings - only geometry data, no accumulation textures
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> spheres: array<Sphere>;
@group(0) @binding(2) var<storage, read> triangles: array<Triangle>;

fn ray_all(ray: Ray) -> HitInfo {
   var closest_hit = HitInfo(-1.0, vec3<f32>(), vec3<f32>(), vec3<f32>(), 0);

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

        if (color.x < 0.001 && color.y < 0.001 && color.z < 0.001) {
            // If color is too dark, stop tracing
            break;
        }

        // Simple diffuse reflection
        let new_origin = current_ray.origin + current_ray.direction * hit_info.t + hit_info.normal * 0.01; // Offset to prevent self-intersection
        var hitNormal = hit_info.normal;
        if (dot(hitNormal, current_ray.direction) > 0.0) {
            hitNormal = -hitNormal;
        }

        let diffuseDir = sample_cosine_hemisphere(hitNormal, state);
        let specularDir = reflect(current_ray.direction, hitNormal);
        let new_direction = mix(diffuseDir, specularDir, hit_info.smoothness);
        current_ray = Ray(new_origin, new_direction);
    }

    return light;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let aspect = uniforms.resolution.x / uniforms.resolution.y;

    // Calculate pixel coordinates for random seeding
    let pixelCoordRaw = vec2<i32>(i32(input.uv.x * uniforms.resolution.x), i32(input.uv.y * uniforms.resolution.y));
    let pixelCoord = clamp(pixelCoordRaw, vec2<i32>(0, 0), vec2<i32>(i32(uniforms.resolution.x - 1), i32(uniforms.resolution.y - 1)));

    // Initialize random state for sampling
    var seed: u32 = u32(pixelCoord.y) * u32(uniforms.resolution.x) + u32(pixelCoord.x) + u32(uniforms.frameIndex) * 12345;
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
        ((input.uv.x + offset.x) * 2.0 - 1.0) * aspect,
        (1.0 - (input.uv.y + offset.y) * 2.0)
    );
    let ray_dir = normalize(
        right * coord.x +
        up * coord.y +
        forward * focal_length
    );
    let ray = Ray(uniforms.camera.position, ray_dir);


    let maxBounceCount: u32 = 6; // Maximum number of bounces for ray tracing
    let samples: u32 = 1; // Number of samples per pixel

    var totalColor = vec3<f32>(0.0, 0.0, 0.0);
    for (var i = 0u; i < samples; i++) {
        totalColor += ray_trace(ray, maxBounceCount, &state);
    }
    let color = totalColor / f32(samples);

    // Output raw raytraced color (no accumulation)
    return vec4<f32>(color, 1.0);
}