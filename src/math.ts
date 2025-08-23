import { Vec3 } from './types.js';

export class Mat4 {
    data: Float32Array;

    constructor(data?: number[]) {
        this.data = new Float32Array(16);
        if (data && data.length === 16) {
            this.data.set(data);
        } else {
            this.identity();
        }
    }

    identity(): Mat4 {
        this.data.fill(0);
        this.data[0] = this.data[5] = this.data[10] = this.data[15] = 1;
        return this;
    }

    static perspective(fov: number, aspect: number, near: number, far: number): Mat4 {
        const mat = new Mat4();
        const f = 1.0 / Math.tan(fov * 0.5);
        
        mat.data[0] = f / aspect;
        mat.data[5] = f;
        mat.data[10] = (far + near) / (near - far);
        mat.data[11] = -1;
        mat.data[14] = (2 * far * near) / (near - far);
        mat.data[15] = 0;
        
        return mat;
    }

    static lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
        const mat = new Mat4();
        
        // Calculate camera basis vectors
        const zAxis = normalize(subtract(eye, target)); // Forward (camera looks down -Z)
        const xAxis = normalize(cross(up, zAxis));       // Right
        const yAxis = cross(zAxis, xAxis);               // Up
        
        // Create view matrix
        mat.data[0] = xAxis[0]; mat.data[1] = yAxis[0]; mat.data[2] = zAxis[0]; mat.data[3] = 0;
        mat.data[4] = xAxis[1]; mat.data[5] = yAxis[1]; mat.data[6] = zAxis[1]; mat.data[7] = 0;
        mat.data[8] = xAxis[2]; mat.data[9] = yAxis[2]; mat.data[10] = zAxis[2]; mat.data[11] = 0;
        mat.data[12] = -dot(xAxis, eye); mat.data[13] = -dot(yAxis, eye); mat.data[14] = -dot(zAxis, eye); mat.data[15] = 1;
        
        return mat;
    }

    multiply(other: Mat4): Mat4 {
        const result = new Mat4();
        const a = this.data;
        const b = other.data;
        const r = result.data;
        
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                let sum = 0;
                for (let k = 0; k < 4; k++) {
                    sum += a[i * 4 + k] * b[k * 4 + j];
                }
                r[i * 4 + j] = sum;
            }
        }
        
        return result;
    }
}

// Vector utility functions
function normalize(v: Vec3): Vec3 {
    const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
}

function dot(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}