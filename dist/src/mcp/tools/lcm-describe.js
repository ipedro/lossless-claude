export const lcmDescribeTool = {
    name: "lcm_describe",
    description: "Inspect metadata and lineage of a memory node without expanding content. Returns depth, token count, parent/child links, and whether it was promoted to long-term memory.",
    inputSchema: {
        type: "object",
        properties: {
            nodeId: { type: "string", description: "Node ID to describe" },
        },
        required: ["nodeId"],
    },
};
//# sourceMappingURL=lcm-describe.js.map