// Public contracts only. No provider credentials, OS bridge, database or private product types.
export interface Source { id:string; url:string; title:string; text:string; readAt:string; truncated:boolean }
export interface ToolCall { id:string; name:string; arguments:string }
export interface ModelReply { content:string; toolCalls:ToolCall[] }
export interface ChatInput { conversationId:string; text:string; modelId:string; internet:boolean }
export interface ChatResult { content:string; modelLabel:string; sources:Source[]; notices:string[] }
export interface ArchivePageInput { projectId:string|null; beforeId?:string }
export interface ArchivePage<T> { items:T[]; nextCursor:string|null }
export interface ComposerDraft { projectId:string|null; conversationId:string|null; text:string; revision:number; updatedAt:string|null }
export interface DraftSaveInput { projectId:string|null; conversationId:string|null; text:string; expectedRevision:number }
export interface Bridge { draft(projectId:string|null):Promise<ComposerDraft>; saveDraft(input:DraftSaveInput):Promise<ComposerDraft> }
export class AppError extends Error { constructor(public readonly code:string, message:string) {super(message);this.name='AppError';} }
