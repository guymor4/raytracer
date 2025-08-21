import { Scene } from './types.js';

class WebGPURenderer {
  private canvas: HTMLCanvasElement;
  private context: GPUCanvasContext | null = null;
  private device: GPUDevice | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private frameCount = 0;
  private lastTime = performance.now();
  private fpsElement: HTMLElement;
  private spheresBuffer: GPUBuffer | null = null;
  private planesBuffer: GPUBuffer | null = null;
  private cameraBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private accumulationTextureR: GPUTexture | null = null;
  private accumulationTextureG: GPUTexture | null = null;
  private accumulationTextureB: GPUTexture | null = null;
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

      await this.createPipeline();
      this.createVertexBuffer();
      this.createTextures();
      try {
        await this.createSceneBuffer();
      } catch (error) {
        console.error('createSceneBuffer failed:', error);
        this.showError('Failed to create scene buffer: ' + (error as Error).message);
        return;
      }
      this.startRenderLoop();
    } catch (error) {
      this.showError((error as Error).message);
    }
  }

  private async createPipeline(): Promise<void> {
    if (!this.device) throw new Error('Device not initialized');

    const shaderCode = await fetch('shaders.wgsl').then((r) => r.text());

    try {
      const shaderModule = this.device.createShaderModule({
        code: shaderCode,
      });

      // Check for shader compilation errors
      const info = await shaderModule.getCompilationInfo();
      if (info.messages.length > 0) {
        console.log('Shader compilation messages:');
        for (const message of info.messages) {
          console.log(`${message.type}: ${message.message} (line ${message.lineNum})`);
        }
      }

      this.pipeline = this.device.createRenderPipeline({
        layout: 'auto',
        vertex: {
          module: shaderModule,
          entryPoint: 'vs_main',
        },
        fragment: {
          module: shaderModule,
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
      this.showError('Failed to create render pipeline: ' + (error as Error).message);
      throw error;
    }
  }

  private createVertexBuffer(): void {
    // Not needed for fullscreen quad raytracer - vertices are generated in shader
  }

  private createTextures(): void {
    if (!this.device) throw new Error('Device not initialized');

    // Create accumulation storage textures
    const accumulationTextureConfig = {
      size: [1024, 768],
      format: 'r32float' as GPUTextureFormat,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    };

    this.accumulationTextureR = this.device.createTexture(accumulationTextureConfig);
    this.accumulationTextureG = this.device.createTexture(accumulationTextureConfig);
    this.accumulationTextureB = this.device.createTexture(accumulationTextureConfig);
  }

  private async createSceneBuffer(): Promise<void> {
    if (!this.device) throw new Error('Device not initialized');
    if (!this.pipeline) throw new Error('Pipeline not initialized');

    try {
      const scene: Scene = await fetch('scene.json').then((r) => r.json());
      this.currentScene = scene;
    } catch (error) {
      console.error('Failed to load scene.json:', error);
      throw error;
    }

    // Create camera buffer
    // Camera struct: vec3 position + vec3 rotation + f32 fov + f32 nearPlane + f32 farPlane + f32 frameIndex + padding = 48 bytes  
    const cameraData = new Float32Array(12);
    let cameraOffset = 0;

    // Camera.position: vec3<f32> (12 bytes + 4 bytes padding = 16 bytes)
    cameraData[cameraOffset++] = this.currentScene.camera.position[0];
    cameraData[cameraOffset++] = this.currentScene.camera.position[1];
    cameraData[cameraOffset++] = this.currentScene.camera.position[2];
    cameraOffset++; // padding after vec3

    // rotation: vec3<f32>
    cameraData[cameraOffset++] = this.currentScene.camera.rotation[0];
    cameraData[cameraOffset++] = this.currentScene.camera.rotation[1];
    cameraData[cameraOffset++] = this.currentScene.camera.rotation[2];

    // Camera.fov, Camera.nearPlane, Camera.farPlane, Camera.frameIndex: f32 each (16 bytes)
    cameraData[cameraOffset++] = this.currentScene.camera.fov;
    cameraData[cameraOffset++] = this.currentScene.camera.nearPlane;
    cameraData[cameraOffset++] = this.currentScene.camera.farPlane;
    cameraData[cameraOffset++] = this.frameCounter;

    this.cameraBuffer = this.device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.cameraBuffer, 0, cameraData);

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

    // Create planes buffer
    // Plane struct: vec3 position + f32 padding1 + vec3 normal + f32 padding2 + vec3 color + f32 padding3 + vec3 emissionColor + f32 emissionStrength = 80 bytes
    const planesSize = this.currentScene.planes.length * 80;
    const planesData = new Float32Array(planesSize / 4);
    let planesOffset = 0;

    for (const plane of this.currentScene.planes) {
      // position: vec3<f32>
      planesData[planesOffset++] = plane.position[0];
      planesData[planesOffset++] = plane.position[1];
      planesData[planesOffset++] = plane.position[2];
      // padding1: f32
      planesData[planesOffset++] = 0.0;

      // normal: vec3<f32>
      planesData[planesOffset++] = plane.normal[0];
      planesData[planesOffset++] = plane.normal[1];
      planesData[planesOffset++] = plane.normal[2];
      // padding2: f32
      planesData[planesOffset++] = 0.0;

      // color: vec3<f32>
      planesData[planesOffset++] = plane.color[0];
      planesData[planesOffset++] = plane.color[1];
      planesData[planesOffset++] = plane.color[2];
      // padding3: f32
      planesData[planesOffset++] = 0.0;

      // emissionColor: vec3<f32>
      planesData[planesOffset++] = plane.emissionColor[0];
      planesData[planesOffset++] = plane.emissionColor[1];
      planesData[planesOffset++] = plane.emissionColor[2];

      // emissionStrength: f32
      planesData[planesOffset++] = plane.emissionStrength;

      // padding: vec3<f32>
      planesData[planesOffset++] = 0.0;
      planesData[planesOffset++] = 0.0;
      planesData[planesOffset++] = 0.0;
    }

    this.planesBuffer = this.device.createBuffer({
      size: Math.max(planesSize, 80),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    if (planesSize > 0) {
      this.device.queue.writeBuffer(this.planesBuffer, 0, planesData);
    }

    try {
      // Create bind group using pipeline's layout
      this.bindGroup = this.device.createBindGroup({
        layout: this.pipeline!.getBindGroupLayout(0),
        entries: [
          {
            binding: 0,
            resource: { buffer: this.cameraBuffer },
          },
          {
            binding: 1,
            resource: { buffer: this.spheresBuffer },
          },
          {
            binding: 2,
            resource: { buffer: this.planesBuffer },
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
      console.error('Failed to create bind group:', error);
      this.showError('Bind group creation failed: ' + (error as Error).message);
      return;
    }
  }

  private updateCameraBuffer(): void {
    if (!this.device || !this.cameraBuffer || !this.currentScene) return;

    const cameraData = new Float32Array(12);
    let cameraOffset = 0;

    // Camera.position: vec3<f32> (12 bytes + 4 bytes padding = 16 bytes)
    cameraData[cameraOffset++] = this.currentScene.camera.position[0];
    cameraData[cameraOffset++] = this.currentScene.camera.position[1];
    cameraData[cameraOffset++] = this.currentScene.camera.position[2];
    cameraOffset++; // padding after vec3

    // Camera.rotation: vec3<f32> (12 bytes + 4 bytes padding = 16 bytes)
    cameraData[cameraOffset++] = this.currentScene.camera.rotation[0];
    cameraData[cameraOffset++] = this.currentScene.camera.rotation[1];
    cameraData[cameraOffset++] = this.currentScene.camera.rotation[2];

    // Camera.fov, Camera.nearPlane, Camera.farPlane, Camera.frameIndex: f32 each (16 bytes)
    cameraData[cameraOffset++] = this.currentScene.camera.fov;
    cameraData[cameraOffset++] = this.currentScene.camera.nearPlane;
    cameraData[cameraOffset++] = this.currentScene.camera.farPlane;
    cameraData[cameraOffset++] = this.frameCounter;

    this.device.queue.writeBuffer(this.cameraBuffer, 0, cameraData);
  }

  private render(): void {
    if (!this.device || !this.context || !this.pipeline || !this.bindGroup) {
      return;
    }

    // Update camera buffer with current frame counter
    this.frameCounter++;
    this.updateCameraBuffer();

    const textureView = this.context.getCurrentTexture().createView();
    const renderPassDescriptor: GPURenderPassDescriptor = {
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    };

    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, this.bindGroup);
    passEncoder.draw(6);
    passEncoder.end();

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