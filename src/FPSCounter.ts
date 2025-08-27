export class FPSCounter {
    private frameCount = 0;
    private lastTime = performance.now();
    private fpsElement: HTMLElement;
    private currentFPS = 0;

    constructor(fpsElement: HTMLElement) {
        this.fpsElement = fpsElement;
    }

    // Call this method on each frame to update the FPS counter
    public updateFPS(): void {
        this.frameCount++;
        const currentTime = performance.now();
        const deltaTime = currentTime - this.lastTime;

        if (deltaTime >= 1000) {
            const fps = Math.round((this.frameCount * 1000) / deltaTime);
            this.currentFPS = fps;
            this.fpsElement.textContent = fps.toString();
            this.frameCount = 0;
            this.lastTime = currentTime;
        }
    }

    public getFPS(): number {
        return this.currentFPS;
    }
}
