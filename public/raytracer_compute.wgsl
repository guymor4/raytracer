// Compute raytracer - outputs to intermediate texture for accumulation
// common.wgsl is included separately and concatenated

// BVH Node structure
struct BVHNode {
    min_bounds: vec3<f32>,
    max_bounds: vec3<f32>,
    left_or_triangle_start: f32,  // leftChildIndex for internal nodes, triangleStart for leaves
    right_or_triangle_count: f32, // rightChildIndex for internal nodes, triangleCount for leaves
    is_leaf: f32,
}

// Bindings for compute shader
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> spheres: array<Sphere>;
@group(0) @binding(2) var<storage, read> triangles: array<Triangle>;
@group(0) @binding(3) var intermediate_texture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<storage, read> bvh_nodes: array<BVHNode>;
@group(0) @binding(5) var<storage, read> bvh_triangle_indices: array<u32>;

// BVH traversal for triangle intersections
fn ray_bvh_triangles(ray: Ray) -> HitInfo {
    var closest_hit = HitInfo(-1.0, vec3<f32>(), vec3<f32>(), vec3<f32>(), 0, 0);
    
    if (arrayLength(&bvh_nodes) == 0u) {
        return closest_hit;
    }
    
    // Stack for BVH traversal (max depth typical ~20-30)
    var stack: array<u32, 64>;
    var stack_ptr = 0u;
    var stack_size = 64u;
    stack[0] = 0u; // Start with root node
    stack_ptr = 1u;
    
    while (stack_ptr > 0u) {
        stack_ptr--;
        let node_index = stack[stack_ptr];
        if (node_index >= arrayLength(&bvh_nodes)) {
            continue;
        }
        
        let node = bvh_nodes[node_index];
        
        // Test ray against the bounding box
        if (!ray_aabb_intersect(ray, node.min_bounds, node.max_bounds)) {
            continue;
        }
        
        if (node.is_leaf > 0.5) {
            // Leaf node - test triangles
            let triangle_start = u32(node.left_or_triangle_start);
            let triangle_count = u32(node.right_or_triangle_count);
            
            // Bounds check triangle access
            let max_triangles = min(triangle_count, arrayLength(&bvh_triangle_indices) - triangle_start);
            for (var i = 0u; i < max_triangles; i++) {
                let triangle_index = bvh_triangle_indices[triangle_start + i];
                
                let hit_info = ray_triangle_intersect(ray, triangles[triangle_index]);
                if (hit_info.t > 0.0 && (closest_hit.t < 0.0 || hit_info.t < closest_hit.t)) {
                    closest_hit = hit_info;
                }
            }
        } else {
            // Internal node - add children to stack (add right first so left is processed first)
            let left_child = u32(node.left_or_triangle_start);
            let right_child = u32(node.right_or_triangle_count);
            
            // Add right child first (processed later)
            if (stack_ptr < stack_size - 1) {
                stack[stack_ptr] = right_child;
                stack_ptr++;
            }
            // Add left child second (processed first)
            if (stack_ptr < stack_size - 1) {
                stack[stack_ptr] = left_child;
                stack_ptr++;
            }
        }
    }
    
    return closest_hit;
}

fn ray_all(ray: Ray) -> HitInfo {
   var closest_hit = HitInfo(-1.0, vec3<f32>(), vec3<f32>(), vec3<f32>(), 0, 0);

   // Check sphere intersections
   for (var i = 0u; i < arrayLength(&spheres); i++) {
       let hit_info = ray_sphere_intersect(ray, spheres[i]);
       if (hit_info.t > 0.0 && (closest_hit.t < 0 || hit_info.t < closest_hit.t)) {
           closest_hit = hit_info;
       }
   }

   // Check triangle intersections using BVH
   let triangle_hit = ray_bvh_triangles(ray);
   if (triangle_hit.t > 0.0 && (closest_hit.t < 0 || triangle_hit.t < closest_hit.t)) {
       closest_hit = triangle_hit;
   }

    return closest_hit;
}

// Sample direct lighting from emissive triangles
fn sample_light_triangles(hit_point: vec3<f32>, state: ptr<function, u32>) -> LightSample {
    // First, count emissive triangles and calculate total emission power
    var total_power = 0.0;
    var light_count = 0u;

    for (var i = 0u; i < arrayLength(&triangles); i++) {
        if (triangles[i].emissionStrength <= 0.0) {
            continue;
        }

        let area = triangle_area(triangles[i]);
        let power = triangles[i].emissionStrength * area * luminance(triangles[i].emissionColor);
        total_power += power;
        light_count++;
    }

    if (light_count == 0u || total_power <= 0.0) {
        return LightSample(vec3<f32>(0.0), vec3<f32>(0.0), 0.0, 0.0);
    }

    // Select a light based on power distribution
    let random_power = rand_f(state) * total_power;
    var accumulated_power = 0.0;
    var selected_triangle: Triangle;
    var found = false;

    for (var i = 0u; i < arrayLength(&triangles); i++) {
        if (triangles[i].emissionStrength > 0.0) {
            let area = triangle_area(triangles[i]);
            let power = triangles[i].emissionStrength * area * luminance(triangles[i].emissionColor);
            accumulated_power += power;

            if (accumulated_power >= random_power && !found) {
                selected_triangle = triangles[i];
                found = true;
            }
        }
    }

    // Sample a point on the selected triangle
    let light_point = sample_triangle_point(selected_triangle, state);
    let light_direction = light_point - hit_point;
    let distance = length(light_direction);
    let normalized_direction = light_direction / distance;

    // Calculate triangle normal
    let edge1 = selected_triangle.v1 - selected_triangle.v0;
    let edge2 = selected_triangle.v2 - selected_triangle.v0;
    let light_normal = normalize(cross(edge1, edge2));

    // Check if light is facing the hit point
    let cos_light = -dot(light_normal, normalized_direction);
    if (cos_light <= 0.0) {
        return LightSample(vec3<f32>(0.0), vec3<f32>(0.0), 0.0, 0.0);
    }

    // Calculate PDF: (distance^2) / (area * cos_theta) * (power / total_power) <- pribability of selecting this light
    let area = triangle_area(selected_triangle);
    let power = selected_triangle.emissionStrength * area * luminance(selected_triangle.emissionColor);
    var pdf = (distance * distance) / (area * cos_light) * (power / total_power);


    let emission = selected_triangle.emissionColor * selected_triangle.emissionStrength;

    return LightSample(normalized_direction, emission, distance, pdf);
}

// Sample direct lighting from emissive spheres
fn sample_light_spheres(hit_point: vec3<f32>, state: ptr<function, u32>) -> LightSample {
    // Count emissive spheres
    var light_count = 0u;
    for (var i = 0u; i < arrayLength(&spheres); i++) {
        if (spheres[i].emissionStrength > 0.0) {
            light_count++;
        }
    }

    if (light_count == 0u) {
        return LightSample(vec3<f32>(0.0), vec3<f32>(0.0), 0.0, 0.0);
    }

    // Select a random emissive sphere
    let random_sphere_index = u32(rand_f(state) * f32(light_count));
    var current_index = 0u;
    var selected_sphere: Sphere;

    for (var i = 0u; i < arrayLength(&spheres); i++) {
        if (spheres[i].emissionStrength > 0.0) {
            if (current_index == random_sphere_index) {
                selected_sphere = spheres[i];
                break;
            }
            current_index++;
        }
    }

    // Sample a point on the sphere surface
    let to_center = selected_sphere.center - hit_point;
    let distance_to_center = length(to_center);

    // If we're inside the sphere, return no contribution
    if (distance_to_center <= selected_sphere.radius) {
        return LightSample(vec3<f32>(0.0), vec3<f32>(0.0), 0.0, 0.0);
    }

    // Sample direction towards sphere
    let center_direction = to_center / distance_to_center;

    // Create coordinate system around center direction
    let up = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(center_direction.y) > 0.99);
    let right = normalize(cross(up, center_direction));
    let forward = cross(center_direction, right);

    // Sample cone around center direction
    let cos_theta_max = sqrt(1.0 - (selected_sphere.radius * selected_sphere.radius) / (distance_to_center * distance_to_center));
    let cos_theta = 1.0 - rand_f(state) * (1.0 - cos_theta_max);
    let sin_theta = sqrt(1.0 - cos_theta * cos_theta);
    let phi = 2.0 * PI * rand_f(state);

    let sample_direction = normalize(
        center_direction * cos_theta +
        right * (sin_theta * cos(phi)) +
        forward * (sin_theta * sin(phi))
    );

    let pdf = 1.0 / (2.0 * PI * (1.0 - cos_theta_max) * f32(light_count));
    let emission = selected_sphere.emissionColor * selected_sphere.emissionStrength;

    return LightSample(sample_direction, emission, distance_to_center - selected_sphere.radius, pdf);
}

// Balance heuristic for Multiple Importance Sampling
fn power_heuristic(pdf_a: f32, pdf_b: f32) -> f32 {
    let a = pdf_a * pdf_a;
    let b = pdf_b * pdf_b;
    return a / (a + b);
}

// Calculate BRDF PDF for a given direction
fn brdf_pdf(hit_normal: vec3<f32>, direction: vec3<f32>) -> f32 {
    let cos_theta = dot(hit_normal, direction);
    if (cos_theta <= 0.0) {
        return 0.0;
    }
    return cos_theta / PI; // Lambertian BRDF PDF
}

fn ray_trace(ray: Ray, maxBounceCount: u32, state: ptr<function, u32>) -> vec3<f32> {
    var sky_color = vec3<f32>(1.0, 1.0, 1.0) * 0.4;
    var color: vec3<f32> = vec3<f32>(1, 1, 1);
    var light: vec3<f32> = vec3<f32>(0, 0, 0);
    var is_specular_bounce = false; // Track if the last bounce was specular

    var current_ray = ray;
    for (var i = 0u; i < maxBounceCount; i++) {
        var hit_info = ray_all(current_ray);
        if (hit_info.t < 0.0) {
            // No hit, environment color and light
            light += sky_color * color; // Sky color
            break;
        }

        let hit_point = current_ray.origin + current_ray.direction * hit_info.t;

        // ***********
        // TODO this function currently samples both triangle and sphere lights every time, it should pick at random to be more efficient
        // ***********

        // Multiple Importance Sampling: Sample lights directly with MIS weight
        let triangle_sample = sample_light_triangles(hit_point, state);
        if (triangle_sample.pdf > 0.0) {
            let cos_theta = dot(hit_info.normal, triangle_sample.direction);
            if (cos_theta > 0.0) {
                let shadow_ray = Ray(hit_point + hit_info.normal * 0.01, triangle_sample.direction);
                let shadow_hit = ray_all(shadow_ray);

                // If no occlusion or occlusion is beyond the light distance
                if (shadow_hit.t < 0.0 || shadow_hit.t > triangle_sample.distance - 0.1) {
                    let brdf_pdf_val = brdf_pdf(hit_info.normal, triangle_sample.direction);
                    let mis_weight = power_heuristic(triangle_sample.pdf, brdf_pdf_val);
                    let brdf = cos_theta / PI;
                    light += triangle_sample.emission * brdf * color * mis_weight / triangle_sample.pdf;
                }
            }
        }
        // TODO implement sphere light sampling with MIS as well (use sample_light_spheres() function)
        
        // Add emission from current hit with MIS weight for BRDF sampling
        // NOTE we only do this for primary rays or specular bounces (because specular can't hit lights via direct sampling)
        let is_primary_ray = (i == 0u);
        let is_emissive = hit_info.emission.x + hit_info.emission.y + hit_info.emission.z > 0.01;
        if ((is_primary_ray && is_emissive) || is_specular_bounce) {
            // This represents BRDF sampling hitting a light
            // We need to calculate what the light sampling PDF would have been
            // For now, use a simplified approach - full emission for non-primary rays
            let incoming_dir = -normalize(current_ray.direction);
            let brdf_pdf_val = brdf_pdf(hit_info.normal, incoming_dir);
            // Simplified: assume light PDF is small, so BRDF sampling gets most weight
            let light_pdf_estimate = 0.001; // Very small to favor BRDF sampling
            let mis_weight = power_heuristic(brdf_pdf_val, light_pdf_estimate);
            light += hit_info.emission * color * mis_weight;
        }
        
        // Update color for next bounce
        color *= hit_info.color;

        // If color is too dark, stop tracing
        // Note it's color here, not light - we only want to stop if the surface is very dark
        if (color.x + color.y + color.z < 0.01) {
            break;
        }

        // Russian roulette termination
        // After 3 bounces, probabilistically terminate the path to get performance boost while keeping it unbiased
        if (i >= 3u) {
            let luminance = luminance(color);
            var p = clamp(luminance, 0.05, 0.95);

            if (rand_f(state) > p) {
                break; // kill path
            }
            color /= p; // keep unbiased
        }

        // Continue with BRDF sampling for indirect lighting
        is_specular_bounce = hit_info.specularProbability >= rand_f(state);

        let diffuseDir = sample_cosine_hemisphere(hit_info.normal, state);
        let specularDir = reflect(current_ray.direction, hit_info.normal);
        let new_direction = normalize(mix(diffuseDir, specularDir, select(0, hit_info.smoothness, is_specular_bounce)));

        let new_origin = current_ray.origin + current_ray.direction * hit_info.t + hit_info.normal * 0.01;
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
    var color = totalColor / f32(uniforms.samplesPerPixel);

    // Write to intermediate texture
    textureStore(intermediate_texture, pixel_coords, vec4<f32>(color, 1.0));
}