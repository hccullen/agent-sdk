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
export type ConnectorAuthType = Corti.CommonConnectorAuthType;
export type ConnectorResponse = Corti.CommonConnectorResponse;
export type ConnectorCreate = Corti.CommonConnectorCreateRequest;
export type ConnectorPatch = Corti.agentic.agents.AgenticConnectorsPatchRequest;
export type ConnectorAuth = Corti.CommonConnectorAuth;
export type ConnectorListResponse = Corti.AgenticConnectorsListResponse;
export type McpConnector = Corti.CommonMcpConnector;
export type A2AConnector = Corti.CommonA2AConnector;
export type AgentConnector = Corti.CommonAgentConnector;
export type SchemaConnector = Corti.CommonSchemaConnector;
export type RegistryConnectorProvisioned =
  Corti.CommonRegistryConnectorProvisioned;
export type SchemaConnectorTransition = Corti.CommonSchemaConnectorTransition;

export type RegistryConnector = Corti.AgenticRegistryConnector;
export type RegistryConnectorListResponse =
  Corti.AgenticRegistryConnectorsListResponse;

export type Role = Corti.CommonRole;
export type Part = Corti.CommonPart;
export type Message = Corti.CommonMessage;
export type Task = Corti.CommonTaskResponse;
export type TaskState = Corti.CommonTaskState;
export type TaskStatus = Corti.CommonTaskStatus;
export type TaskListResponse = Corti.CommonTaskListResponse;
export type TaskMetadata = Corti.CommonTaskMetadata;
export type Artifact = Corti.CommonArtifactResponse;
export type Usage = Corti.CommonUsage;

export type SendMessageRequest = Corti.AgenticAgentsSendMessageRequest;
export type SendMessageConfiguration =
  Corti.AgenticAgentsSendMessageConfiguration;

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
    contextId?: Corti.CommonContextIdValue;
    artifact?: Corti.CommonArtifactResponse;
    lastChunk?: boolean;
    /** When true, this chunk's text is an incremental delta to append. Absent on the first chunk (which creates the artifact) and on the final chunk (which carries the complete text with `lastChunk: true`). */
    append?: boolean;
  };
}

export type Context = Corti.AgenticContext;
export type ContextDetailResponse = Corti.AgenticContextsDetailResponse;
export type ContextListResponse = Corti.AgenticContextsListResponse;
export type ContextTraceResponse = Corti.AgenticContextsTraceResponse;
export type ContextTraceItem = Corti.AgenticContextsTraceItem;
export type ContextOpenInferenceSpan = Corti.AgenticContextsOpenInferenceSpan;

export type AgentCard = Corti.AgenticAgentCardResponse;
export type AgentCardCapabilities = Corti.AgenticAgentCardResponseCapabilities;
export type AgentCardProvider = Corti.AgenticAgentCardResponseProvider;
export type AgentCardSkillsItem = Corti.AgenticAgentCardResponseSkillsItem;
export type AgentCardSignaturesItem =
  Corti.AgenticAgentCardResponseSignaturesItem;
export type AgentCardSupportedInterfacesItem =
  Corti.AgenticAgentCardResponseSupportedInterfacesItem;

export type FeedbackCreateRequest =
  Corti.agentic.contexts.tasks.AgenticFeedbackCreateRequest;
export type FeedbackResponse = Corti.AgenticFeedbackResponse;
export type FeedbackListResponse = Corti.AgenticFeedbackListResponse;
export type FeedbackRating = Corti.AgenticFeedbackRating;
export type FeedbackRatingScale = Corti.AgenticFeedbackRatingScale;
export type FeedbackLabel = Corti.AgenticFeedbackLabel;
export type FeedbackTarget = Corti.AgenticFeedbackTarget;
export type FeedbackActor = Corti.AgenticFeedbackActor;
export type FeedbackMetadata = Corti.AgenticFeedbackMetadata;

export type UsageReportResponse = Corti.AgentsUsageReportResponse;
export type UsageGranularity = Corti.AgentsUsageGranularity;
export type UsageMetrics = Corti.AgentsUsageMetrics;
export type UsageBucket = Corti.AgentsUsageBucket;

export type ErrorResponse = Corti.CommonErrorResponse;
export type ErrorResponseError = Corti.CommonErrorResponseError;
export type NextPageToken = Corti.CommonNextPageToken;
export type TotalSize = Corti.CommonTotalSize;
export type AgentsLabels = Corti.AgentsLabels;
export type RegistryConnectorCapabilities =
  Corti.AgenticRegistryConnectorCapabilities;
export type RegistryIcon = Corti.AgenticRegistryIcon;

export type TextPart = { text: string; metadata?: Record<string, unknown> };
export type DataPart = {
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};
export type FilePart = {
  filename?: string;
  mediaType?: string;
  raw?: string;
  url?: string;
  metadata?: Record<string, unknown>;
};

export function textPart(
  text: string,
  metadata?: Record<string, unknown>,
): TextPart {
  return { text, ...(metadata !== undefined && { metadata }) };
}

export function dataPart(
  data: Record<string, unknown>,
  metadata?: Record<string, unknown>,
): DataPart {
  return { data, ...(metadata !== undefined && { metadata }) };
}

export function filePart(opts: {
  filename?: string;
  mediaType?: string;
  raw?: string;
  url?: string;
  metadata?: Record<string, unknown>;
}): FilePart {
  return opts;
}
