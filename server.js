const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = __dirname;
const stateFile = process.env.DASHBOARD_STATE_FILE || path.join(root, 'data', 'dashboard-state.json');
const host = process.env.HOST || '0.0.0.0';
const requestedPort = process.env.PORT !== undefined ? Number(process.env.PORT) : 3000;
const port = Number.isFinite(requestedPort) ? requestedPort : 3000;
const eventClients = new Set();
const maxBodyBytes = 5 * 1024 * 1024;
let stateWriteQueue = Promise.resolve();

function sendJson(response, status, value, requestMethod = 'GET') {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    if (requestMethod === 'HEAD') {
        response.end();
        return;
    }
    response.end(JSON.stringify(value));
}

async function readState() {
    try {
        return JSON.parse(await fs.readFile(stateFile, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

async function readJsonBody(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > maxBodyBytes) {
            const error = new Error('Request body is too large.');
            error.statusCode = 413;
            throw error;
        }
        chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function writeState(state) {
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    const temporaryFile = `${stateFile}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporaryFile, JSON.stringify(state), { mode: 0o600 });
    await fs.rename(temporaryFile, stateFile);
}

function matchesSecret(value, expected) {
    const valueBuffer = Buffer.from(value);
    const expectedBuffer = Buffer.from(expected);
    return valueBuffer.length === expectedBuffer.length && timingSafeEqual(valueBuffer, expectedBuffer);
}

function authorizeRequest(request, response) {
    const username = process.env.DASHBOARD_USERNAME;
    const password = process.env.DASHBOARD_PASSWORD;
    if (!username || !password) {
        if (process.env.NODE_ENV !== 'production') return true;
        response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end('Dashboard credentials are not configured.');
        return false;
    }

    const authorization = request.headers.authorization || '';
    const encodedCredentials = authorization.match(/^Basic\s+(.+)$/i)?.[1];
    if (encodedCredentials) {
        const decodedCredentials = Buffer.from(encodedCredentials, 'base64').toString('utf8');
        const separator = decodedCredentials.indexOf(':');
        if (separator >= 0) {
            const providedUsername = decodedCredentials.slice(0, separator);
            const providedPassword = decodedCredentials.slice(separator + 1);
            if (matchesSecret(providedUsername, username) && matchesSecret(providedPassword, password)) return true;
        }
    }

    response.writeHead(401, {
        'WWW-Authenticate': 'Basic realm="ESL Teacher Dashboard", charset="UTF-8"',
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    response.end('Authentication required.');
    return false;
}

async function handleRequest(request, response) {
    if (!authorizeRequest(request, response)) return;
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const method = request.method || 'GET';

    if (url.pathname === '/api/state') {
        if (method === 'GET' || method === 'HEAD') {
            sendJson(response, 200, { state: await readState() }, method);
            return;
        }
        if (method === 'PUT') {
            const state = await readJsonBody(request);
            if (!state || typeof state !== 'object' || Array.isArray(state)) {
                sendJson(response, 400, { error: 'State must be a JSON object.' }, method);
                return;
            }
            const write = stateWriteQueue.then(() => writeState(state));
            stateWriteQueue = write.catch(() => {});
            await write;
            const event = `data: ${JSON.stringify({ clientId: request.headers['x-client-id'] || null, state })}\n\n`;
            for (const client of eventClients) client.write(event);
            sendJson(response, 200, { ok: true }, method);
            return;
        }
        response.setHeader('Allow', 'GET, PUT, HEAD');
        sendJson(response, 405, { error: 'Method not allowed.' }, method);
        return;
    }

    if (url.pathname === '/api/events' && method === 'GET') {
        response.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive'
        });
        response.write(': connected\n\n');
        eventClients.add(response);
        const heartbeat = setInterval(() => response.write(': keep-alive\n\n'), 20000);
        request.on('close', () => {
            clearInterval(heartbeat);
            eventClients.delete(response);
        });
        return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' });
        response.end('Method not allowed.');
        return;
    }

    const fileName = url.pathname === '/' ? '/index.html' : url.pathname;
    const publicFiles = {
        '/index.html': 'text/html; charset=utf-8',
        '/index.html.html': 'text/html; charset=utf-8',
        '/supabase-config.js': 'text/javascript; charset=utf-8'
    };
    if (!Object.prototype.hasOwnProperty.call(publicFiles, fileName)) {
        response.writeHead(404);
        response.end(method === 'HEAD' ? undefined : 'Not found.');
        return;
    }

    try {
        const content = await fs.readFile(path.join(root, fileName.slice(1)));
        response.writeHead(200, {
            'Content-Type': publicFiles[fileName],
            'Cache-Control': 'no-store'
        });
        if (method === 'HEAD') {
            response.end();
            return;
        }
        response.end(content);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        response.writeHead(404);
        response.end(method === 'HEAD' ? undefined : 'Not found.');
    }
}

function startServer(candidatePort) {
    const server = http.createServer((request, response) => {
        handleRequest(request, response).catch(error => {
            console.error(error);
            if (!response.headersSent) sendJson(response, error.statusCode || 500, { error: error.message }, request.method || 'GET');
            else response.destroy(error);
        });
    });

    server.on('error', error => {
        if (error.code === 'EADDRINUSE' && candidatePort === port && requestedPort === port && process.env.PORT === undefined) {
            const fallbackPort = candidatePort + 1;
            console.warn(`Port ${candidatePort} is busy. Retrying on ${fallbackPort}.`);
            startServer(fallbackPort);
            return;
        }
        throw error;
    });

    server.listen(candidatePort, host, () => {
        console.log(`ESL dashboard available at http://localhost:${candidatePort}`);
    });
}

startServer(port);