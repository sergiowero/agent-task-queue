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
    description: "Instructions for installing the AgentQ CLI and workflow skills.",
    icon: "download",
    badge: "Experimental",
  },
];
