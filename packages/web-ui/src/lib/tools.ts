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
    description: "Install the AgentQ CLI binary and distribute skills to your AI coding tools.",
    icon: "download",
    badge: "Experimental",
  },
];
