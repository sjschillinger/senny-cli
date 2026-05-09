package client

import "testing"

func TestChatCompletionsURLAcceptsRootOrV1Base(t *testing.T) {
	tests := map[string]string{
		"http://localhost:11434":     "http://localhost:11434/v1/chat/completions",
		"http://localhost:11434/":    "http://localhost:11434/v1/chat/completions",
		"http://localhost:11434/v1":  "http://localhost:11434/v1/chat/completions",
		"http://localhost:11434/v1/": "http://localhost:11434/v1/chat/completions",
	}
	for base, want := range tests {
		if got := chatCompletionsURL(base); got != want {
			t.Fatalf("chatCompletionsURL(%q) = %q, want %q", base, got, want)
		}
	}
}
