import js from '@eslint/js';
import globals from 'globals';
import { defineConfig } from 'eslint/config';
export default defineConfig([
  { ignores: ['node_modules/**', 'coverage/**', 'services/llm/**', 'services/problemDescription.service.js', 'taxonomy/**', 'validators/**', 'prompts/**', 'workers/**'] },
  js.configs.recommended,
  { files: ['**/*.js'], languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.jest } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] } }
]);
