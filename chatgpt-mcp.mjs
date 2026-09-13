// Small, dependency-free MCP HTTP adapter for ChatGPT and other remote MCP clients.
// Put the server behind HTTPS and set AO_MCP_TOKEN before exposing it publicly.
export const MCP_PATH = '/mcp';

const protocolVersion = '2024-11-05';

const tools = [
  {
    name: 'agents_office_health',
    description: 'Read Agents Office runtime and connector status.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'agents_office_agents',
    description: 'List the Agents Office departments and agents.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'agents_office_tasks',
    description: 'List recent Agents Office tasks.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } },
      additionalProperties: false,
    },
  },
  {
    name: 'agents_office_create_task',
    description: 'Create a local Agents Office task. It does not send anything externally.',
    inputSchema: {
      type: 'object',
      required: ['department', 'text'],
      properties: {
        department: { type: 'string', enum: ['emails', 'sales', 'marketing', 'ops', 'fin', 'delivery'] },
        text: { type: 'string', minLength: 1, maxLength: 2000 },
      },
      additionalProperties: false,
    },
  },
];

const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
const error = message => ({ isError: true, content: [{ type: 'text', text: message }] });

export function mcpAuthorized(req, token) {
  if (!token) return false;
  const value = req.headers.authorization || '';
  if (value === `Bearer ${token}`) return true;
  const url = new URL(req.url || '/', 'http://localhost');
  return url.searchParams.get('access_token') === token;
}

export async function handleMcp(req, res, {
  token,
  health,
  agents,
  tasks,
  createTask,
}) {
  const headers = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'mcp-session-id' };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...headers, 'access-control-allow-headers': 'authorization, content-type, mcp-session-id', allow: 'OPTIONS, POST' });
    return res.end();
  }
  if (!mcpAuthorized(req, token)) {
    res.writeHead(401, { ...headers, 'content-type': 'application/json', 'www-authenticate': 'Bearer' });
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { ...headers, allow: 'POST', 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'MCP endpoint requires POST' }));
  }
  let message;
  try {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    message = JSON.parse(raw || '{}');
  } catch {
    res.writeHead(400, { ...headers, 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Invalid JSON' }));
  }
  const id = message.id ?? null;
  let body;
  if (message.method === 'initialize') {
    body = { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'agents-office', version: '1.0.0' } };
  } else if (message.method === 'notifications/initialized') {
    res.writeHead(202, headers);
    return res.end();
  } else if (message.method === 'tools/list') {
    body = { tools };
  } else if (message.method === 'tools/call') {
    const name = message.params?.name;
    const args = message.params?.arguments || {};
    try {
      if (name === 'agents_office_health') body = result(await health());
      else if (name === 'agents_office_agents') body = result(await agents());
      else if (name === 'agents_office_tasks') body = result(await tasks(args.limit));
      else if (name === 'agents_office_create_task') body = result(await createTask(args.department, args.text));
      else body = error(`Unknown tool: ${name}`);
    } catch (e) { body = error(e.message); }
  } else {
    body = {};
  }
  res.writeHead(200, { ...headers, 'content-type': 'application/json', 'mcp-session-id': 'agents-office' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id, result: body }));
}
