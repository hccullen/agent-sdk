import type { Corti } from "@corti/sdk";

export type AgentID = Corti.CommonAgentIdValue;
export type ConnectorID = Corti.CommonConnectorIdValue;
export type ContextID = Corti.CommonContextIdValue;
export type TaskID = Corti.CommonTaskIdValue;
export type MessageID = Corti.CommonMessageIdValue;
export type ArtifactID = Corti.CommonArtifactIdValue;
export type UserID = Corti.AgentsUserIdValue;

export type Visibility = Corti.AgentsVisibility;
export type Lifecycle = Corti.AgentsLifecycle;

export type Agent = Corti.AgenticAgentsResponse;
export type AgentCreate = Corti.agentic.AgenticAgentsCreateRequest;
export type AgentPatch = Corti.agentic.AgenticAgentsPatchRequest;
export type AgentListResponse = Corti.AgenticAgentsListResponse;

export type ConnectorType = Corti.CommonConnectorType;
export type ConnectorResponse = Corti.CommonConnectorResponse;
export type ConnectorCreate = Corti.CommonConnectorCreateRequest;
export type ConnectorPatch = Corti.agentic.agents.AgenticConnectorsPatchRequest;
export type ConnectorAuth = Corti.CommonConnectorAuth;
export type ConnectorListResponse = Corti.AgenticConnectorsListResponse;

export type RegistryConnector = Corti.AgenticRegistryConnector;
export type RegistryConnectorListResponse = Corti.AgenticRegistryConnectorsListResponse;

export type Role = Corti.CommonRole;
export type Part = Corti.CommonPart;
export type Message = Corti.CommonMessage;
export type Task = Corti.CommonTaskResponse;
export type TaskState = Corti.CommonTaskState;
export type TaskStatus = Corti.CommonTaskStatus;
export type TaskListResponse = Corti.CommonTaskListResponse;
export type Artifact = Corti.CommonArtifactResponse;
export type Usage = Corti.CommonUsage;

export type SendMessageRequest = Corti.AgenticAgentsSendMessageRequest;

export interface SendMessageResponse {
  task?: Corti.CommonTaskResponse;
  message?: Corti.CommonMessage;
}

export interface StreamResponse {
  task?: Corti.CommonTaskResponse;
  message?: Corti.CommonMessage;
  statusUpdate?: {
    taskId?: Corti.CommonTaskIdValue;
    contextId?: Corti.CommonContextIdValue;
    status?: Corti.CommonTaskStatus;
    metadata?: Record<string, unknown>;
  };
  artifactUpdate?: {
    taskId?: Corti.CommonTaskIdValue;
    artifact?: Corti.CommonArtifactResponse;
    lastChunk?: boolean;
  };
}

export type Context = Corti.AgenticContext;
export type ContextDetailResponse = Corti.AgenticContextsDetailResponse;
export type ContextListResponse = Corti.AgenticContextsListResponse;
export type ContextTraceResponse = Corti.AgenticContextsTraceResponse;

export type AgentCard = Corti.AgenticAgentCardResponse;

export type FeedbackCreateRequest = Corti.agentic.contexts.tasks.AgenticFeedbackCreateRequest;
export type FeedbackResponse = Corti.AgenticFeedbackResponse;
export type FeedbackListResponse = Corti.AgenticFeedbackListResponse;

export type UsageReportResponse = Corti.AgentsUsageReportResponse;
export type UsageGranularity = Corti.AgentsUsageGranularity;

export type ErrorResponse = Corti.CommonErrorResponse;

export type TextPart = { text: string };
export type DataPart = { data: Record<string, unknown> };
export type FilePart = {
  filename?: string;
  mediaType?: string;
  raw?: string;
  url?: string;
};

export function textPart(text: string): TextPart {
  return { text };
}

export function dataPart(data: Record<string, unknown>): DataPart {
  return { data };
}

export function filePart(opts: {
  filename?: string;
  mediaType?: string;
  raw?: string;
  url?: string;
}): FilePart {
  return opts;
}
