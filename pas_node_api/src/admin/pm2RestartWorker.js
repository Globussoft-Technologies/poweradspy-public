'use strict';

const fs = require('fs');
const { execFile } = require('child_process');

const [, , statusPath, operationId] = process.argv;

function writeStatus(state, message) {
  fs.writeFileSync(statusPath, JSON.stringify({
    operationId,
    state,
    message,
    updatedAt: Date.now()
  }));
}

if (!statusPath || !operationId) {
  process.exitCode = 1;
} else {
  writeStatus('running', 'PM2 restart is running');

  // Let the API return HTTP 202 before PM2 replaces its process.
  setTimeout(() => {
    execFile('pm2', ['restart', 'all'], { timeout: 60000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || stdout || error.message).trim().slice(0, 1000);
        writeStatus('failed', detail || 'PM2 restart command failed');
        process.exitCode = 1;
        return;
      }

      writeStatus('running', 'PM2 restarted; verifying process health');
      setTimeout(() => {
        execFile('pm2', ['jlist'], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (listError, listStdout, listStderr) => {
          if (listError) {
            const detail = String(listStderr || listStdout || listError.message).trim().slice(0, 1000);
            writeStatus('failed', `Restart ran, but PM2 health check failed: ${detail}`);
            process.exitCode = 1;
            return;
          }

          try {
            const processes = JSON.parse(listStdout);
            const unhealthy = processes.filter(item => item.pm2_env?.status !== 'online');
            if (unhealthy.length > 0) {
              const detail = unhealthy.map(item => {
                const name = item.name || item.pm2_env?.name || 'unknown';
                const state = item.pm2_env?.status || 'unknown';
                const exitCode = item.pm2_env?.exit_code;
                return `${name}: ${state}${exitCode == null ? '' : ` (exit ${exitCode})`}`;
              }).join(', ');
              writeStatus('failed', `PM2 restart completed, but process errors were found: ${detail}`);
              process.exitCode = 1;
              return;
            }

            writeStatus('succeeded', `${processes.length} PM2 process${processes.length === 1 ? '' : 'es'} online`);
          } catch (parseError) {
            writeStatus('failed', `Restart ran, but PM2 status could not be parsed: ${parseError.message}`);
            process.exitCode = 1;
          }
        });
      }, 3000);
    });
  }, 750);
}
