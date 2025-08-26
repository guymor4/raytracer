import {Scene} from './types.js';
import * as Common from './common.js';
import {RethrownError} from './common.js';
import {FPSCounter} from './FPSCounter.js';

class WebGPURenderer {
    private canvas: HTMLCanvasElement;
    private context: GPUCanvasContext | null = null;
    private device: GPUDevice | null = null;
    private raytracerComputePipeline: GPUComputePipeline | null = null;
    private accumulatorPipeline: GPURenderPipeline | null = null;
    private resolution: { width: number; height: number };
    private spheresBuffer: GPUBuffer | null = null;
    private trianglesBuffer: GPUBuffer | null = null;
    private uniformsBuffer: GPUBuffer | null = null;
    private raytracerComputeBindGroup: GPUBindGroup | null = null;
    private accumulatorBindGroup: GPUBindGroup | null = null;
    private intermediateTexture: GPUTexture | null = null;
    private accumulationTextureR: GPUTexture | null = null;
    private accumulationTextureG: GPUTexture | null = null;
    private accumulationTextureB: GPUTexture | null = null;
    private textureSampler: GPUSampler | null = null;
    private frameIndex = 0;
    private fpsCounter: FPSCounter;
    private currentScene: Scene | null = null;
    private samplesPerPixel = 1;
    private debugEnabled: boolean = false;

    private constructor(canvas: HTMLCanvasElement, fpsElement: HTMLElement) {
        this.resolution = { width: canvas.width, height: canvas.height };

        this.canvas = canvas;
        this.fpsCounter = new FPSCounter(fpsElement);
    }

    static async Create(
        canvas: HTMLCanvasElement,
        fpsElement: HTMLElement,
        scenePath: string
    ): Promise<WebGPURenderer | null> {
        const renderer = new WebGPURenderer(canvas, fpsElement);

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
                const pipelines = await renderer.createPipelines(
                    renderer.device,
                    renderer.intermediateTexture
                );
                renderer.raytracerComputePipeline = pipelines.raytracerComputePipeline;
                renderer.accumulatorPipeline = pipelines.accumulatorPipeline;
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

        // Create accumulation storage textures
        const accumulationTextureConfig = {
            size: [this.resolution.width, this.resolution.height],
            format: 'r32float' as GPUTextureFormat,
            usage:
                GPUTextureUsage.STORAGE_BINDING |
                GPUTextureUsage.TEXTURE_BINDING,
        };

        this.accumulationTextureR = this.device.createTexture(
            accumulationTextureConfig
        );
        this.accumulationTextureG = this.device.createTexture(
            accumulationTextureConfig
        );
        this.accumulationTextureB = this.device.createTexture(
            accumulationTextureConfig
        );

        // Create sampler for intermediate texture
        this.textureSampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
        });
    }

    private async createPipelines(
        device: GPUDevice,
        intermediateTexture: GPUTexture
    ): Promise<{
        raytracerComputePipeline: GPUComputePipeline;
        accumulatorPipeline: GPURenderPipeline;
    }> {
        const [commonCode, raytracerComputeCode, accumulatorCode] = await Promise.all([
            fetch('common.wgsl').then((r) => r.text()),
            fetch('raytracer_compute.wgsl').then((r) => r.text()),
            fetch('accumulator.wgsl').then((r) => r.text()),
        ]);

        // Combine common utilities with shaders
        const fullRaytracerComputeCode = commonCode + '\n' + raytracerComputeCode;
        const fullAccumulatorCode = commonCode + '\n' + accumulatorCode;

        const raytracerComputeShaderModule = device.createShaderModule({
            code: fullRaytracerComputeCode,
        });
        const accumulatorShaderModule = device.createShaderModule({
            code: fullAccumulatorCode,
        });

        // Check for shader compilation errors
        let info = await raytracerComputeShaderModule.getCompilationInfo();
        if (info.messages.length > 0) {
            console.log('Raytracer compute shader compilation messages:');
            for (const message of info.messages) {
                console.log(
                    `${message.type}: ${message.message} (line ${message.lineNum})`
                );
            }
        }

        info = await accumulatorShaderModule.getCompilationInfo();
        if (info.messages.length > 0) {
            console.log('Accumulator shader compilation messages:');
            for (const message of info.messages) {
                console.log(
                    `${message.type}: ${message.message} (line ${message.lineNum})`
                );
            }
        }

        // Create raytracer compute pipeline
        const raytracerComputePipeline = device.createComputePipeline({
            layout: 'auto',
            compute: {
                module: raytracerComputeShaderModule,
                entryPoint: 'main',
            },
        });

        // Create accumulator pipeline (renders to canvas)
        const accumulatorPipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: accumulatorShaderModule,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: accumulatorShaderModule,
                entryPoint: 'fs_main',
                targets: [
                    {
                        format: navigator.gpu.getPreferredCanvasFormat(),
                    },
                ],
            },
            primitive: {
                topology: 'triangle-list',
            },
        });

        return {
            raytracerComputePipeline,
            accumulatorPipeline,
        };
    }

    private async createBuffersAndBindGroups(): Promise<void> {
        if (!this.device) throw new Error('Device not initialized');
        if (!this.raytracerComputePipeline)
            throw new Error('Raytracer compute pipeline not initialized');
        if (!this.accumulatorPipeline)
            throw new Error('Accumulator pipeline not initialized');
        if (!this.currentScene)
            throw new Error('Scene not loaded or initialized');

        // Create uniforms buffer
        this.uniformsBuffer = this.device.createBuffer({
            size: 80,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.updateUniformsBuffer();

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
            // Create raytracer compute bind group using pipeline's layout
            this.raytracerComputeBindGroup = this.device.createBindGroup({
                layout: this.raytracerComputePipeline!.getBindGroupLayout(0),
                entries: [
                    {
                        binding: 0,
                        resource: { buffer: this.uniformsBuffer },
                    },
                    {
                        binding: 1,
                        resource: { buffer: this.spheresBuffer },
                    },
                    {
                        binding: 2,
                        resource: { buffer: this.trianglesBuffer },
                    },
                    {
                        binding: 3,
                        resource: this.intermediateTexture!.createView(),
                    },
                ],
            });

            // Create accumulator bind group using pipeline's layout
            this.accumulatorBindGroup = this.device.createBindGroup({
                layout: this.accumulatorPipeline!.getBindGroupLayout(0),
                entries: [
                    {
                        binding: 0,
                        resource: { buffer: this.uniformsBuffer },
                    },
                    {
                        binding: 1,
                        resource: this.intermediateTexture!.createView(),
                    },
                    {
                        binding: 2,
                        resource: this.textureSampler!,
                    },
                    {
                        binding: 3,
                        resource: this.accumulationTextureR!.createView(),
                    },
                    {
                        binding: 4,
                        resource: this.accumulationTextureG!.createView(),
                    },
                    {
                        binding: 5,
                        resource: this.accumulationTextureB!.createView(),
                    },
                ],
            });
        } catch (error) {
            Common.showError(
                'Bind group creation failed: ' + (error as Error).message
            );
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
            !this.accumulatorPipeline ||
            !this.raytracerComputeBindGroup ||
            !this.accumulatorBindGroup
        ) {
            return;
        }

        // Update uniforms buffer with current frame counter
        this.frameIndex++;
        this.updateUniformsBuffer();

        const commandEncoder = this.device.createCommandEncoder();
        
        // First pass: Compute raytracing to intermediate texture
        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(this.raytracerComputePipeline);
        computePass.setBindGroup(0, this.raytracerComputeBindGroup);
        
        // Calculate dispatch size (8x8 workgroup size)
        const dispatchX = Math.ceil(this.resolution.width / 8);
        const dispatchY = Math.ceil(this.resolution.height / 8);
        computePass.dispatchWorkgroups(dispatchX, dispatchY);
        computePass.end();

        // Second pass: Accumulation to canvas
        const canvasTextureView = this.context.getCurrentTexture().createView();
        const accumulatorRenderPassDescriptor: GPURenderPassDescriptor = {
            colorAttachments: [
                {
                    view: canvasTextureView,
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
        };
        const accumulatorPassEncoder = commandEncoder.beginRenderPass(
            accumulatorRenderPassDescriptor
        );
        accumulatorPassEncoder.setPipeline(this.accumulatorPipeline);
        accumulatorPassEncoder.setBindGroup(0, this.accumulatorBindGroup);
        accumulatorPassEncoder.draw(6);
        accumulatorPassEncoder.end();

        this.device.queue.submit([commandEncoder.finish()]);
    }

    public startRenderLoop(): void {
        const loop = (): void => {
            this.fpsCounter.updateFPS();
            this.render();
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
}

async function main(scenePath: string = 'scene_spheres.json'): Promise<void> {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    const fpsElement = document.getElementById('fps');
    const settingsElement = document.getElementById('settings');

    if (!canvas) {
        throw new Error('Canvas element not found');
    }
    if (!fpsElement) {
        throw new Error('FPS element not found');
    }
    if (!settingsElement) {
        throw new Error('Settings element not found');
    }

    const renderer = await WebGPURenderer.Create(canvas, fpsElement, scenePath);
    if (!renderer) {
        return;
    }

    // Create settings UI and wire up events
    settingsElement.innerHTML = ''; // Clear existing content

    // Add input for scene selection
    const sceneDiv = document.createElement('div');
    const sceneLabel = document.createElement('label');
    sceneLabel.textContent = 'Scene: ';
    const sceneSelect = document.createElement('select');
    const scenes = {'Spheres': 'scene_spheres.json', 'Boxes': 'scene_boxes.json'};
    for (const [sceneName, scenePath] of Object.entries(scenes)) {
        const option = document.createElement('option');
        option.value = scenePath;
        option.textContent = sceneName;
        sceneSelect.appendChild(option);
    }
    sceneSelect.onchange = (event) => {
        const value = (event.target as HTMLSelectElement).value;
        // For simplicity, we reload the entire renderer with the new scene
        main(value); // Reload the main function to reset with new scene
    };
    sceneDiv.appendChild(sceneLabel);
    sceneDiv.appendChild(sceneSelect);
    settingsElement.appendChild(sceneDiv);

    // Add input for samples per pixel
    const samplesDiv = document.createElement('div');
    const samplesLabel = document.createElement('label');
    samplesLabel.textContent = 'Samples per pixel: ';
    const samplesInput = document.createElement('input');
    samplesInput.type = 'number';
    samplesInput.min = '1';
    samplesInput.max = '16';
    samplesInput.value = '1';
    samplesInput.oninput = (event) => {
        const value = (event.target as HTMLInputElement).value;
        const samples = parseInt(value) || 1;
        renderer.setSamplesPerPixel(samples);
    }
    samplesDiv.appendChild(samplesLabel);
    samplesDiv.appendChild(samplesInput);
    settingsElement.appendChild(samplesDiv);

    // Add a debug checkbox
    const enableDebugDiv = document.createElement('div');
    const enableDebugLabel = document.createElement('label');
    enableDebugLabel.textContent = 'Enable Debug';
    const enableDebugCheckbox = document.createElement('input');
    enableDebugCheckbox.type = 'checkbox';
    enableDebugCheckbox.onchange = (event) => {
        const checked = (event.target as HTMLInputElement).checked;
        renderer.setDebug(checked);
    }
    enableDebugDiv.appendChild(enableDebugCheckbox);
    enableDebugDiv.appendChild(enableDebugLabel);
    settingsElement.appendChild(enableDebugDiv);

    // Reset accumulation button
    const resetButton = document.createElement('button');
    resetButton.textContent = 'Reset accumulation';
    resetButton.onclick = () => {
        renderer.resetAccumulation();
    };
    settingsElement.appendChild(resetButton);

    // Start rendering loop in the background
    renderer.startRenderLoop();
}
window.addEventListener('load', () => main());
