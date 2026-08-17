/** @type {import('vitest/config').UserConfig} */
export default {
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    pool: 'forks',
    server: { deps: { inline: [/@deepseek-ai\//] } },
  },
}
