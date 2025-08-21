import { Scene } from './types.js';

class WebGPURenderer {
    private canvas: HTMLCanvasElement;
    private context: GPUCanvasContext | null = null;
    private device: GPUDevice | null = null;
    private raytracerPipeline: GPURenderPipeline | null = null;
    private accumulatorPipeline: GPURenderPipeline | null = null;
    private frameCount = 0;
    private lastTime = performance.now();
    private fpsElement: HTMLElement;
    private spheresBuffer: GPUBuffer | null = null;
    private trianglesBuffer: GPUBuffer | null = null;
    private uniformsBuffer: GPUBuffer | null = null;
    private raytracerBindGroup: GPUBindGroup | null = null;
    private accumulatorBindGroup: GPUBindGroup | null = null;
    private intermediateTexture: GPUTexture | null = null;
    private accumulationTextureR: GPUTexture | null = null;
    private accumulationTextureG: GPUTexture | null = null;
    private accumulationTextureB: GPUTexture | null = null;
    private textureSampler: GPUSampler | null = null;
    private frameCounter = 0;
    private currentScene: Scene | null = null;

    constructor() {
        const canvas = document.getElementById('canvas') as HTMLCanvasElement;
        const fpsElement = document.getElementById('fps');

        if (!canvas) {
            throw new Error('Canvas element not found');
        }
        if (!fpsElement) {
            throw new Error('FPS element not found');
        }

        this.canvas = canvas;
        this.fpsElement = fpsElement;
    }

    async init(): Promise<void> {
        try {
            if (!navigator.gpu) {
                throw new Error('WebGPU not supported in this browser');
            }

            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                throw new Error('No appropriate GPUAdapter found');
            }

            this.device = await adapter.requestDevice();
            this.context = this.canvas.getContext('webgpu');

            if (!this.context) {
                throw new Error('Failed to get WebGPU context');
            }

            const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
            this.context.configure({
                device: this.device,
                format: canvasFormat,
            });

            try {
                await this.createPipelines();
                this.createTextures();
                await this.createSceneBuffer();
            } catch (error) {
                console.error('createSceneBuffer failed:', error);
                this.showError(
                    'Failed to create scene buffer: ' + (error as Error).message
                );
                return;
            }
            this.startRenderLoop();
        } catch (error) {
            this.showError((error as Error).message);
        }
    }

    private async createPipelines(): Promise<void> {
        if (!this.device) throw new Error('Device not initialized');

        const [commonCode, raytracerCode, accumulatorCode] = await Promise.all([
            fetch('common.wgsl').then((r) => r.text()),
            fetch('raytracer.wgsl').then((r) => r.text()),
            fetch('accumulator.wgsl').then((r) => r.text())
        ]);

        // Combine common utilities with shaders
        const fullRaytracerCode = commonCode + '\n' + raytracerCode;
        const fullAccumulatorCode = commonCode + '\n' + accumulatorCode;

        try {
            const raytracerShaderModule = this.device.createShaderModule({
                code: fullRaytracerCode,
            });
            const accumulatorShaderModule = this.device.createShaderModule({
                code: fullAccumulatorCode,
            });

            // Check for shader compilation errors
            let info = await raytracerShaderModule.getCompilationInfo();
            if (info.messages.length > 0) {
                console.log('Raytracer shader compilation messages:');
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

            // Create raytracer pipeline (renders to intermediate texture)
            this.raytracerPipeline = this.device.createRenderPipeline({
                layout: 'auto',
                vertex: {
                    module: raytracerShaderModule,
                    entryPoint: 'vs_main',
                },
                fragment: {
                    module: raytracerShaderModule,
                    entryPoint: 'fs_main',
                    targets: [
                        {
                            format: 'rgba16float', // Intermediate texture format
                        },
                    ],
                },
                primitive: {
                    topology: 'triangle-list',
                },
            });

            // Create accumulator pipeline (renders to canvas)
            this.accumulatorPipeline = this.device.createRenderPipeline({
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
        } catch (error) {
            this.showError(
                'Failed to create render pipelines: ' + (error as Error).message
            );
            throw error;
        }
    }

    private createTextures(): void {
        if (!this.device) throw new Error('Device not initialized');

        // Create intermediate texture for raytracer output
        this.intermediateTexture = this.device.createTexture({
            size: [1024, 768],
            format: 'rgba16float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });

        // Create accumulation storage textures
        const accumulationTextureConfig = {
            size: [1024, 768],
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

    private async createSceneBuffer(): Promise<void> {
        if (!this.device) throw new Error('Device not initialized');
        if (!this.raytracerPipeline) throw new Error('Raytracer pipeline not initialized');
        if (!this.accumulatorPipeline) throw new Error('Accumulator pipeline not initialized');

        try {
            const scene: Scene = await fetch('scene.json').then((r) =>
                r.json()
            );
            this.currentScene = scene;
        } catch (error) {
            console.error('Failed to load scene.json:', error);
            throw error;
        }

        // Create uniforms buffer
        this.uniformsBuffer = this.device.createBuffer({
            size: 64,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.updateUniformsBuffer()

        // Create spheres buffer
        // Sphere struct: vec3 center + radius + vec3 color + padding1 + vec3 emissionColor + emissionStrength + vec4 padding = 64 bytes
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
            // padding1: f32
            spheresData[spheresOffset++] = 0.0;

            // emissionColor: vec3<f32>
            spheresData[spheresOffset++] = sphere.emissionColor[0];
            spheresData[spheresOffset++] = sphere.emissionColor[1];
            spheresData[spheresOffset++] = sphere.emissionColor[2];
            // emissionStrength: f32
            spheresData[spheresOffset++] = sphere.emissionStrength;

            // padding: vec4<f32> (16 bytes)
            spheresData[spheresOffset++] = 0.0;
            spheresData[spheresOffset++] = 0.0;
            spheresData[spheresOffset++] = 0.0;
            spheresData[spheresOffset++] = 0.0;
        }

        this.spheresBuffer = this.device.createBuffer({
            size: Math.max(spheresSize, 64),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        if (spheresSize > 0) {
            this.device.queue.writeBuffer(this.spheresBuffer, 0, spheresData);
        }

        // Create triangles buffer
        // Triangle struct: vec3 v0 + padding1 + vec3 v1 + padding2 + vec3 v2 + padding3 + vec3 color + padding4 + vec3 emissionColor + emissionStrength + vec2 padding = 80 bytes
        const trianglesSize = this.currentScene.triangles.length * 80;
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
        }

        this.trianglesBuffer = this.device.createBuffer({
            size: trianglesSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        if (trianglesSize > 0) {
            this.device.queue.writeBuffer(this.trianglesBuffer, 0, trianglesData);
        }

        try {
            // Create raytracer bind group using pipeline's layout
            this.raytracerBindGroup = this.device.createBindGroup({
                layout: this.raytracerPipeline!.getBindGroupLayout(0),
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
            console.error('Failed to create bind groups:', error);
            this.showError(
                'Bind group creation failed: ' + (error as Error).message
            );
            return;
        }
    }

    // TODO update only the frameIndex (camera data is static for now)
    private updateUniformsBuffer(): void {
        if (!this.device || !this.uniformsBuffer || !this.currentScene) return;

        // Create uniforms buffer
        // Uniforms struct: Camera + frameIndex
        const uniformsData = new Float32Array(16);
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

        // frameIndex: f32
        uniformsData[uniformsOffset++] = this.frameCounter;
        // padding: vec3<f32> (12 bytes)

        this.device.queue.writeBuffer(this.uniformsBuffer, 0, uniformsData);
    }

    private render(): void {
        if (!this.device || !this.context || !this.raytracerPipeline || !this.accumulatorPipeline || 
            !this.raytracerBindGroup || !this.accumulatorBindGroup) {
            return;
        }

        // Update uniforms buffer with current frame counter
        this.frameCounter++;
        this.updateUniformsBuffer();

        // First pass: Raytracing to intermediate texture
        const intermediateTextureView = this.intermediateTexture!.createView();
        const raytracerRenderPassDescriptor: GPURenderPassDescriptor = {
            colorAttachments: [
                {
                    view: intermediateTextureView,
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
        };

        const commandEncoder = this.device.createCommandEncoder();
        const raytracerPassEncoder = commandEncoder.beginRenderPass(raytracerRenderPassDescriptor);
        raytracerPassEncoder.setPipeline(this.raytracerPipeline);
        raytracerPassEncoder.setBindGroup(0, this.raytracerBindGroup);
        raytracerPassEncoder.draw(6);
        raytracerPassEncoder.end();

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
        const accumulatorPassEncoder = commandEncoder.beginRenderPass(accumulatorRenderPassDescriptor);
        accumulatorPassEncoder.setPipeline(this.accumulatorPipeline);
        accumulatorPassEncoder.setBindGroup(0, this.accumulatorBindGroup);
        accumulatorPassEncoder.draw(6);
        accumulatorPassEncoder.end();

        this.device.queue.submit([commandEncoder.finish()]);
    }

    private startRenderLoop(): void {
        const loop = (): void => {
            this.updateFPS();
            this.render();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    private updateFPS(): void {
        this.frameCount++;
        const currentTime = performance.now();
        const deltaTime = currentTime - this.lastTime;

        if (deltaTime >= 1000) {
            const fps = Math.round((this.frameCount * 1000) / deltaTime);
            this.fpsElement.textContent = fps.toString();
            this.frameCount = 0;
            this.lastTime = currentTime;
        }
    }

    private showError(message: string): void {
        const errorDiv = document.getElementById('error');
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
        }
        console.error('WebGPU Error:', message);
    }
}

const renderer = new WebGPURenderer();
renderer.init();
