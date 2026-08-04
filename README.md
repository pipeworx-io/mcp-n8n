# mcp-n8n

n8n MCP — query your own n8n instance (BYO).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `n8n_list_workflows` | List workflows in YOUR n8n instance, with an active/inactive breakdown. Answers "how many active workflows do we have", "list our n8n workflows", "which workflows are turned on". Each workflow: id, name, active (on/off), createdAt, updatedAt, tags. Set active_only:true to list just the live ones. Requires your instance_url + n8n API key (_apiKey). |
| `n8n_get_workflow` | Get one workflow's detail by id from your n8n instance — name, active state, node list (which integrations it uses), tags, timestamps. Get the id from n8n_list_workflows. Requires your instance_url + n8n API key (_apiKey). |
| `n8n_list_executions` | List recent workflow executions (runs) in your n8n instance — for "did our workflows run", "show recent failures", "execution history". Each: id, workflowId, status (success/error/waiting), mode, startedAt, stoppedAt. Filter by status and/or workflow_id. Requires your instance_url + n8n API key (_apiKey). |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "n8n": {
      "url": "https://gateway.pipeworx.io/n8n/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about N8n data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
