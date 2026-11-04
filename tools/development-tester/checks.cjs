// Untrusted candidate-tool subprocess, never the evidence producer.
// Host Python invokes each command separately and checks fresh output after exit.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

async function main() {
  if (process.argv[2] === 'install') {
    fs.copyFileSync('/work/package.json', '/deps/package.json');
    fs.copyFileSync('/work/package-lock.json', '/deps/package-lock.json');
    fs.cpSync('/work/tools/packages', '/deps/tools/packages', { recursive: true });
    const result = spawnSync('npm', ['ci', '--ignore-scripts', '--cache', '/tmp/npm-cache', '--no-audit', '--no-fund'], { cwd: '/deps', stdio: 'inherit' });
    if (result.error || result.status !== 0) throw Error('Dependency installation failed');
    return;
  }
  if (process.argv[2] !== 'build') throw Error('Unknown candidate subprocess');
  const req = createRequire('/work/package.json');
  const { createProjectGraphAsync, readProjectsConfigurationFromProjectGraph } = req('nx/src/project-graph/project-graph');
  const { runExecutor } = req('nx/src/command-line/run');
  const graph = await createProjectGraphAsync();
  const context = { root: '/work', cwd: '/work', workspace: readProjectsConfigurationFromProjectGraph(graph), projectGraph: graph, isVerbose: true };
  let results = 0;
  for await (const result of await runExecutor({ project: 'api', target: 'build', configuration: 'production' }, {}, context)) {
    if (result.success !== true) throw Error('API production build failed');
    results++;
  }
  if (!results) throw Error('Build returned no result');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
