import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
    files: 'test/integration/**/*.test.js',
    version: process.env.VSCODE_VERSION || 'stable',
    workspaceFolder: 'test/fixtures',
    launchArgs: ['--disable-extensions', '--disable-workspace-trust'],
    mocha: { ui: 'tdd', timeout: 120000 },
});
