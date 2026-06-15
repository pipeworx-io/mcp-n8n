interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * n8n MCP — query your own n8n instance (BYO).
 *
 * n8n's public REST API is API-key auth (header X-N8N-API-KEY) against YOUR
 * instance URL (n8n Cloud like https://you.app.n8n.cloud, or self-hosted like
 * https://n8n.example.com). There is no OAuth and no shared key — so this is
 * a BYO connector pack: pass your instance_url + your API key (_apiKey) on
 * every call.
 *
 * Generate an API key: n8n → Settings → n8n API → Create an API key.
 * Docs: https://docs.n8n.io/api/
 *
 * SECURITY: instance_url is user-supplied and fetched server-side, so it is
 * SSRF-guarded (assertPublicHttpUrl: public https hosts only — blocks
 * localhost / private ranges / non-https).
 *
 * Tools:
 * - n8n_list_workflows:  workflows + active count ("how many active workflows")
 * - n8n_get_workflow:    one workflow's detail by id
 * - n8n_list_executions: recent executions, filter by status / workflow
 */

import { assertPublicHttpUrl } from '@pipeworx/shared';

const API_KEY_PROP = {
  type: 'string' as const,
  description:
    'REQUIRED — your n8n API key (Settings → n8n API → Create an API key). Sent as the X-N8N-API-KEY header. No shared key exists for this pack.',
};

const INSTANCE_PROP = {
  type: 'string' as const,
  description:
    'REQUIRED — your n8n instance base URL, e.g. "https://you.app.n8n.cloud" (n8n Cloud) or "https://n8n.example.com" (self-hosted). Must be a public https URL.',
};

const tools: McpToolExport['tools'] = [
  {
    name: 'n8n_list_workflows',
    description:
      'List workflows in YOUR n8n instance, with an active/inactive breakdown. Answers "how many active workflows do we have", "list our n8n workflows", "which workflows are turned on". Each workflow: id, name, active (on/off), createdAt, updatedAt, tags. Set active_only:true to list just the live ones. Requires your instance_url + n8n API key (_apiKey).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        instance_url: INSTANCE_PROP,
        active_only: { type: 'boolean', description: 'Only return active (turned-on) workflows. Default false (all).' },
        limit: { type: 'number', description: 'Max workflows to fetch (1-250, default 100).' },
        _apiKey: API_KEY_PROP,
      },
      required: ['instance_url', '_apiKey'],
    },
  },
  {
    name: 'n8n_get_workflow',
    description:
      "Get one workflow's detail by id from your n8n instance — name, active state, node list (which integrations it uses), tags, timestamps. Get the id from n8n_list_workflows. Requires your instance_url + n8n API key (_apiKey).",
    inputSchema: {
      type: 'object' as const,
      properties: {
        instance_url: INSTANCE_PROP,
        workflow_id: { type: 'string', description: 'The workflow id — from n8n_list_workflows.' },
        _apiKey: API_KEY_PROP,
      },
      required: ['instance_url', 'workflow_id', '_apiKey'],
    },
  },
  {
    name: 'n8n_list_executions',
    description:
      'List recent workflow executions (runs) in your n8n instance — for "did our workflows run", "show recent failures", "execution history". Each: id, workflowId, status (success/error/waiting), mode, startedAt, stoppedAt. Filter by status and/or workflow_id. Requires your instance_url + n8n API key (_apiKey).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        instance_url: INSTANCE_PROP,
        status: { type: 'string', description: 'Filter: "success" | "error" | "waiting". Omit for all.', enum: ['success', 'error', 'waiting'] },
        workflow_id: { type: 'string', description: 'Only executions of this workflow id.' },
        limit: { type: 'number', description: 'Max executions (1-250, default 50).' },
        _apiKey: API_KEY_PROP,
      },
      required: ['instance_url', '_apiKey'],
    },
  },
];

// ── Helpers ──────────────────────────────────────────────────────────

function clamp(v: unknown, dflt: number, max: number): number {
  const n = Number(v ?? dflt);
  return Number.isFinite(n) ? Math.min(max, Math.max(1, n)) : dflt;
}

// Build the API base from a user instance URL: SSRF-guard it, strip any
// trailing slash and a trailing /api/v1 the user might have pasted.
function apiBase(instanceUrl: string): string {
  const cleaned = String(instanceUrl || '').trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  assertPublicHttpUrl(cleaned); // throws blocked_url for localhost / private / non-https
  return `${cleaned}/api/v1`;
}

async function n8nGet(
  instanceUrl: string,
  apiKey: string,
  path: string,
  query: Record<string, string | number | boolean> = {},
): Promise<Record<string, unknown>> {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Required argument "_apiKey" is missing. Create one in n8n: Settings → n8n API → Create an API key.');
  }
  let base: string;
  try {
    base = apiBase(instanceUrl);
  } catch (e) {
    return {
      error: 'blocked_url',
      message: `instance_url must be a public https URL (n8n Cloud or a reachable self-hosted host). ${(e as Error).message}`,
    };
  }
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));

  const res = await fetch(url.toString(), {
    headers: { 'X-N8N-API-KEY': apiKey.trim(), Accept: 'application/json' },
  });
  if (res.status === 401) {
    return { error: 'unauthorized', message: 'n8n rejected the API key (401). Check _apiKey and that the key has not been revoked.' };
  }
  if (res.status === 404) {
    return { error: 'not_found', message: `n8n returned 404 for ${path} — check the instance_url and id.` };
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`n8n API error: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

interface RawWorkflow {
  id?: string;
  name?: string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
  tags?: Array<{ id?: string; name?: string }>;
  nodes?: Array<{ type?: string; name?: string }>;
}

function shapeWorkflow(w: RawWorkflow) {
  return {
    id: w.id ?? null,
    name: w.name ?? null,
    active: w.active ?? null,
    created_at: w.createdAt ?? null,
    updated_at: w.updatedAt ?? null,
    tags: (w.tags ?? []).map((t) => t.name).filter(Boolean),
  };
}

// ── Tool implementations ─────────────────────────────────────────────

async function listWorkflows(args: Record<string, unknown>, apiKey: string) {
  const instanceUrl = String(args.instance_url ?? '');
  const activeOnly = args.active_only === true;
  const limit = clamp(args.limit, 100, 250);
  const query: Record<string, string | number | boolean> = { limit };
  if (activeOnly) query.active = true;

  const data = await n8nGet(instanceUrl, apiKey, '/workflows', query);
  if (data.error) return data;

  const list = ((data.data ?? []) as RawWorkflow[]).map(shapeWorkflow);
  const activeCount = list.filter((w) => w.active === true).length;
  return {
    total_returned: list.length,
    active_count: activeOnly ? list.length : activeCount,
    inactive_count: activeOnly ? 0 : list.length - activeCount,
    more_available: Boolean(data.nextCursor),
    note: data.nextCursor
      ? `More workflows exist beyond this page (raise limit, max 250). Counts reflect only the ${list.length} returned.`
      : 'All workflows returned.',
    workflows: list,
  };
}

async function getWorkflow(args: Record<string, unknown>, apiKey: string) {
  const instanceUrl = String(args.instance_url ?? '');
  const id = String(args.workflow_id ?? '').trim();
  if (!id) throw new Error('workflow_id is required — get it from n8n_list_workflows.');

  const w = await n8nGet(instanceUrl, apiKey, `/workflows/${encodeURIComponent(id)}`);
  if (w.error) return w;

  const raw = w as RawWorkflow;
  return {
    ...shapeWorkflow(raw),
    node_count: (raw.nodes ?? []).length,
    nodes: (raw.nodes ?? []).map((n) => ({ name: n.name ?? null, type: n.type ?? null })),
  };
}

async function listExecutions(args: Record<string, unknown>, apiKey: string) {
  const instanceUrl = String(args.instance_url ?? '');
  const limit = clamp(args.limit, 50, 250);
  const query: Record<string, string | number | boolean> = { limit, includeData: false };
  if (args.status) query.status = String(args.status);
  if (args.workflow_id) query.workflowId = String(args.workflow_id);

  const data = await n8nGet(instanceUrl, apiKey, '/executions', query);
  if (data.error) return data;

  interface RawExec {
    id?: string | number;
    workflowId?: string;
    status?: string;
    finished?: boolean;
    mode?: string;
    startedAt?: string;
    stoppedAt?: string;
  }
  const list = ((data.data ?? []) as RawExec[]).map((e) => ({
    id: e.id ?? null,
    workflow_id: e.workflowId ?? null,
    status: e.status ?? (e.finished ? 'success' : null),
    mode: e.mode ?? null,
    started_at: e.startedAt ?? null,
    stopped_at: e.stoppedAt ?? null,
  }));
  return {
    total_returned: list.length,
    more_available: Boolean(data.nextCursor),
    executions: list,
  };
}

// ── Router ───────────────────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const apiKey = args._apiKey as string;
  delete args._apiKey;
  switch (name) {
    case 'n8n_list_workflows':
      return listWorkflows(args, apiKey);
    case 'n8n_get_workflow':
      return getWorkflow(args, apiKey);
    case 'n8n_list_executions':
      return listExecutions(args, apiKey);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
