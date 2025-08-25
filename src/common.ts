import {RawScene, Scene, Triangle, Vec3} from "./types";

export function showError(message: string): void {
    console.error('WebGPU Error:', message);
    const errorDiv = document.getElementById('error');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }
}

export class RethrownError extends Error {
    original_error: Error;
    stack_before_rethrow: string | undefined;

    constructor(message: string, error: Error) {
        super(message);
        this.name = this.constructor.name;
        if (!error)
            throw new Error('RethrownError requires a message and error');
        this.original_error = error;
        this.stack_before_rethrow = this.stack;
        const message_lines = (this.message.match(/\n/g) || []).length + 1;
        this.stack =
            this.stack
                ?.split('\n')
                .slice(0, message_lines + 1)
                .join('\n') +
            '\n' +
            error.stack;
    }
}

export async function loadOBJ(url: string) {
    const res = await fetch(url);
    const text = await res.text();
    const result = parseOBJ(text);

    // Log some statistics
    console.log(`Loaded OBJ from ${url}: ${result.triangles.length} triangles`);

    return result;
}

function parseOBJ(objText: string): { triangles: Triangle[] } {
    // const normals: Vec3[] = [];
    const triangles: Triangle[] = [];

    const tempPositions: Vec3[] = [];
    const tempNormals: Vec3[] = [];

    const lines = objText.split("\n");
    for (let line of lines) {
        line = line.trim();
        if (line.startsWith("v ")) {
            const [, x, y, z] = line.split(/\s+/);
            tempPositions.push([parseFloat(x), parseFloat(y), parseFloat(z)]);
        } else if (line.startsWith("vn ")) {
            const [, x, y, z] = line.split(/\s+/);
            tempNormals.push([parseFloat(x), parseFloat(y), parseFloat(z)]);
        } else if (line.startsWith("f ")) {
            // f v1//vn1 v2//vn2 v3//vn3
            const parts = line.slice(2).trim().split(" ");
            if (parts.length < 3) continue;

            // Triangulate polygons with more than 3 verts (fan triangulation)
            for (let i = 1; i < parts.length - 1; i++) {
                const triangleVertices: Vec3[] = [];

                for (let fv of [parts[0], parts[i], parts[i + 1]]) {
                    const [vIdx, , nIdx] = fv.split("/").map(x => x ? parseInt(x) : undefined);
                    if (vIdx === undefined || nIdx === undefined) continue;

                    if (vIdx < 1 || vIdx > tempPositions.length || nIdx < 1 || nIdx > tempNormals.length) {
                        console.warn(`Invalid index in face definition: ${fv}`);
                        continue;
                    }

                    const v = tempPositions[vIdx - 1];
                    // const n = tempNormals[nIdx - 1];

                    triangleVertices.push(v);
                    // normals.push(n);
                }

                // Store triangles
                triangles.push({
                    v0: triangleVertices[0],
                    v1: triangleVertices[1],
                    v2: triangleVertices[2],
                    color: [1, 1, 1],
                    emissionColor: [0, 0, 0],
                    emissionStrength: 0,
                    smoothness: 0,
                    specularProbability: 0
                });
            }
        }
    }

    return {triangles};
}

export async function loadScene(scenePath: string): Promise<Scene> {
    const response = await fetch(scenePath);
    if (!response.ok) {
        throw new Error(`Failed to load scene file: ${response.statusText}`);
    }

    const scene: RawScene= await response.json();

    // If triangles is a string, treat it as a path to an OBJ file
    for (const model of scene.models) {
        if (model.path) {
            try {
                const objData = await loadOBJ(model.path);
                scene.triangles.push(...objData.triangles.map(triangle => ({
                    ...triangle,
                    color: model.color,
                    emissionColor: model.emissionColor,
                    emissionStrength: model.emissionStrength,
                    smoothness: model.smoothness,
                    specularProbability: model.specularProbability
                })));
            } catch (error) {
                console.error(`Failed to load model from ${model.path}:`, error);
            }
        }
    }

    return {
        camera: scene.camera,
        spheres: scene.spheres,
        triangles: scene.triangles
    } satisfies Scene;
}
