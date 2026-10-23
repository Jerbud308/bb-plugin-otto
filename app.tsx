// Otto frontend entry: registrations only. Components live under ui/.
import "./app.css";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { OttoPage } from "./ui/OttoPage";
import { ProofBadge } from "./ui/ProofBadge";
import { ProofPanel } from "./ui/ProofPanel";

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({ id: "proof-badge", title: "Otto proof", component: ProofBadge });
  app.slots.threadPanelAction({ id: "proof", title: "Proof", component: ProofPanel, layout: "padded" });
  app.slots.navPanel({ id: "otto", title: "Otto", icon: "ShieldCheck", path: "otto", component: OttoPage });
});
