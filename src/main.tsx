import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { platformClass } from "./lib/platform";

document.documentElement.classList.add(platformClass());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />
);
