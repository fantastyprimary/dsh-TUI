/** Runtime inheritance for enhancement overlays mounted outside the preset roster. */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
export type EnhancementKind = 'smart' | 'force-smart';
/** Record a mounted parent so spawn, fork, and continuable children inherit it. */
export declare function registerEnhancementAgent(hostCtx: Context, agent: Agent, kind: EnhancementKind, installChild: (childCtx: Context) => void): void;
/** Runtime truth before a child's first request/header marker is durable. */
export declare function enhancementOf(hostCtx: Context, agent: Agent): EnhancementKind | undefined;
//# sourceMappingURL=enhancementInheritance.d.ts.map