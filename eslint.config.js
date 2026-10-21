import { defineConfig, globalIgnores } from 'eslint/config';
import react from 'eslint-config-cheminfo-react/base';
import ts from 'eslint-config-cheminfo-typescript';
import globals from 'globals';

export default defineConfig(
  globalIgnores(['**/coverage', '**/lib']),
  ts,
  {
    // Fastify, and Postgrator's drivers, are factories called without `new`.
    rules: { 'new-cap': ['error', { capIsNew: false }] },
  },
  {
    files: ['backend/**'],
    languageOptions: { globals: globals.nodeBuiltin },
  },
  {
    files: ['frontend/**/*.{ts,tsx}'],
    extends: [react],
  },
);
