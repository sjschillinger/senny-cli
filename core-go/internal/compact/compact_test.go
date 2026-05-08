package compact

import "testing"

func TestShouldCompact(t *testing.T) {
	tests := []struct {
		promptTokens int
		contextWindow int
		want          bool
	}{
		{0, 4096, false},
		{3276, 4096, false}, // exactly 80%
		{3277, 4096, true},  // just over 80%
		{10000, 0, true},    // unknown context window → conservative fallback 4096
		{1000, 0, false},    // below fallback threshold
	}
	for _, tt := range tests {
		got := ShouldCompact(tt.promptTokens, tt.contextWindow)
		if got != tt.want {
			t.Errorf("ShouldCompact(%d, %d) = %v, want %v", tt.promptTokens, tt.contextWindow, got, tt.want)
		}
	}
}
