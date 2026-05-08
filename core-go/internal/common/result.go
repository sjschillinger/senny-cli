package common

import "senny/internal/client"

// StreamResult represents a chunk of data from the stream.
// It is moved here to avoid circular imports between session and common.
type StreamResult struct {
	Content          string        `json:"content"`
	ReasoningContent string        `json:"reasoning_content,omitempty"`
	ToolCalls        []client.ToolCall `json:"tool_calls,omitempty"`
	Usage            client.Usage  `json:"usage,omitempty"`
	FinishReason     string        `json:"finish_reason,omitempty"`
}
