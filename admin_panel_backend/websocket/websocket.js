
require('dotenv').config();
const WebSocket = require('ws');
const url = require('url');
const logger = require('../utils/logger');

const initializeWebSocket = (server) => {
  const wss = new WebSocket.Server({
    server,
    path: '/socket',
    clientTracking: true,
    perMessageDeflate: {
      zlibDeflateOptions: {
        chunkSize: 2048, 
        memLevel: 8, 
        level: 5 
      },
      zlibInflateOptions: {
        chunkSize: 16 * 1024 
      },
      threshold: 2048, 
      concurrencyLimit: 20 
    }
  });

  const clients = {
    frontends: new Map(),
    backends: new Map()
  };

  const API_KEY = process.env.API_KEY;
  const HEARTBEAT_INTERVAL = 60000; 
  const MAX_MESSAGE_SIZE = 10 * 1024 * 1024; 

  function updateAllConfigs(newConfig) {
    try {
      const configToSend = {
        wsUrl: newConfig.wsUrl || `ws://${process.env.HOST || 'localhost'}:${process.env.PORT || 4000}/socket`,
        apiKey: newConfig.apiKey || API_KEY
      };

      clients.backends.forEach((ws, systemName) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'update_config',
            config: { systemName, wsUrl: configToSend.wsUrl, apiKey: configToSend.apiKey }
          }));
          logger.info(`Sent config update to backend: ${systemName}`);
        } else {
          logger.warn(`Backend ${systemName} not available for config update`);
          clients.backends.delete(systemName); 
        }
      });
      logger.info('Config update sent to all backend clients');
    } catch (err) {
      logger.error(`Failed to update configs: ${err.message}`, { stack: err.stack });
    }
  }

  wss.on('connection', (ws, req) => {
    let systemName;
    let clientType = null;
    let heartbeatInterval;
    ws.isAlive = true;

  
    try {
      const parsedUrl = url.parse(req.url, true);
      const apiKeyFromQuery = parsedUrl.query.apiKey;
      const systemNameFromQuery = parsedUrl.query.systemName;
      const apiKeyFromHeader = req.headers['x-api-key'];
      systemName = req.headers['x-system-name'] || systemNameFromQuery;

      if (apiKeyFromQuery && systemNameFromQuery) {
        if (apiKeyFromQuery !== API_KEY) {
          logger.warn(`Invalid API key from query for ${systemNameFromQuery}`);
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid API key' }));
          return ws.close(1008, 'Invalid API key');
        }
        clientType = 'frontend';
        if (clients.frontends.has(systemNameFromQuery)) {
          logger.warn(`Duplicate frontend registration for ${systemNameFromQuery}`);
          ws.send(JSON.stringify({ type: 'error', message: 'System already registered' }));
          return ws.close(1008, 'Duplicate registration');
        }
        clients.frontends.set(systemNameFromQuery, ws);
        ws.systemName = systemNameFromQuery;
        ws.send(JSON.stringify({ type: 'apiKeyValid' }));
        ws.send(JSON.stringify({ type: 'systemNameRegistered', systemName: systemNameFromQuery }));
        logger.info(`Frontend connected: ${systemNameFromQuery}`);
        const backendWs = clients.backends.get(systemNameFromQuery);
        if (backendWs && backendWs.readyState === WebSocket.OPEN) {
          backendWs.send(JSON.stringify({
            type: 'command',
            action: 'get_screen_resolution',
            systemName: systemNameFromQuery
          }));
          logger.debug(`Requested screen resolution from backend: ${systemNameFromQuery}`);
        } else {
          logger.warn(`No backend found for ${systemNameFromQuery} to request screen resolution`);
          ws.send(JSON.stringify({ type: 'error', message: 'Backend system not available' }));
        }
        } else if (apiKeyFromHeader && systemName) {
        if (apiKeyFromHeader !== API_KEY) {
          logger.warn(`Invalid API key from header for ${systemName}`);
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid API key' }));
          return ws.close(1008, 'Invalid API key');
        }
        clientType = 'backend';
        if (clients.backends.has(systemName)) {
          logger.warn(`Duplicate backend registration for ${systemName}`);
          ws.send(JSON.stringify({ type: 'error', message: 'System already registered' }));
          return ws.close(1008, 'Duplicate registration');
        }
        clients.backends.set(systemName, ws);
        ws.systemName = systemName;
        ws.send(JSON.stringify({ type: 'registered', systemName }));
        logger.info(`Backend registered: ${systemName}`);
      } else {
        clientType = 'pending';
        logger.info('New connection pending authentication');
      }
    } catch (err) {
      logger.error(`Connection setup error: ${err.message}`, { stack: err.stack });
      ws.send(JSON.stringify({ type: 'error', message: 'Connection setup failed' }));
      return ws.close(1008, 'Connection setup failed');
    }

    // Heartbeat mechanism
    heartbeatInterval = setInterval(() => {
      if (!ws.isAlive) {
        logger.warn(`Terminating unresponsive connection: ${ws.systemName || 'unregistered client'}`);
        if (clientType === 'frontend') clients.frontends.delete(ws.systemName);
        else if (clientType === 'backend') clients.backends.delete(ws.systemName);
        return ws.terminate();
      }
      ws.isAlive = false;
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
          logger.debug(`Sent ping to ${ws.systemName || 'unregistered client'}`);
        }
      } catch (err) {
        logger.error(`Error sending ping: ${err.message}`, { stack: err.stack });
      }
    }, HEARTBEAT_INTERVAL);

    ws.on('pong', () => {
      ws.isAlive = true;
      logger.debug(`Received pong from ${ws.systemName || 'unregistered client'}`);
    });

    ws.on('message', (data) => {
      try {
        // Validate message size
        if (data.length > MAX_MESSAGE_SIZE) {
          logger.warn(`Message too large from ${ws.systemName || 'unregistered client'}`);
          ws.send(JSON.stringify({ type: 'error', message: 'Message size exceeds limit' }));
          return ws.close(1008, 'Message too large');
        }

        const message = JSON.parse(data.toString());

        // Handle pending client authentication
        if (clientType === 'pending' && message.type === 'apiKey') {
          if (message.apiKey !== API_KEY) {
            logger.warn(`Invalid API key from pending client: ${message.apiKey}`);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid API key' }));
            return ws.close(1008, 'Invalid API key');
          }
          clientType = 'frontend';
          ws.send(JSON.stringify({ type: 'apiKeyValid' }));
          logger.info('API key validated for frontend');
          return;
        }

        if (clientType === 'frontend' && message.type === 'systemName') {
          systemName = message.systemName;
          if (!systemName || clients.frontends.has(systemName)) {
            logger.warn(`Invalid or duplicate system name: ${systemName}`);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid or duplicate system name' }));
            return ws.close(1008, 'Invalid or duplicate system name');
          }
          clients.frontends.set(systemName, ws);
          ws.systemName = systemName;
          ws.send(JSON.stringify({ type: 'systemNameRegistered', systemName }));
          logger.info(`Frontend registered: ${systemName}`);
          return;
        }

        if (clientType === 'pending' && message.type === 'register') {
          systemName = message.systemName;
          if (!systemName || clients.backends.has(systemName)) {
            logger.warn(`Invalid or duplicate backend registration: ${systemName}`);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid or duplicate systemName' }));
            return ws.close(1008, 'Invalid or duplicate systemName');
          }
          clientType = 'backend';
          clients.backends.set(systemName, ws);
          ws.systemName = systemName;
          ws.send(JSON.stringify({ type: 'registered', systemName }));
          logger.info(`Backend registered: ${systemName}`);
          return;
        }

        if (!clientType || clientType === 'pending') {
          logger.warn(`Unauthorized message from ${ws.systemName || 'pending client'}`);
          ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
          return ws.close(1008, 'Not authenticated');
        }

        // Handle messages
        if (message.type === 'command' && clientType === 'frontend') {
          const backendWs = clients.backends.get(message.systemName);
          if (backendWs && backendWs.readyState === WebSocket.OPEN) {
            backendWs.send(JSON.stringify(message));
            logger.debug(`Command forwarded to ${message.systemName}: ${message.action}`);
          } else {
            logger.warn(`No backend found for ${message.systemName}`);
            ws.send(JSON.stringify({ type: 'error', message: 'Remote system not available' }));
          }
        } else if (message.type === 'screenshot' && clientType === 'backend') {
          if (!message.data || typeof message.data !== 'string') {
            logger.warn(`Invalid screenshot data from ${ws.systemName}`);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid screenshot data' }));
            return;
          }
          const frontendWs = clients.frontends.get(ws.systemName);
          if (frontendWs && frontendWs.readyState === WebSocket.OPEN) {
            frontendWs.send(JSON.stringify({
              type: 'screenshot',
              systemName: ws.systemName,
              data: message.data
            }));
            logger.debug(`Screenshot forwarded for ${ws.systemName}`);
          } else {
            logger.warn(`No frontend found for ${ws.systemName}`);
          }
        } else if (message.type === 'screen_resolution' && clientType === 'backend') {
          if (!message.data || !message.data.width || !message.data.height) {
            logger.warn(`Invalid screen resolution data from ${ws.systemName}`);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid screen resolution data' }));
            return;
          }
          const frontendWs = clients.frontends.get(ws.systemName);
          if (frontendWs && frontendWs.readyState === WebSocket.OPEN) {
            frontendWs.send(JSON.stringify({
              type: 'screen_resolution',
              systemName: ws.systemName,
              data: message.data
            }));
            logger.debug(`Screen resolution forwarded for ${ws.systemName}: ${message.data.width}x${message.data.height}`);
          } else {
            logger.warn(`No frontend found for ${ws.systemName}`);
          }
        } else if (message.type === 'ping' && clientType === 'frontend') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: message.timestamp }));
        } else if (message.type === 'pong' && clientType === 'backend') {
        } else {
          logger.warn(`Unknown message type: ${message.type} from ${clientType} (${ws.systemName})`);
          ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
        }
      } catch (err) {
        logger.error(`Message processing error: ${err.message}`, { stack: err.stack });
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        ws.close(1008, 'Invalid message format');
      }
    });

    ws.on('close', (code, reason) => {
      clearInterval(heartbeatInterval);
      if (ws.systemName) {
        if (clientType === 'frontend') clients.frontends.delete(ws.systemName);
        else if (clientType === 'backend') clients.backends.delete(ws.systemName);
        logger.info(`${clientType} disconnected: ${ws.systemName}, Code: ${code}, Reason: ${reason.toString() || 'unknown'}`);
      } else {
        logger.info(`Unregistered ${clientType || 'pending'} disconnected, Code: ${code}, Reason: ${reason.toString() || 'unknown'}`);
      }
    });

    ws.on('error', (err) => {
      logger.error(`WebSocket error for ${ws.systemName || 'unregistered client'}: ${err.message}`, { stack: err.stack });
      if (ws.systemName) {
        if (clientType === 'frontend') clients.frontends.delete(ws.systemName);
        else if (clientType === 'backend') clients.backends.delete(ws.systemName);
      }
    });
  });

  // Global heartbeat cleanup
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        logger.warn(`Terminating unresponsive connection: ${ws.systemName || 'unregistered client'}`);
        if (ws.systemName) {
          if (clients.frontends.has(ws.systemName)) clients.frontends.delete(ws.systemName);
          else if (clients.backends.has(ws.systemName)) clients.backends.delete(ws.systemName);
        }
        ws.terminate();
      }
    });
  }, HEARTBEAT_INTERVAL);

  const shutdown = () => {
    try {
      wss.clients.forEach((client) => {
        client.close(1001, 'Server shutting down');
      });
      logger.info('WebSocket server shutting down');
    } catch (err) {
      logger.error(`Shutdown error: ${err.message}`, { stack: err.stack });
    }
  };

  return { wss, updateAllConfigs, shutdown };
};

module.exports = { initializeWebSocket };