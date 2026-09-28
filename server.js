const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = __dirname;
const stateFile = process.env.DASHBOARD_STATE_FILE || path.join(root, 'data', 'dashboard-state.json');
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3000);
const eventClients = new Set();
const maxBodyBytes = 5 * 1024 * 1024;

function sendJson(response, status, value) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
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

async function handleRequest(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

    if (url.pathname === '/api/state') {
        if (request.method === 'GET') {
            sendJson(response, 200, { state: await readState() });
            return;
        }
        if (request.method === 'PUT') {
            const state = await readJsonBody(request);
            if (!state || typeof state !== 'object' || Array.isArray(state)) {
                sendJson(response, 400, { error: 'State must be a JSON object.' });
                return;
            }
            await writeState(state);
            const event = `data: ${JSON.stringify({ clientId: request.headers['x-client-id'] || null, state })}\n\n`;
            for (const client of eventClients) client.write(event);
            sendJson(response, 200, { ok: true });
            return;
        }
        response.setHeader('Allow', 'GET, PUT');
        sendJson(response, 405, { error: 'Method not allowed.' });
        return;
    }

    if (url.pathname === '/api/events' && request.method === 'GET') {
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

    if (request.method !== 'GET') {
        response.writeHead(405, { Allow: 'GET' });
        response.end('Method not allowed.');
        return;
    }

    const fileName = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!['/index.html', '/index.html.html'].includes(fileName)) {
        response.writeHead(404);
        response.end('Not found.');
        return;
    }

    try {
        const content = await fs.readFile(path.join(root, fileName.slice(1)));
        response.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store'
        });
        response.end(content);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        response.writeHead(404);
        response.end('Not found.');
    }
}

http.createServer((request, response) => {
    handleRequest(request, response).catch(error => {
        console.error(error);
        if (!response.headersSent) sendJson(response, error.statusCode || 500, { error: error.message });
        else response.destroy(error);
    });
}).listen(port, host, () => {
    console.log(`ESL dashboard available at http://localhost:${port}`);
});