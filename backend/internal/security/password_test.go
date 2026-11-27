package security

import (
	"strings"
	"testing"
)

func TestHashAndVerifyPassword(t *testing.T) {
	pw := "ClaveUltraSegura2026!Misiva"
	hash, err := HashPassword(pw)
	if err != nil {
		t.Fatalf("HashPassword falló: %v", err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=19456,t=2,p=1$") {
		t.Fatalf("formato PHC inesperado: %s", hash)
	}
	if !VerifyPassword(hash, pw) {
		t.Fatal("VerifyPassword debería aceptar la contraseña correcta")
	}
	if VerifyPassword(hash, "OtraClaveIncorrecta123!") {
		t.Fatal("VerifyPassword no debería aceptar una contraseña incorrecta")
	}
	if VerifyPassword("formato-invalido", pw) {
		t.Fatal("VerifyPassword no debería aceptar un hash malformado")
	}
}

func TestRandomTokenAndSHA256(t *testing.T) {
	tok1, err := RandomToken(32)
	if err != nil {
		t.Fatalf("RandomToken error: %v", err)
	}
	tok2, err := RandomToken(32)
	if err != nil {
		t.Fatalf("RandomToken error: %v", err)
	}
	if tok1 == tok2 || len(tok1) < 40 {
		t.Fatalf("tokens inválidos o repetidos: %s / %s", tok1, tok2)
	}
	digest := SHA256Hex(tok1)
	if len(digest) != 64 {
		t.Fatalf("SHA256Hex longitud inesperada: %d", len(digest))
	}
}
