export declare const lcmGrepTool: {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            query: {
                type: string;
                description: string;
            };
            scope: {
                type: string;
                enum: string[];
                default: string;
            };
            sessionId: {
                type: string;
                description: string;
            };
            since: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
