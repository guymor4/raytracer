// Debug wireframe shader for rendering bounding boxes

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) color: vec3<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec3<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;

    // Match the raytracer's camera calculation exactly
    let aspect = uniforms.resolution.x / uniforms.resolution.y;
    
    // Use same rotation approach as raytracer
    let rotation_rad = uniforms.camera.rotation * 3.14159 / 180.0;
    let yaw = rotation_rad.y;
    let pitch = rotation_rad.x;
    
    // Calculate forward vector from yaw and pitch (same as raytracer)
    let forward = rotate_yaw_pitch(vec3<f32>(0, 0, -1), yaw, pitch);
    
    // Calculate right vector (perpendicular to forward and world up)
    let world_up = vec3<f32>(0.0, 1.0, 0.0);
    let right = normalize(cross(forward, world_up));
    let up = cross(right, forward);
    
    // Build view matrix manually using same vectors as raytracer
    let view = mat4x4<f32>(
        vec4<f32>(right.x, up.x, -forward.x, 0.0),
        vec4<f32>(right.y, up.y, -forward.y, 0.0),
        vec4<f32>(right.z, up.z, -forward.z, 0.0),
        vec4<f32>(-dot(right, uniforms.camera.position), -dot(up, uniforms.camera.position), dot(forward, uniforms.camera.position), 1.0)
    );
    
    let proj = makePerspective(uniforms.camera.fov, aspect, uniforms.camera.nearPlane, uniforms.camera.farPlane);

    let worldPos = vec4<f32>(input.position, 1.0);
    out.position = proj * view * worldPos;

    out.color = input.color;

    return out;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    return vec4<f32>(input.color, 1.0);
}