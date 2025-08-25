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

    // Calculate view projection matrix
    let aspect = uniforms.resolution.x / uniforms.resolution.y;
    let view = makeViewMatrix(uniforms.camera.position, uniforms.camera.rotation);
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