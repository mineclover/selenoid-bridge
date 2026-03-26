export interface SnapshotElement {
  ref: string;
  role: string;
  name: string;
  backendNodeId?: number;
  attributes: Record<string, string>;
}

export interface Snapshot {
  elements: Map<string, SnapshotElement>;
}

/**
 * Parse agent-browser snapshot --json output.
 * The JSON format includes an array of nodes with ref, role, name, and backendNodeId.
 */
export function parseSnapshot(jsonOutput: string): Snapshot {
  const elements = new Map<string, SnapshotElement>();

  try {
    const data = JSON.parse(jsonOutput);
    const nodes = Array.isArray(data) ? data : data.nodes || data.elements || [];

    for (const node of nodes) {
      if (node.ref || node.ref_id) {
        const ref = String(node.ref || node.ref_id);
        elements.set(ref, {
          ref,
          role: node.role || "",
          name: node.name || "",
          backendNodeId: node.backend_node_id || node.backendNodeId,
          attributes: node.attributes || {},
        });
      }
    }
  } catch {
    // If JSON parsing fails, try text format parsing
    const lines = jsonOutput.split("\n");
    for (const line of lines) {
      const refMatch = line.match(/ref=(\w+)/);
      const roleMatch = line.match(/^[\s-]*(\w+)/);
      const nameMatch = line.match(/"([^"]+)"/);

      if (refMatch) {
        const ref = refMatch[1];
        elements.set(ref, {
          ref,
          role: roleMatch?.[1] || "",
          name: nameMatch?.[1] || "",
          attributes: {},
        });
      }
    }
  }

  return { elements };
}

export function findElementByRef(snapshot: Snapshot, ref: string): SnapshotElement | undefined {
  // Normalize ref: "@e1" → "e1", "ref=e1" → "e1"
  const normalized = ref.replace(/^[@]/, "").replace(/^ref=/, "");
  return snapshot.elements.get(normalized);
}
