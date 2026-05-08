package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"

	"senny/internal/rpc"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	if err := rpc.NewServer(os.Stdin, os.Stdout).Serve(ctx); err != nil && err != context.Canceled {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
