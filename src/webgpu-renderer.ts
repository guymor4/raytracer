import { FPSCounter } from './fps-counter';
import { Scene } from './types';
import * as Common from './common';
import { RethrownError } from './common';
import { Accumulator } from './accumulator';

export class WebGPURenderer {
    private canvas: HTMLCanvasElement;
    private context: GPUCanvasContext | null = null;
    private device: GPUDevice | null = null;
    private raytracerComputePipeline: GPUComputePipeline | null = null;
    private resolution: { width: number; height: number };
    private spheresBuffer: GPUBuffer | null = null;
    private trianglesBuffer: GPUBuffer | null = null;
    private uniformsBuffer: GPUBuffer | null = null;
    private performanceCountersBuffer: GPUBuffer | null = null;
    private raytracerComputeBindGroup: GPUBindGroup | null = null;
    private intermediateTexture: GPUTexture | null = null;
    private textureSampler: GPUSampler | null = null;
    private accumulator: Accumulator | null = null;
    private frameIndex = 0;
    private fpsCounter: FPSCounter;
    private currentScene: Scene | null = null;
    private samplesPerPixel = 1;
    private debugEnabled: boolean = false;
    private _enabled: boolean = true;
    
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
            renderer.context = renderer.canvas.getContext('webgpu');
            if (!renderer.context) {
                throw new Error('Failed to get WebGPU context');
            }

            const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
            renderer.context.configure({
                device: renderer.device,
                format: canvasFormat,
            });

            // Create GPU textures
            renderer.createTextures();
            if (!renderer.intermediateTexture) {
                throw new Error('Intermediate texture not initialized');
            }

            // Create pipelines
            try {
                renderer.raytracerComputePipeline =
                    await renderer.createComputePipeline(renderer.device);
            } catch (error) {
                throw new RethrownError(
                    'Failed to create pipelines',
                    error as Error
                );
            }

            // Load scene
            try {
                renderer.currentScene = await Common.loadScene(scenePath);
            } catch (error) {
                throw new RethrownError(
                    `Failed to load '${scenePath}'`,
                    error as Error
                );
            }

            // Create scene buffers and bind groups
            try {
                await renderer.createBuffersAndBindGroups();
            } catch (error) {
                throw new RethrownError(
                    'Failed to create scene buffer',
                    error as Error
                );
            }
        } catch (error) {
            Common.showError((error as Error).message);
            return null;
        }

        return renderer;
    }

    private createTextures(): void {
        if (!this.device) throw new Error('Device not initialized');

        // Create intermediate texture for raytracer output
        this.intermediateTexture = this.device.createTexture({
            size: [this.resolution.width, this.resolution.height],
            format: 'rgba16float',
            usage:
                GPUTextureUsage.STORAGE_BINDING |
                GPUTextureUsage.TEXTURE_BINDING,
        });

        // Create sampler for intermediate texture
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
        if (info.messages.length > 0) {
            for (const message of info.messages) {
                console.log(`${message.type}: ${message.message} (line ${message.lineNum})`);
            }
        }

        return device.createComputePipeline({
            layout: 'auto',
            compute: { module: shaderModule, entryPoint: 'main' },
        });
    }

    private async createBuffersAndBindGroups(): Promise<void> {
        if (!this.device) throw new Error('Device not initialized');
        if (!this.raytracerComputePipeline)
            throw new Error('Raytracer compute pipeline not initialized');
        if (!this.currentScene)
            throw new Error('Scene not loaded or initialized');

        // Create uniforms buffer
        this.uniformsBuffer = this.device.createBuffer({
            size: 80,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.updateUniformsBuffer();

        // Create performance counters buffer (4 bytes per counter, start with 4 counters)
        this.performanceCountersBuffer = this.device.createBuffer({
            size: 16, // 4 counters * 4 bytes each
            usage:
                GPUBufferUsage.STORAGE |
                GPUBufferUsage.COPY_SRC |
                GPUBufferUsage.COPY_DST,
        });

        // Initialize to zero
        this.device.queue.writeBuffer(
            this.performanceCountersBuffer,
            0,
            new Uint32Array(4)
        );

        // Create spheres buffer
        // Sphere struct: 64 bytes
        const spheresSize = this.currentScene.spheres.length * 64;
        const spheresData = new Float32Array(spheresSize / 4);
        let spheresOffset = 0;

        for (const sphere of this.currentScene.spheres) {
            // center: vec3<f32>
            spheresData[spheresOffset++] = sphere.center[0];
            spheresData[spheresOffset++] = sphere.center[1];
            spheresData[spheresOffset++] = sphere.center[2];
            // radius: f32
            spheresData[spheresOffset++] = sphere.radius;

            // color: vec3<f32>
            spheresData[spheresOffset++] = sphere.color[0];
            spheresData[spheresOffset++] = sphere.color[1];
            spheresData[spheresOffset++] = sphere.color[2];
            // smoothness: f32
            spheresData[spheresOffset++] = sphere.smoothness;

            // emissionColor: vec3<f32>
            spheresData[spheresOffset++] = sphere.emissionColor[0];
            spheresData[spheresOffset++] = sphere.emissionColor[1];
            spheresData[spheresOffset++] = sphere.emissionColor[2];
            // emissionStrength: f32
            spheresData[spheresOffset++] = sphere.emissionStrength;
            // specularProbability: f32
            spheresData[spheresOffset++] = sphere.specularProbability;
            // padding: f32 (4 bytes)
            spheresData[spheresOffset++] = 0.0;
            spheresData[spheresOffset++] = 0.0;
            spheresData[spheresOffset++] = 0.0;
        }

        this.spheresBuffer = this.device.createBuffer({
            size: spheresSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        if (spheresSize > 0) {
            this.device.queue.writeBuffer(this.spheresBuffer, 0, spheresData);
        }

        // Create triangles buffer
        // Triangle struct: 96 bytes
        const trianglesSize = this.currentScene.triangles.length * 96;
        const trianglesData = new Float32Array(trianglesSize / 4);
        let trianglesOffset = 0;

        for (const triangle of this.currentScene.triangles) {
            // v0: vec3<f32>
            trianglesData[trianglesOffset++] = triangle.v0[0];
            trianglesData[trianglesOffset++] = triangle.v0[1];
            trianglesData[trianglesOffset++] = triangle.v0[2];
            // padding1: f32
            trianglesData[trianglesOffset++] = 0.0;

            // v1: vec3<f32>
            trianglesData[trianglesOffset++] = triangle.v1[0];
            trianglesData[trianglesOffset++] = triangle.v1[1];
            trianglesData[trianglesOffset++] = triangle.v1[2];
            // padding2: f32
            trianglesData[trianglesOffset++] = 0.0;

            // v2: vec3<f32>
            trianglesData[trianglesOffset++] = triangle.v2[0];
            trianglesData[trianglesOffset++] = triangle.v2[1];
            trianglesData[trianglesOffset++] = triangle.v2[2];
            // padding3: f32
            trianglesData[trianglesOffset++] = 0.0;

            // color: vec3<f32>
            trianglesData[trianglesOffset++] = triangle.color[0];
            trianglesData[trianglesOffset++] = triangle.color[1];
            trianglesData[trianglesOffset++] = triangle.color[2];
            // padding4: f32
            trianglesData[trianglesOffset++] = 0.0;

            // emissionColor: vec3<f32>
            trianglesData[trianglesOffset++] = triangle.emissionColor[0];
            trianglesData[trianglesOffset++] = triangle.emissionColor[1];
            trianglesData[trianglesOffset++] = triangle.emissionColor[2];

            // emissionStrength: f32
            trianglesData[trianglesOffset++] = triangle.emissionStrength;

            // smoothness: f32
            trianglesData[trianglesOffset++] = triangle.smoothness;
            // specularProbability: f32
            trianglesData[trianglesOffset++] = triangle.specularProbability;
            // padding: f32
            trianglesData[trianglesOffset++] = 0.0;
            trianglesData[trianglesOffset++] = 0.0;
        }

        this.trianglesBuffer = this.device.createBuffer({
            size: trianglesSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        if (trianglesSize > 0) {
            this.device.queue.writeBuffer(
                this.trianglesBuffer,
                0,
                trianglesData
            );
        }

        try {
            this.raytracerComputeBindGroup = this.device.createBindGroup({
                layout: this.raytracerComputePipeline!.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.uniformsBuffer } },
                    { binding: 1, resource: { buffer: this.spheresBuffer } },
                    { binding: 2, resource: { buffer: this.trianglesBuffer } },
                    { binding: 3, resource: this.intermediateTexture!.createView() },
                    { binding: 4, resource: { buffer: this.performanceCountersBuffer! } },
                ],
            });

            this.accumulator = await Accumulator.create(
                this.device,
                this.resolution,
                this.uniformsBuffer,
                this.intermediateTexture!,
                this.textureSampler!
            );
        } catch (error) {
            Common.showError('Bind group creation failed: ' + (error as Error).message);
            return;
        }
    }

    // TODO update only the frameIndex (camera data is static for now)
    private updateUniformsBuffer(): void {
        if (!this.device || !this.uniformsBuffer || !this.currentScene) return;

        // Create uniforms buffer
        // Uniforms struct: Camera + frameIndex + resolution + samples
        const uniformsData = new Float32Array(20);
        let uniformsOffset = 0;

        // Camera.position: vec3<f32> (12 bytes + 4 bytes padding = 16 bytes)
        uniformsData[uniformsOffset++] = this.currentScene.camera.position[0];
        uniformsData[uniformsOffset++] = this.currentScene.camera.position[1];
        uniformsData[uniformsOffset++] = this.currentScene.camera.position[2];
        uniformsOffset++; // padding after vec3

        // rotation: vec3<f32>
        uniformsData[uniformsOffset++] = this.currentScene.camera.rotation[0];
        uniformsData[uniformsOffset++] = this.currentScene.camera.rotation[1];
        uniformsData[uniformsOffset++] = this.currentScene.camera.rotation[2];

        // Camera.fov, Camera.nearPlane, Camera.farPlane: f32 each
        uniformsData[uniformsOffset++] = this.currentScene.camera.fov;
        uniformsData[uniformsOffset++] = this.currentScene.camera.nearPlane;
        uniformsData[uniformsOffset++] = this.currentScene.camera.farPlane;
        uniformsOffset++; // padding after 3 f32
        uniformsOffset++;

        // frameIndex, resolution width, resolution height: f32
        uniformsData[uniformsOffset++] = this.frameIndex;
        uniformsOffset++;
        uniformsData[uniformsOffset++] = this.resolution.width;
        uniformsData[uniformsOffset++] = this.resolution.height;

        // samples: u32 (converted to f32 for buffer)
        uniformsData[uniformsOffset++] = this.samplesPerPixel;
        uniformsData[uniformsOffset++] = this.debugEnabled ? 1.0 : 0.0;

        this.device.queue.writeBuffer(this.uniformsBuffer, 0, uniformsData);
    }

    public setSamplesPerPixel(samples: number): void {
        this.samplesPerPixel = Math.max(1, Math.min(16, samples));
        this.updateUniformsBuffer();
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
        this.updateUniformsBuffer();

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
            if (this._enabled) {
                this.render();
            }
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    setDebug(checked: boolean) {
        this.debugEnabled = checked;
    }

    resetAccumulation() {
        this.frameIndex = 0;
        this.updateUniformsBuffer();
    }

    public getFPS(): number {
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

        // Create a buffer for reading back the counter data
        const readBuffer = this.device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        // Copy counter data to read buffer
        const commandEncoder = this.device.createCommandEncoder();
        commandEncoder.copyBufferToBuffer(
            this.performanceCountersBuffer,
            0,
            readBuffer,
            0,
            16
        );
        this.device.queue.submit([commandEncoder.finish()]);

        // Read the data
        await readBuffer.mapAsync(GPUMapMode.READ);
        const data = new Uint32Array(readBuffer.getMappedRange());
        const triangleTests = data[0]; // Counter 0 is triangle tests
        readBuffer.unmap();
        readBuffer.destroy();

        // Reset counter for next measurement
        const resetCounters = new Uint32Array(4);
        this.device.queue.writeBuffer(
            this.performanceCountersBuffer,
            0,
            resetCounters
        );

        return triangleTests;
    }
}
