import type { Agent, ConnectorType } from "./types.js";
export declare function generateRulesContent(agent: Agent): string;
export declare function generateMcpContent(agent: Agent): string;
export declare function generateSkillContent(_agent: Agent): string;
export declare function generateContent(agent: Agent, type: ConnectorType): string;
