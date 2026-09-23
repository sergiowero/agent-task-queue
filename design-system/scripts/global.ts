// Classic-script entry: expose the bundle as window.AgentQ.
import * as AgentQ from "./entry";

(window as unknown as { AgentQ: typeof AgentQ }).AgentQ = AgentQ;
