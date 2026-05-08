//go:build !windows

package tool

import (
	"context"
	"os"
	"os/exec"
	"sync"
)

var (
	unixShellPath     string
	unixShellPathOnce sync.Once
)

func getUnixShellPath() string {
	unixShellPathOnce.Do(func() {
		// Honor the user's preferred shell from $SHELL first.
		if envShell := os.Getenv("SHELL"); envShell != "" {
			if shellPath, err := exec.LookPath(envShell); err == nil {
				unixShellPath = shellPath
				return
			}
		}
		if shellPath, err := exec.LookPath("bash"); err == nil {
			unixShellPath = shellPath
			return
		}
		if shellPath, err := exec.LookPath("sh"); err == nil {
			unixShellPath = shellPath
			return
		}
		unixShellPath = "sh"
	})
	return unixShellPath
}

func newShellCommand(ctx context.Context, command string) *exec.Cmd {
	return exec.CommandContext(ctx, getUnixShellPath(), "-c", command)
}
