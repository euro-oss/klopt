import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import klopt from '@klopt/eslint-plugin'

/**
 * Layering (spec section 11.1). `packages/core` is the framework-free domain and
 * is the part that survives if TanStack Start turns out to be the wrong bet, so
 * the boundary is enforced by the linter rather than by good intentions.
 *
 * dependency-cruiser (.dependency-cruiser.cjs) covers the graph-shaped rules —
 * cycles, orphans, dev dependencies leaking into production code. This file
 * covers the specifier-shaped ones, because it can see `import type` and does
 * not need a build to have run first.
 */
const forbid = (groups, message) => ['error', { patterns: [{ group: groups, message }] }]

const FRAMEWORK = ['react', 'react-dom', 'react/*', '@tanstack/*', 'vite', 'vite/*']
const DATABASE = ['drizzle-orm', 'drizzle-orm/*', 'postgres', 'pg', 'pg-boss']

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.output/**',
      '**/.nitro/**',
      '**/.tanstack/**',
      '**/coverage/**',
      'packages/db/migrations/**',
      'apps/web/src/routeTree.gen.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // The root vitest.config.ts belongs to no package tsconfig.
          allowDefaultProject: ['vitest.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    plugins: { klopt },
    rules: {
      'klopt/no-number-money': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  {
    files: ['packages/core/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-restricted-imports': forbid(
        [
          ...FRAMEWORK,
          ...DATABASE,
          '@klopt/db',
          '@klopt/db/*',
          '@klopt/adapters',
          '@klopt/adapters/*',
        ],
        'packages/core is the framework-free domain: no UI framework, no database, no adapters. Define a port here and implement it outside.',
      ),
    },
  },

  {
    files: ['packages/db/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-restricted-imports': forbid(
        [...FRAMEWORK, '@klopt/adapters', '@klopt/adapters/*'],
        'packages/db is persistence only. It may depend on core, never on adapters or a UI framework.',
      ),
    },
  },

  {
    files: ['packages/adapters/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': forbid(
        [...FRAMEWORK, '@klopt/db', '@klopt/db/*'],
        'packages/adapters talks to third parties, not to the database. Persist through a port defined in core.',
      ),
    },
  },

  {
    files: ['apps/worker/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': forbid(
        ['react', 'react-dom', '@tanstack/react-start', '@tanstack/react-start/*'],
        'The worker runs outside a request and cannot import the web framework (spec 11.1, point 2).',
      ),
    },
  },

  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Config files and the lint plugin itself are plain JS, outside any tsconfig.
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
)
