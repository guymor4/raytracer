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
      await this.createSceneBuffer();
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
      shaderModule.getCompilationInfo().then(info => {
        if (info.messages.length > 0) {
          console.log('Shader compilation messages:');
          for (const message of info.messages) {
            console.log(`${message.type}: ${message.message} (line ${message.lineNum})`);
          }
        }
      });

      // Force pipeline recreation with explicit layout
      const bindGroupLayout = this.device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' }
          },
          {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: 'read-only-storage' }
          },
          {
            binding: 2,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: 'read-only-storage' }
          },
        ],
      });

      const pipelineLayout = this.device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
      });

      this.pipeline = this.device.createRenderPipeline({
        layout: pipelineLayout,
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

  private async createSceneBuffer(): Promise<void> {
    if (!this.device) throw new Error('Device not initialized');
    if (!this.pipeline) throw new Error('Pipeline not initialized');

    const scene: Scene = await fetch('scene.json').then((r) => r.json());

    // Create camera buffer
    // Camera struct: vec3 position + vec3 rotation + f32 fov + f32 nearPlane + f32 farPlane + padding = 48 bytes
    const cameraData = new Float32Array(12);
    let camOffset = 0;

    // position: vec3<f32>
    cameraData[camOffset++] = scene.camera.position[0];
    cameraData[camOffset++] = scene.camera.position[1];
    cameraData[camOffset++] = scene.camera.position[2];
    camOffset++; // padding after vec3

    // rotation: vec3<f32>
    cameraData[camOffset++] = scene.camera.rotation[0];
    cameraData[camOffset++] = scene.camera.rotation[1];
    cameraData[camOffset++] = scene.camera.rotation[2];

    // fov, nearPlane, farPlane: f32 each
    cameraData[camOffset++] = scene.camera.fov;
    cameraData[camOffset++] = scene.camera.nearPlane;
    cameraData[camOffset++] = scene.camera.farPlane;
    camOffset++; // padding
    camOffset++; // padding

    this.cameraBuffer = this.device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.cameraBuffer, 0, cameraData);

    // Create spheres buffer  
    // Sphere struct: vec3 center + radius + vec3 color + padding1 + vec3 emissionColor + emissionStrength + vec4 padding = 64 bytes
    const spheresSize = scene.spheres.length * 64;
    const spheresData = new Float32Array(spheresSize / 4);
    let offset = 0;

    for (const sphere of scene.spheres) {
      // center: vec3<f32>
      spheresData[offset++] = sphere.center[0];
      spheresData[offset++] = sphere.center[1];
      spheresData[offset++] = sphere.center[2];
      // radius: f32
      spheresData[offset++] = sphere.radius;

      // color: vec3<f32>
      spheresData[offset++] = sphere.color[0];
      spheresData[offset++] = sphere.color[1];
      spheresData[offset++] = sphere.color[2];
      // padding1: f32
      spheresData[offset++] = 0.0;

      // emissionColor: vec3<f32>
      spheresData[offset++] = sphere.emissionColor[0];
      spheresData[offset++] = sphere.emissionColor[1];
      spheresData[offset++] = sphere.emissionColor[2];
      // emissionStrength: f32
      spheresData[offset++] = sphere.emissionStrength;

      // padding: vec4<f32> (16 bytes)
      spheresData[offset++] = 0.0;
      spheresData[offset++] = 0.0;
      spheresData[offset++] = 0.0;
      spheresData[offset++] = 0.0;
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
    const planesSize = scene.planes.length * 80;
    const planesData = new Float32Array(planesSize / 4);
    offset = 0;

    for (const plane of scene.planes) {
      // position: vec3<f32>
      planesData[offset++] = plane.position[0];
      planesData[offset++] = plane.position[1];
      planesData[offset++] = plane.position[2];
      // padding1: f32
      planesData[offset++] = 0.0;

      // normal: vec3<f32>
      planesData[offset++] = plane.normal[0];
      planesData[offset++] = plane.normal[1];
      planesData[offset++] = plane.normal[2];
      // padding2: f32
      planesData[offset++] = 0.0;

      // color: vec3<f32>
      planesData[offset++] = plane.color[0];
      planesData[offset++] = plane.color[1];
      planesData[offset++] = plane.color[2];
      // padding3: f32
      planesData[offset++] = 0.0;

      // emissionColor: vec3<f32>
      planesData[offset++] = plane.emissionColor[0];
      planesData[offset++] = plane.emissionColor[1];
      planesData[offset++] = plane.emissionColor[2];

      // emissionStrength: f32
      planesData[offset++] = plane.emissionStrength;
    }

    this.planesBuffer = this.device.createBuffer({
      size: Math.max(planesSize, 80),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    if (planesSize > 0) {
      this.device.queue.writeBuffer(this.planesBuffer, 0, planesData);
    }


    // Create bind group using explicit layout
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' }
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'read-only-storage' }
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'read-only-storage' }
        },
      ],
    });

    this.bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
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
      ],
    });
  }

  private render(): void {
    if (!this.device || !this.context || !this.pipeline || !this.bindGroup) {
      return;
    }

    const commandEncoder = this.device.createCommandEncoder();
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