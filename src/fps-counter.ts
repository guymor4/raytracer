export class FPSCounter {
    private frameCount = 0;
    private lastTime = performance.now();
    private currentFPS = 0;

    public updateFPS(): void {
        this.frameCount++;
        const currentTime = performance.now();
        const deltaTime = currentTime - this.lastTime;

        if (deltaTime >= 1000) {
            this.currentFPS = Math.round((this.frameCount * 1000) / deltaTime);
            this.frameCount = 0;
            this.lastTime = currentTime;
        }
    }

    public getFPS(): number {
        return this.currentFPS;
    }
}
