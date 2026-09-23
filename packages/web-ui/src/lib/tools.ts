export interface Tool {
  id: string;
  name: string;
  description: string;
  icon: string;
  badge?: string;
}

export const TOOLS: Tool[] = [
  {
    id: "install",
    name: "Install AgentQ",
    description: "Connect your coding agents to AgentQ: the MCP server and the workflow skills.",
    icon: "download",
    badge: "Experimental",
  },
];
