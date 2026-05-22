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
    let currentFrameColor = textureSample(raytracerOutput, textureSampler, input.uv).rgb;

    let pixelCoordRaw = vec2<i32>(i32(input.uv.x * uniforms.resolution.x), i32(input.uv.y * uniforms.resolution.y));
    let pixelCoord = clamp(pixelCoordRaw, vec2<i32>(0, 0), vec2<i32>(i32(uniforms.resolution.x - 1), i32(uniforms.resolution.y - 1)));

    var storedColor = vec3<f32>(0.0);
    if (uniforms.frameIndex > 0) {
        storedColor = vec3<f32>(
            textureLoad(accumulationR, pixelCoord).r,
            textureLoad(accumulationG, pixelCoord).r,
            textureLoad(accumulationB, pixelCoord).r,
        );
    }

    let weight = 1.0 / f32(uniforms.frameIndex + 1);
    let accumulatedColor = saturate(storedColor * (1.0 - weight) + currentFrameColor * weight);

    textureStore(accumulationR, pixelCoord, vec4<f32>(accumulatedColor.r, 0.0, 0.0, 0.0));
    textureStore(accumulationG, pixelCoord, vec4<f32>(accumulatedColor.g, 0.0, 0.0, 0.0));
    textureStore(accumulationB, pixelCoord, vec4<f32>(accumulatedColor.b, 0.0, 0.0, 0.0));

    return vec4<f32>(accumulatedColor, 1.0);
}