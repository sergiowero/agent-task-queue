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
    name: "Install MoonlightQ",
    description: "Connect your coding agents to MoonlightQ: the MCP server and the workflow skills.",
    icon: "download",
    badge: "Experimental",
  },
];
