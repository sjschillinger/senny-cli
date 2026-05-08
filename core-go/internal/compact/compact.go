package compact

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"

	"senny/internal/assets"
	"senny/internal/client"
)

// ShouldCompact returns true when accumulated prompt tokens exceed 80% of the context window.
// If the context window is unknown, a conservative fallback of 4096 tokens is used.
func ShouldCompact(promptTokens, contextWindow int) bool {
	if contextWindow <= 0 {
		contextWindow = 4096
	}
	return promptTokens > int(float64(contextWindow)*0.80)
}

// CompactSession summarizes the older half of history using the provided client.
// It returns the summary message and the list of message IDs that were replaced.
// On failure it returns an error; the caller should log and continue without compacting.
func CompactSession(
	ctx context.Context,
	c *client.Client,
	history []client.ChatMessage,
	systemPrompt string,
) (summary client.ChatMessage, replacedIDs []string, err error) {
	if len(history) < 6 {
		return client.ChatMessage{}, nil, fmt.Errorf("history too short to compact (%d messages)", len(history))
	}

	keepCount := len(history) / 2
	toSummarize := history[:len(history)-keepCount]

	compactionPromptBytes, _ := assets.PromptsFS.ReadFile("prompts/compaction.md")
	compactionPrompt := string(compactionPromptBytes)

	messages := make([]client.ChatMessage, 0, len(toSummarize)+1)
	messages = append(messages, client.ChatMessage{Role: "system", Content: compactionPrompt})
	messages = append(messages, toSummarize...)

	req := client.ChatCompletionRequest{
		Messages: messages,
	}

	resp, err := c.ChatCompletion(ctx, req)
	if err != nil {
		return client.ChatMessage{}, nil, fmt.Errorf("compaction request failed: %w", err)
	}
	if len(resp.Choices) == 0 {
		return client.ChatMessage{}, nil, fmt.Errorf("compaction response had no choices")
	}

	for _, msg := range toSummarize {
		if msg.ID != "" {
			replacedIDs = append(replacedIDs, msg.ID)
		}
	}

	summaryMsg := client.ChatMessage{
		ID:      newID(),
		Role:    "system",
		Content: resp.Choices[0].Message.Content,
	}
	return summaryMsg, replacedIDs, nil
}

func newID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
