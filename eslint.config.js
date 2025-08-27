import js from '@eslint/js';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import prettier from 'eslint-plugin-prettier';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    plugins: {
      '@typescript-eslint': typescriptEslint,
      prettier: prettier,
    },
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
      },
      globals: {
        console: 'readonly',
        document: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        HTMLCanvasElement: 'readonly',
        HTMLElement: 'readonly',
        Error: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        Float32Array: 'readonly',
        Math: 'readonly',
        GPUCanvasContext: 'readonly',
        GPUDevice: 'readonly',
        GPURenderPipeline: 'readonly',
        GPUBuffer: 'readonly',
        GPUBindGroup: 'readonly',
        GPUTexture: 'readonly',
        GPUSampler: 'readonly',
        GPUTextureFormat: 'readonly',
        GPUTextureUsage: 'readonly',
        GPUBufferUsage: 'readonly',
        GPURenderPassDescriptor: 'readonly',
        localStorage: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLSelectElement: 'readonly',
        GPUComputePipeline: 'readonly',
        GPUMapMode: 'readonly',
        setInterval: 'readonly',
      },
    },
    rules: {
      "no-unused-vars": "off",
      'prettier/prettier': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];