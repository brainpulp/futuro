// Hook script: reload browser-sync + start save server after edits to this project
let d = '';
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  try {
    const j = JSON.parse(d || '{}');
    const f = (j.tool_input && j.tool_input.file_path) || '';
    if (!f.includes('futuro')) return;

    const { execSync, spawn } = require('child_process');

    // Start save server if not already running
    try { execSync('node -e "require(\'net\').createConnection(3001,\'127.0.0.1\').on(\'connect\',()=>process.exit(0)).on(\'error\',()=>process.exit(1))"', { stdio: 'pipe', timeout: 1000 }); }
    catch (e) {
      const sv = spawn('node', ['F:/code/futuro/save-server.js'], { detached: true, stdio: 'ignore' });
      sv.unref();
    }

    // Reload browser-sync
    try {
      execSync('npx browser-sync reload --port 3000', { stdio: 'pipe' });
    } catch (e) {
      const s = spawn('npx', [
        '--yes', 'browser-sync', 'start',
        '--server', 'F:/code/futuro',
        '--files', 'F:/code/futuro/index.html,F:/code/futuro/scenarios.json',
        '--port', '3000',
        '--no-open'
      ], { detached: true, stdio: 'ignore', shell: true });
      s.unref();
    }
  } catch (e) { /* ignore */ }
});
