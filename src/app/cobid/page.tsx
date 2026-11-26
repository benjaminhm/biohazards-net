import { WorkspaceProvider } from "@/components/cobid/WorkspaceContext";
import { WorkspaceShell } from "@/components/cobid/WorkspaceShell";

export default function CobidHomePage() {
  return (
    <WorkspaceProvider>
      <WorkspaceShell />
    </WorkspaceProvider>
  );
}
