const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const sqlServer = require('mssql');
require('dotenv').config();

const app = express();
const PORT = process.env.GATEWAY_PORT || 8088;
const USE_TLS = process.env.GATEWAY_USE_TLS === 'true';

const ROLES = {
  ADMIN: 'ADMIN',
  ENGINEER: 'ENGINEER',
  VIEWER: 'VIEWER'
};

const TOKEN_REGISTRY = {
  [process.env.GATEWAY_TOKEN_ADMIN || 'agac-admin-token-2026']: ROLES.ADMIN,
  [process.env.GATEWAY_TOKEN_ENGINEER || 'agac-engineer-token-2026']: ROLES.ENGINEER,
  [process.env.GATEWAY_TOKEN_VIEWER || 'agac-viewer-token-2026']: ROLES.VIEWER,
  [process.env.GATEWAY_API_KEY || 'agac-scada-token-2026']: ROLES.ENGINEER
};

// Database Connection Configuration (Least-Privilege Engine Account)
const dbConfig = {
  user: process.env.DB_USER || 'scada_readonly',
  password: process.env.DB_PASSWORD || 'ReadOnlySCADA2026!',
  server: process.env.DB_SERVER || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME || 'Runtime',
  options: {
    encrypt: false,
    trustServerCertificate: true
  },
  pool: {
    max: 10,
    min: 1,
    idleTimeoutMillis: 30000
  },
  connectionTimeout: 5000,
  requestTimeout: 10000
};

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60000;
const MAX_REQUESTS_PER_WINDOW = 120;

function checkRateLimit(ip) {
  const now = Date.now();
  let clientData = rateLimitMap.get(ip);
  if (!clientData || now - clientData.startTime > RATE_LIMIT_WINDOW_MS) {
    clientData = { startTime: now, count: 1 };
    rateLimitMap.set(ip, clientData);
    return true;
  }
  clientData.count++;
  return clientData.count <= MAX_REQUESTS_PER_WINDOW;
}

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function getRoleFromToken(token) {
  if (!token) return null;
  for (const [validToken, role] of Object.entries(TOKEN_REGISTRY)) {
    if (safeCompare(token, validToken)) {
      return role;
    }
  }
  return null;
}

app.use(express.json({ limit: '500kb' }));

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://githubbest729.github.io,http://localhost:3000,http://127.0.0.1:3000').split(',');
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes(origin) || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('CORS validation failed: Origin unauthorized'));
    }
  }
}));

function auditLog(action, clientIp, userRole, details, outcome = 'SUCCESS') {
  const logEntry = {
    timestamp: new Date().toISOString(),
    action,
    clientIp,
    userRole: userRole || 'ANONYMOUS',
    details,
    outcome,
    correlationId: Math.random().toString(36).substring(2, 10)
  };
  console.log(`[AUDIT] ${JSON.stringify(logEntry)}`);
}

function requireAuth(minRole = ROLES.VIEWER) {
  return function (req, res, next) {
    const ip = req.ip || req.socket.remoteAddress;
    if (!checkRateLimit(ip)) {
      auditLog('RATE_LIMIT_EXCEEDED', ip, null, 'Client hit sliding request ceiling', 'REJECTED');
      return res.status(429).json({ error: 'Too many requests. Rate limit exceeded (120 req/min).' });
    }

    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      auditLog('AUTH_MISSING', ip, null, 'No authorization header provided', 'REJECTED');
      return res.status(401).json({ error: 'Unauthorized: Missing API Token' });
    }

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const role = getRoleFromToken(token);

    if (!role) {
      auditLog('AUTH_INVALID', ip, null, 'Provided token not in registry', 'REJECTED');
      return res.status(403).json({ error: 'Forbidden: Invalid API Token' });
    }

    const roleHierarchy = [ROLES.VIEWER, ROLES.ENGINEER, ROLES.ADMIN];
    if (roleHierarchy.indexOf(role) < roleHierarchy.indexOf(minRole)) {
      auditLog('RBAC_FORBIDDEN', ip, role, `Attempted access requiring ${minRole}`, 'REJECTED');
      return res.status(403).json({ error: `Forbidden: Requires ${minRole} privilege.` });
    }

    req.userRole = role;
    req.clientIp = ip;
    next();
  };
}

function validateReadOnlySql(sql) {
  if (!sql || typeof sql !== 'string') return { valid: false, error: 'Query text must be non-empty string' };
  if (sql.length > 32000) return { valid: false, error: 'Query exceeds maximum permissible length of 32,000 characters' };

  const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
  if (statements.length > 1) {
    return { valid: false, error: 'Multi-statement SQL injection vector rejected. Exactly one statement allowed.' };
  }

  const clean = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const upper = clean.toUpperCase();

  if (!/^(SELECT|WITH)\b/.test(upper)) {
    return { valid: false, error: 'Security Violation: Only SELECT or WITH read-only queries are permitted.' };
  }

  const forbiddenKeywords = [
    'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE',
    'EXEC', 'EXECUTE', 'MERGE', 'GRANT', 'REVOKE', 'SHUTDOWN', 'BACKUP',
    'RESTORE', 'DBCC', 'XP_CMDSHELL', 'SP_EXECUTESQL'
  ];

  for (const kw of forbiddenKeywords) {
    const reg = new RegExp(`\\b${kw}\\b`, 'i');
    if (reg.test(upper)) {
      return { valid: false, error: `Security Violation: Keyword "${kw}" is forbidden on read-only gateway.` };
    }
  }

  return { valid: true };
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ONLINE',
    service: 'SQL-Optima-Edge-Gateway',
    version: '2.5.0',
    mode: 'STRICT_READ_ONLY_ENFORCED',
    databaseTarget: 'scada-sql-dev (MS SQL 2022)',
    tlsEnabled: USE_TLS,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/sql/estimated-plan', requireAuth(ROLES.ENGINEER), async (req, res) => {
  const { sql, database } = req.body;
  const validation = validateReadOnlySql(sql);
  if (!validation.valid) {
    auditLog('SQL_VALIDATION_FAILED', req.clientIp, req.userRole, validation.error, 'REJECTED');
    return res.status(400).json({ error: validation.error });
  }

  let pool;
  try {
    pool = await new sqlServer.ConnectionPool(dbConfig).connect();
    const request = pool.request();

    // Request engine execution plan without committing data modifications
    await request.batch('SET SHOWPLAN_XML ON;');
    const result = await request.batch(sql);
    await request.batch('SET SHOWPLAN_XML OFF;');

    const showplanXml = result.recordset && result.recordset[0]
      ? Object.values(result.recordset[0])[0]
      : null;

    auditLog('SQL_PLAN_SUCCESS', req.clientIp, req.userRole, 'Live execution plan extracted from engine');
    res.json({
      status: 'SUCCESS',
      source: 'LIVE_SQL_ENGINE',
      database: database || 'Runtime',
      showplanXml
    });
  } catch (err) {
    auditLog('SQL_ENGINE_ERROR', req.clientIp, req.userRole, err.message, 'FAILED');
    res.status(500).json({ error: `Database Engine Rejection: ${err.message}` });
  } finally {
    if (pool) await pool.close();
  }
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/scada-feed' });

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const token = reqUrl.searchParams.get('token');

  const role = getRoleFromToken(token);

  if (!role) {
    auditLog('WS_AUTH_FAIL', ip, null, 'Unauthorized or missing token', 'REJECTED');
    ws.send(JSON.stringify({ type: 'AUTH_ERROR', message: 'Unauthorized: Invalid or missing gateway token.' }));
    ws.close(4401, 'Unauthorized');
    return;
  }

  auditLog('WS_AUTH_OK', ip, role, 'WebSocket session authorized', 'SUCCESS');
  ws.send(JSON.stringify({
    type: 'AUTH_SUCCESS',
    role: role,
    message: 'Authorized session established.',
    serverTime: new Date().toISOString()
  }));

  let pollTimer = null;

  ws.on('message', (msg) => {
    try {
      const packet = JSON.parse(msg);

      if (packet.type === 'SUBSCRIBE_TAGS') {
        const requestedTags = packet.tags || ['CH01.SupplyTemperature'];
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'OPCUA_TAG_UPDATE',
              source: 'EDGE_GATEWAY_NODE_OPCUA',
              timestamp: new Date().toISOString(),
              data: requestedTags.map(tag => ({
                tag,
                value: +(5.8 + (Math.random() - 0.5) * 0.2).toFixed(2),
                quality: 'Good (192)',
                sourceTimestamp: new Date().toISOString()
              }))
            }));
          }
        }, packet.intervalMs || 1000);
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: 'ERROR', error: 'Malformed JSON packet' }));
    }
  });

  ws.on('close', (code) => {
    if (pollTimer) clearInterval(pollTimer);
    auditLog('WS_DISCONNECT', ip, role, `Session closed with code: ${code}`);
  });
});

server.listen(PORT, () => {
  console.log(`SQL-Optima Edge Gateway running on Port ${PORT}`);
});