package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/zegirulabs/misiva/backend/internal/config"
	"github.com/zegirulabs/misiva/backend/internal/server"
	"github.com/zegirulabs/misiva/backend/internal/store"
)

func main() {
	cfg := config.Load()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	st, err := store.Open(ctx, cfg.DBDriver, cfg.DatabaseURL, cfg.SQLitePath)
	cancel()
	if err != nil {
		log.Fatalf("[misiva-go] Error iniciando almacenamiento (%s): %v", cfg.DBDriver, err)
	}
	defer func() { _ = st.Close() }()

	srv := server.New(cfg, st)
	httpSrv := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		if cfg.DBDriver == "sqlite" {
			log.Printf("[misiva-go] Servidor escuchando en http://%s (DB: sqlite -> %s)", cfg.Addr(), cfg.SQLitePath)
		} else {
			log.Printf("[misiva-go] Servidor escuchando en http://%s (DB: postgres)", cfg.Addr())
		}
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("[misiva-go] Error crítico en HTTP: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	log.Println("[misiva-go] Apagando servidor de forma ordenada…")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		log.Printf("[misiva-go] Error al cerrar conexiones: %v", err)
	}
}
