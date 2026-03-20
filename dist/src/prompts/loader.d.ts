export type PromptTemplate = {
    name: string;
    description: string;
    variables: string[];
    template: string;
};
export declare function loadTemplate(name: string): PromptTemplate;
export declare function interpolate(template: string, vars: Record<string, string>): string;
export declare function renderTemplate(name: string, vars: Record<string, string>): string;
