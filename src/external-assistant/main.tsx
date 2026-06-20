import { createRoot } from "react-dom/client";
import "../index.css";

// Placeholder root; replaced by ExternalAssistantPopover in a later task.
// Kept minimal so the multi-page build can be validated in isolation.
function Root() {
  return <div className="ea-popover-root">External assistant shell</div>;
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<Root />);
}
