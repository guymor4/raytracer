// Frame accumulation shader - takes raytracer output and accumulates over time
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

// Accumulator bindings - raytracer output texture and accumulation textures
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var raytracerOutput: texture_2d<f32>;
@group(0) @binding(2) var textureSampler: sampler;
@group(0) @binding(3) var accumulationR: texture_storage_2d<r32float, read_write>;
@group(0) @binding(4) var accumulationG: texture_storage_2d<r32float, read_write>;
@group(0) @binding(5) var accumulationB: texture_storage_2d<r32float, read_write>;

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let resolution = vec2<f32>(1024.0, 768.0);
    
    // Sample the current frame from raytracer output
    let currentFrameColor = textureSample(raytracerOutput, textureSampler, input.uv).rgb;
    
    // Calculate pixel coordinates in the accumulation texture clamped to the resolution
    let pixelCoordRaw = vec2<i32>(i32(input.uv.x * resolution.x), i32(input.uv.y * resolution.y));
    let pixelCoord = clamp(pixelCoordRaw, vec2<i32>(0, 0), vec2<i32>(i32(resolution.x - 1), i32(resolution.y - 1)));

    // Read back from accumulation textures or initialize to zero
    var storedColor: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
    // Skip the read on the first frame to avoid uninitialized data
    if (uniforms.frameIndex > 0) {
        let storedR = textureLoad(accumulationR, pixelCoord).r;
        let storedG = textureLoad(accumulationG, pixelCoord).r;
        let storedB = textureLoad(accumulationB, pixelCoord).r;
        storedColor = vec3<f32>(storedR, storedG, storedB);
    }

    // Calculate blend weight for progressive accumulation
    let weight = 1.0 / f32(uniforms.frameIndex + 1);
    // Combine previous frame with current frame. Weight the contributions to result in an average over all frames.
    let accumulatedColor = saturate(storedColor * (1.0 - weight) + currentFrameColor * weight);

    // Write to accumulation textures
    textureStore(accumulationR, pixelCoord, vec4<f32>(accumulatedColor.r, 0.0, 0.0, 0.0));
    textureStore(accumulationG, pixelCoord, vec4<f32>(accumulatedColor.g, 0.0, 0.0, 0.0));
    textureStore(accumulationB, pixelCoord, vec4<f32>(accumulatedColor.b, 0.0, 0.0, 0.0));

    return vec4<f32>(accumulatedColor, 1.0);
}