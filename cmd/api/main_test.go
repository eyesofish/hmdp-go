package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/amemiya02/hmdp-go/internal/service"
	"github.com/gin-gonic/gin"
)

func TestSetupRouterUsesRequestContext(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := SetupRouter(&service.VoucherOrderService{})
	if !router.ContextWithFallback {
		t.Fatal("Gin context must propagate request cancellation")
	}
}

func TestVoucherConfirmationRequiresLogin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := SetupRouter(&service.VoucherOrderService{})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/voucher-order/42/confirmation", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated confirmation status = %d, want 401", rec.Code)
	}
}
