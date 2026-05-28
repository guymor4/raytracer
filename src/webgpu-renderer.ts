/// <reference types="@webgpu/types" />
import tgpu from 'typegpu';
import * as d from 'typegpu/data';
import type { TgpuRoot, TgpuBuffer } from 'typegpu';
import { FPSCounter } from './fps-counter';
import { Scene } from './types';
import * as Common from './common';
import { RethrownError } from './common';
import { Accumulator } from './accumulator';
import {
    UniformsSchema,
    SphereSchema,
    TriangleSchema,
} from './gpu-schemas';

function vec3(v: { 0: number; 1: number; 2: number }): [number, number, number] {
    return [v[0], v[1], v[2]];
}

export class WebGPURenderer {
    private canvas: HTMLCanvasElement;
    private context: GPUCanvasContext | null = null;
    private device: GPUDevice | null = null;
    private root: TgpuRoot | null = null;
    private raytracerComputePipeline: GPUComputePipeline | null = null;
    private resolution: { width: number; height: number };
    private uniformsBuffer: TgpuBuffer<typeof UniformsSchema> | null = null;
    private spheresBuffer: TgpuBuffer<d.WgslArray<typeof SphereSchema>> | null = null;
    private trianglesBuffer: TgpuBuffer<d.WgslArray<typeof TriangleSchema>> | null = null;
    private performanceCountersBuffer: GPUBuffer | null = null;
    private raytracerComputeBindGroup: GPUBindGroup | null = null;
    private intermediateTexture: GPUTexture | null = null;
    private textureSampler: GPUSampler | null = null;
    private accumulator: Accumulator | null = null;
    private frameIndex = 0;
    private fpsCounter: FPSCounter;
    private currentScene: Scene | null = null;
    private samplesPerPixel = 1;
    private debugEnabled = false;
    private _enabled = true;

    private constructor(canvas: HTMLCanvasElement) {
        this.resolution = { width: canvas.width, height: canvas.height };
        this.canvas = canvas;
        this.fpsCounter = new FPSCounter();
    }

    static async Create(
        canvas: HTMLCanvasElement,
        scenePath: string
    ): Promise<WebGPURenderer | null> {
        const renderer = new WebGPURenderer(canvas);

        try {
            if (!navigator.gpu) {
                throw new Error('WebGPU not supported in this browser');
            }

            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                throw new Error('No appropriate GPUAdapter found');
            }

            renderer.device = await adapter.requestDevice();
            renderer.root = tgpu.initFromDevice({ device: renderer.device });

            renderer.context = renderer.canvas.getContext('webgpu');
            if (!renderer.context) {
                throw new Error('Failed to get WebGPU context');
            }

            renderer.context.configure({
                device: renderer.device,
                format: navigator.gpu.getPreferredCanvasFormat(),
            });

            renderer.createTextures();

            try {
                renderer.raytracerComputePipeline =
                    await renderer.createComputePipeline(renderer.device);
            } catch (error) {
                throw new RethrownError('Failed to create pipelines', error as Error);
            }

            try {
                renderer.currentScene = await Common.loadScene(scenePath);
            } catch (error) {
                throw new RethrownError(`Failed to load '${scenePath}'`, error as Error);
            }

            try {
                await renderer.createBuffersAndBindGroups();
            } catch (error) {
                throw new RethrownError('Failed to create scene buffer', error as Error);
            }
        } catch (error) {
            Common.showError((error as Error).message);
            return null;
        }

        return renderer;
    }

    private createTextures(): void {
        if (!this.device) throw new Error('Device not initialized');

        this.intermediateTexture = this.device.createTexture({
            size: [this.resolution.width, this.resolution.height],
            format: 'rgba16float',
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });

        this.textureSampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
        });
    }

    private async createComputePipeline(device: GPUDevice): Promise<GPUComputePipeline> {
        const [commonCode, raytracerComputeCode] = await Promise.all([
            fetch('common.wgsl').then((r) => r.text()),
            fetch('raytracer_compute.wgsl').then((r) => r.text()),
        ]);

        const shaderModule = device.createShaderModule({
            code: commonCode + '\n' + raytracerComputeCode,
        });

        const info = await shaderModule.getCompilationInfo();
        for (const message of info.messages) {
            console.log(`${message.type}: ${message.message} (line ${message.lineNum})`);
        }

        return device.createComputePipeline({
            layout: 'auto',
            compute: { module: shaderModule, entryPoint: 'main' },
        });
    }

    private async createBuffersAndBindGroups(): Promise<void> {
        if (!this.device || !this.root) throw new Error('Device not initialized');
        if (!this.raytracerComputePipeline) throw new Error('Compute pipeline not initialized');
        if (!this.currentScene) throw new Error('Scene not loaded');

        this.uniformsBuffer = this.root
            .createBuffer(UniformsSchema)
            .$usage('uniform');
        this.writeUniforms();

        this.performanceCountersBuffer = this.device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.performanceCountersBuffer, 0, new Uint32Array(4));

        const scene = this.currentScene;

        this.spheresBuffer = this.root
            .createBuffer(d.arrayOf(SphereSchema, scene.spheres.length))
            .$usage('storage');
        if (scene.spheres.length > 0) {
            this.spheresBuffer.write(scene.spheres.map((s) => ({
                center: vec3(s.center),
                radius: s.radius,
                color: vec3(s.color),
                smoothness: s.smoothness,
                emissionColor: vec3(s.emissionColor),
                emissionStrength: s.emissionStrength,
                specularProbability: s.specularProbability,
            })));
        }

        this.trianglesBuffer = this.root
            .createBuffer(d.arrayOf(TriangleSchema, scene.triangles.length))
            .$usage('storage');
        if (scene.triangles.length > 0) {
            this.trianglesBuffer.write(scene.triangles.map((t) => ({
                v0: vec3(t.v0),
                v1: vec3(t.v1),
                v2: vec3(t.v2),
                color: vec3(t.color),
                emissionColor: vec3(t.emissionColor),
                emissionStrength: t.emissionStrength,
                smoothness: t.smoothness,
                specularProbability: t.specularProbability,
            })));
        }

        try {
            this.raytracerComputeBindGroup = this.device.createBindGroup({
                layout: this.raytracerComputePipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.uniformsBuffer.buffer } },
                    { binding: 1, resource: { buffer: this.spheresBuffer.buffer } },
                    { binding: 2, resource: { buffer: this.trianglesBuffer.buffer } },
                    { binding: 3, resource: this.intermediateTexture!.createView() },
                    { binding: 4, resource: { buffer: this.performanceCountersBuffer } },
                ],
            });

            this.accumulator = await Accumulator.create(
                this.device,
                this.resolution,
                this.uniformsBuffer.buffer,
                this.intermediateTexture!,
                this.textureSampler!
            );
        } catch (error) {
            Common.showError('Bind group creation failed: ' + (error as Error).message);
        }
    }

    private writeUniforms(): void {
        if (!this.uniformsBuffer || !this.currentScene) return;
        const cam = this.currentScene.camera;
        this.uniformsBuffer.write({
            camera: {
                position: vec3(cam.position),
                rotation: vec3(cam.rotation),
                fov: cam.fov,
                nearPlane: cam.nearPlane,
                farPlane: cam.farPlane,
            },
            frameIndex: this.frameIndex,
            resolution: [this.resolution.width, this.resolution.height],
            samplesPerPixel: this.samplesPerPixel,
            debugEnabled: this.debugEnabled ? 1 : 0,
        });
    }

    public setSamplesPerPixel(samples: number): void {
        this.samplesPerPixel = Math.max(1, Math.min(16, samples));
        this.writeUniforms();
    }

    private render(): void {
        if (
            !this.device ||
            !this.context ||
            !this.raytracerComputePipeline ||
            !this.raytracerComputeBindGroup ||
            !this.accumulator
        ) {
            return;
        }

        this.frameIndex++;
        this.writeUniforms();

        const commandEncoder = this.device.createCommandEncoder();

        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(this.raytracerComputePipeline);
        computePass.setBindGroup(0, this.raytracerComputeBindGroup);
        computePass.dispatchWorkgroups(
            Math.ceil(this.resolution.width / 8),
            Math.ceil(this.resolution.height / 8)
        );
        computePass.end();

        this.accumulator.render(
            commandEncoder,
            this.context.getCurrentTexture().createView()
        );

        this.device.queue.submit([commandEncoder.finish()]);
    }

    public startRenderLoop(): void {
        const loop = (): void => {
            this.fpsCounter.updateFPS();
            if (this._enabled) this.render();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    setDebug(checked: boolean) {
        this.debugEnabled = checked;
        this.writeUniforms();
    }

    resetAccumulation() {
        this.frameIndex = 0;
        this.writeUniforms();
    }

    getFPS(): number {
        return this.fpsCounter.getFPS();
    }

    getEnabled(): boolean {
        return this._enabled;
    }

    setEnabled(value: boolean) {
        this._enabled = value;
    }

    public async getTriangleTestsSinceLastCheck(): Promise<number> {
        if (!this.device || !this.performanceCountersBuffer) return 0;

        const readBuffer = this.device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        const commandEncoder = this.device.createCommandEncoder();
        commandEncoder.copyBufferToBuffer(this.performanceCountersBuffer, 0, readBuffer, 0, 16);
        this.device.queue.submit([commandEncoder.finish()]);

        await readBuffer.mapAsync(GPUMapMode.READ);
        const triangleTests = new Uint32Array(readBuffer.getMappedRange())[0];
        readBuffer.unmap();
        readBuffer.destroy();

        this.device.queue.writeBuffer(this.performanceCountersBuffer, 0, new Uint32Array(4));

        return triangleTests;
    }
}
