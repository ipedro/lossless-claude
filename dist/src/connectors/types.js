export const CONNECTOR_TYPES = ['rules', 'hook', 'mcp', 'skill'];
/**
 * Whether the connector type requires an agent restart to take effect.
 * Rules connectors are passive (agent reads on each prompt).
 * Hook, MCP, and skill connectors need restart.
 */
export function requiresRestart(type) {
    return type !== 'rules';
}
//# sourceMappingURL=types.js.map