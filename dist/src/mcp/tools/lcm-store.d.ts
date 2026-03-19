export declare const lcmStoreTool: {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            text: {
                type: string;
                description: string;
            };
            tags: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            metadata: {
                type: string;
                description: string;
                additionalProperties: boolean;
            };
        };
        required: string[];
    };
};
