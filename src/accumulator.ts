/// <reference types="@webgpu/types" />

export class Accumulator {
    private pipeline: GPURenderPipeline;
    private bindGroup: GPUBindGroup;

    private constructor(pipeline: GPURenderPipeline, bindGroup: GPUBindGroup) {
        this.pipeline = pipeline;
        this.bindGroup = bindGroup;
    }

    static async create(
        device: GPUDevice,
        resolution: { width: number; height: number },
        uniformsBuffer: GPUBuffer,
        intermediateTexture: GPUTexture,
        sampler: GPUSampler
    ): Promise<Accumulator> {
        const [commonCode, accumulatorCode] = await Promise.all([
            fetch('common.wgsl').then((r) => r.text()),
            fetch('accumulator.wgsl').then((r) => r.text()),
        ]);

        const shaderModule = device.createShaderModule({
            code: commonCode + '\n' + accumulatorCode,
        });

        const pipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: shaderModule, entryPoint: 'vs_main' },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
            },
            primitive: { topology: 'triangle-list' },
        });

        const textureDesc = {
            size: [resolution.width, resolution.height] as [number, number],
            format: 'r32float' as GPUTextureFormat,
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        };
        const rTexture = device.createTexture(textureDesc);
        const gTexture = device.createTexture(textureDesc);
        const bTexture = device.createTexture(textureDesc);

        const bindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: uniformsBuffer } },
                { binding: 1, resource: intermediateTexture.createView() },
                { binding: 2, resource: sampler },
                { binding: 3, resource: rTexture.createView() },
                { binding: 4, resource: gTexture.createView() },
                { binding: 5, resource: bTexture.createView() },
            ],
        });

        return new Accumulator(pipeline, bindGroup);
    }

    render(commandEncoder: GPUCommandEncoder, canvasView: GPUTextureView): void {
        const pass = commandEncoder.beginRenderPass({
            colorAttachments: [
                {
                    view: canvasView,
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
        });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.draw(6);
        pass.end();
    }
}
