// Classic-script entry: expose the bundle as window.MOONLIGHTQ.
import * as MOONLIGHTQ from "./entry";

(window as unknown as { MOONLIGHTQ: typeof MOONLIGHTQ }).MOONLIGHTQ = MOONLIGHTQ;
