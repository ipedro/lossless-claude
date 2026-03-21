import type { Agent, AgentCategory } from './types.js';
export declare const AGENTS: Agent[];
export declare function findAgent(idOrName: string): Agent | undefined;
export declare function getAgentsByCategory(category: AgentCategory): Agent[];
