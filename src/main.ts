/// <reference types="@webgpu/types" />
import * as Common from './common.js';
import { WebGPURenderer } from './webgpu-renderer.js';
import { Pane } from 'tweakpane';

const SCENES: Record<string, string> = {
    Spheres: 'scene_spheres.json',
    Boxes: 'scene_boxes.json',
};

async function main(): Promise<void> {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (!canvas) throw new Error('Canvas element not found');

    const stored = {
        scene: localStorage.getItem('scene') || 'Spheres',
        samplesPerPixel: parseInt(localStorage.getItem('samplesPerPixel') || '1'),
        debug: localStorage.getItem('debug') === 'true',
    };

    const pane = new Pane({ title: 'WebGPU Raytracer' });

    const sceneBinding = pane.addBinding(stored, 'scene', {
        label: 'Scene',
        options: Object.fromEntries(Object.keys(SCENES).map((k) => [k, k])),
    });

    const renderer = await WebGPURenderer.Create(canvas, SCENES[stored.scene]);
    if (!renderer) return;

    sceneBinding.on('change', ({ value }) => {
        localStorage.setItem('scene', value);
        pane.dispose();
        main();
    });

    pane.addBinding(stored, 'samplesPerPixel', {
        label: 'Samples/pixel',
        min: 1,
        max: 16,
        step: 1,
    }).on('change', ({ value }) => {
        localStorage.setItem('samplesPerPixel', String(value));
        renderer.setSamplesPerPixel(value);
    });
    renderer.setSamplesPerPixel(stored.samplesPerPixel);

    pane.addBinding(stored, 'debug', { label: 'Debug' }).on('change', ({ value }) => {
        localStorage.setItem('debug', String(value));
        renderer.setDebug(value);
    });
    renderer.setDebug(stored.debug);

    pane.addButton({ title: 'Reset Accumulation' }).on('click', () => {
        renderer.resetAccumulation();
    });
    const pauseResumeBtn = pane.addButton({ title: 'Pause' });
    pauseResumeBtn.on('click', (ev) => {
        renderer.setEnabled(!renderer.getEnabled());
        pauseResumeBtn.title = renderer.getEnabled() ? 'Pause' : 'Resume';
    });

    pane.addBlade({ view: 'separator' });

    const monitor = { fps: 0, triTestsPerSec: 0, totalTriTests: 0 };
    pane.addBinding(monitor, 'fps', { readonly: true, label: 'FPS' });
    pane.addBinding(monitor, 'triTestsPerSec', { readonly: true, label: 'Ray-tri tests/sec' ,format: Common.formatNumber });
    pane.addBinding(monitor, 'totalTriTests', { readonly: true, label: 'Total Tri Tests', format: Common.formatNumber });

    setInterval(async () => {
        monitor.fps = renderer.getFPS();
        const triTestsPerSec = await renderer.getTriangleTestsSinceLastCheck();
        monitor.triTestsPerSec = triTestsPerSec;
        monitor.totalTriTests += triTestsPerSec;
        pane.refresh();
    }, 1000);

    renderer.startRenderLoop();
}

window.addEventListener('load', () => main());
