import type { components } from "./gen/api-v2.js";

export type {
  paths,
  components,
  operations,
} from "./gen/api-v2.js";

export type AgentID = components["schemas"]["CommonAgentIDValue"];
export type ConnectorID = components["schemas"]["CommonConnectorIDValue"];
export type ContextID = components["schemas"]["CommonContextIDValue"];
export type TaskID = components["schemas"]["CommonTaskIDValue"];
export type MessageID = components["schemas"]["CommonMessageIDValue"];
export type ArtifactID = components["schemas"]["CommonArtifactIDValue"];
export type UserID = components["schemas"]["AgentsUserIDValue"];

export type Visibility = components["schemas"]["AgentsVisibility"];
export type Lifecycle = components["schemas"]["AgentsLifecycle"];

export type Agent = components["schemas"]["AgentsResponse"];
export type AgentCreate = components["schemas"]["AgentsCreateRequest"];
export type AgentPatch = components["schemas"]["AgentsPatchRequest"];
export type AgentListResponse = components["schemas"]["AgentsListResponse"];

export type ConnectorType = components["schemas"]["CommonConnectorType"];
export type ConnectorResponse = components["schemas"]["CommonConnectorResponse"];
export type ConnectorCreate = components["schemas"]["CommonConnectorCreateRequest"];
export type ConnectorPatch = components["schemas"]["ConnectorsPatchRequest"];
export type ConnectorAuth = components["schemas"]["CommonConnectorAuth"];
export type ConnectorListResponse = components["schemas"]["ConnectorsListResponse"];

export type RegistryConnector = components["schemas"]["RegistryConnectorResponse"];
export type RegistryConnectorListResponse = components["schemas"]["RegistryConnectorListResponse"];

export type Role = components["schemas"]["CommonRole"];
export type Part = components["schemas"]["CommonPart"];
export type Message = components["schemas"]["CommonMessage"];
export type Task = components["schemas"]["CommonTaskResponse"];
export type TaskState = components["schemas"]["CommonTaskState"];
export type TaskStatus = components["schemas"]["CommonTaskStatus"];
export type TaskListResponse = components["schemas"]["CommonTaskListResponse"];
export type Artifact = components["schemas"]["CommonArtifactResponse"];
export type Usage = components["schemas"]["CommonUsage"];

export type SendMessageRequest = components["schemas"]["A2ASendMessageRequest"];
export type SendMessageResponse = components["schemas"]["A2ASendMessageResponse"];
export type StreamResponse = components["schemas"]["A2AStreamResponse"];

export type Context = components["schemas"]["Contexts"];
export type ContextDetailResponse = components["schemas"]["ContextsDetailResponse"];
export type ContextListResponse = components["schemas"]["ContextsListResponse"];
export type ContextTraceResponse = components["schemas"]["ContextsTraceResponse"];

export type AgentCard = components["schemas"]["AgentCardResponse"];

export type FeedbackCreateRequest = components["schemas"]["FeedbackCreateRequest"];
export type FeedbackResponse = components["schemas"]["FeedbackResponse"];

export type UsageReportResponse = components["schemas"]["UsageReportResponse"];
export type UsageGranularity = components["schemas"]["UsageGranularity"];

export type ModelResponse = components["schemas"]["ModelsResponse"];
export type ModelsListResponse = components["schemas"]["ModelsListResponse"];

export type ErrorResponse = components["schemas"]["CommonErrorResponse"];
export type A2AErrorResponse = components["schemas"]["A2AErrorResponse"];

export type TextPart = { text: string };
export type FilePart = {
  file: {
    name?: string;
    mimeType?: string;
    uri?: string;
    bytes?: string;
  };
};
export type DataPart = { data: Record<string, unknown> };

export function textPart(text: string): TextPart {
  return { text };
}

export function filePart(opts: {
  name?: string;
  mimeType?: string;
  uri?: string;
  bytes?: string;
}): FilePart {
  return { file: opts };
}

export function dataPart(data: Record<string, unknown>): DataPart {
  return { data };
}
