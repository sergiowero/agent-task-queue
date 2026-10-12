// Classic-script entry: expose the bundle as window.MTQ.
import * as MTQ from "./entry";

(window as unknown as { MTQ: typeof MTQ }).MTQ = MTQ;
